// Service worker: điều phối offscreen document (nơi phát nhạc) và lấy token Google.
// Service worker có thể bị Chrome tắt bất cứ lúc nào nên KHÔNG giữ trạng thái phát nhạc ở đây.

import { runCleanup } from './lib/cleanup.js';
import { CLIENT_ID, CLIENT_SECRET, SCOPES } from './config.js';

const OFFSCREEN_URL = 'offscreen.html';
let creatingOffscreen = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Keep playing MP3 audio while the popup window is closed.'
  });
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

// ---------- Google sign-in (works on Chrome and Edge) ----------
// Uses chrome.identity.launchWebAuthFlow with a "Web application" OAuth client whose redirect URI is
// chrome.identity.getRedirectURL() (https://<extension-id>.chromiumapp.org/).
//
// * With CLIENT_SECRET set (config.js): authorization-code flow + PKCE. We store a refresh token
//   and renew the 1-hour access token in the background, so the user stays signed in.
// * Without it: implicit flow. Tokens last ~1 hour and are renewed silently (prompt=none) while the
//   browser still has a Google session.

const AUTH_KEY = 'auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
let tokenInFlight = null;

function authError(message) {
  const e = new Error(message);
  e.needsLogin = true; // the user must sign in again
  return e;
}

function requireConfig() {
  if (!CLIENT_ID || CLIENT_ID.startsWith('YOUR_CLIENT_ID')) {
    throw new Error('Client ID is not configured in config.js (see README).');
  }
}

async function readAuth() {
  const data = await chrome.storage.local.get(AUTH_KEY);
  return data[AUTH_KEY] || {};
}

async function writeAuth(auth) {
  await chrome.storage.local.set({ [AUTH_KEY]: auth });
}

async function clearAuth() {
  await chrome.storage.local.remove(AUTH_KEY);
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makePkce() {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

function launchFlow(url, interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: !!interactive }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(authError((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Sign-in was cancelled'));
        return;
      }
      resolve(responseUrl);
    });
  });
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  let json = {};
  try {
    json = await res.json();
  } catch (e) {
    /* ignore */
  }
  if (!res.ok) {
    if (json.error === 'invalid_grant') throw authError('Session expired. Please sign in again.');
    throw new Error(json.error_description || json.error || 'Token request failed (' + res.status + ')');
  }
  return json;
}

async function saveTokens(json, previous) {
  const auth = {
    accessToken: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    refreshToken: json.refresh_token || (previous && previous.refreshToken) || null
  };
  await writeAuth(auth);
  return auth;
}

async function authorize(interactive) {
  requireConfig();
  const base = {
    client_id: CLIENT_ID,
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: SCOPES.join(' '),
    include_granted_scopes: 'true'
  };

  if (CLIENT_SECRET) {
    // Authorization-code flow with PKCE, gives a refresh token
    const { verifier, challenge } = await makePkce();
    const params = new URLSearchParams({
      ...base,
      response_type: 'code',
      access_type: 'offline',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: interactive ? 'consent select_account' : 'none'
    });
    const responseUrl = await launchFlow('https://accounts.google.com/o/oauth2/v2/auth?' + params, interactive);
    const query = new URL(responseUrl).searchParams;
    if (query.get('error')) throw authError('Google returned an error: ' + query.get('error'));
    const code = query.get('code');
    if (!code) throw authError('No authorization code received');
    const json = await tokenRequest({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      code_verifier: verifier,
      redirect_uri: base.redirect_uri,
      grant_type: 'authorization_code'
    });
    return (await saveTokens(json, null)).accessToken;
  }

  // Implicit flow (no refresh token)
  const params = new URLSearchParams({
    ...base,
    response_type: 'token',
    prompt: interactive ? 'select_account' : 'none'
  });
  const responseUrl = await launchFlow('https://accounts.google.com/o/oauth2/v2/auth?' + params, interactive);
  const hash = new URLSearchParams(new URL(responseUrl).hash.replace(/^#/, ''));
  if (hash.get('error')) throw authError('Google returned an error: ' + hash.get('error'));
  const token = hash.get('access_token');
  if (!token) throw authError('No access token received');
  await saveTokens({ access_token: token, expires_in: hash.get('expires_in') }, null);
  return token;
}

async function getToken({ interactive, invalidate }) {
  let auth = await readAuth();
  if (invalidate) {
    auth = { ...auth, accessToken: null, expiresAt: 0 }; // keep the refresh token
    await writeAuth(auth);
  }
  if (auth.accessToken && auth.expiresAt > Date.now() + 60 * 1000) return auth.accessToken;

  // Merge simultaneous requests (popup + offscreen) into one
  if (!tokenInFlight) {
    tokenInFlight = (async () => {
      if (auth.refreshToken && CLIENT_SECRET) {
        try {
          const json = await tokenRequest({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            refresh_token: auth.refreshToken,
            grant_type: 'refresh_token'
          });
          return (await saveTokens(json, auth)).accessToken;
        } catch (e) {
          if (e.needsLogin) await clearAuth(); // refresh token revoked or expired
          if (!interactive || !e.needsLogin) throw e; // network errors keep the user signed in
        }
      }
      return authorize(interactive);
    })().finally(() => {
      tokenInFlight = null;
    });
  }
  return tokenInFlight;
}

async function authInfo() {
  const auth = await readAuth();
  return {
    persistent: !!CLIENT_SECRET,
    hasRefreshToken: !!auth.refreshToken,
    signedIn: !!(auth.refreshToken || (auth.accessToken && auth.expiresAt > Date.now()))
  };
}

async function signOut() {
  const auth = await readAuth();
  await clearAuth();
  const token = auth.refreshToken || auth.accessToken;
  if (token) {
    // Revoke on Google's side so the next sign-in asks for permission again
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }).catch(() => {});
  }
}

// ---------- Cửa sổ nổi (ghim) ----------

async function openFloatingWindow() {
  const base = chrome.runtime.getURL('popup.html');
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['popup'] });
  const existing = wins.find((w) => (w.tabs || []).some((t) => (t.url || '').startsWith(base)));
  if (existing) {
    await chrome.windows.update(existing.id, { focused: true });
    return;
  }
  await chrome.windows.create({ url: base + '?window=1', type: 'popup', width: 420, height: 690 });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'background') return false;

  (async () => {
    switch (msg.type) {
      case 'ensureOffscreen':
        await ensureOffscreen();
        return { ok: true };
      case 'getToken':
        return { token: await getToken(msg) };
      case 'openFloating':
        await openFloatingWindow();
        return { ok: true };
      case 'authInfo':
        return await authInfo();
      case 'signOut':
        await signOut();
        return { ok: true };
      default:
        return { error: 'Unknown message: ' + msg.type };
    }
  })().then(sendResponse, (err) =>
    sendResponse({ error: err.message || String(err), needsLogin: !!err.needsLogin })
  );

  return true; // phản hồi bất đồng bộ
});

// ---------- Dọn cache định kỳ (mỗi ngày một lần) ----------

function scheduleCleanup() {
  chrome.alarms.create('cache-cleanup', { delayInMinutes: 1, periodInMinutes: 24 * 60 });
}

chrome.runtime.onInstalled.addListener(scheduleCleanup);
chrome.runtime.onStartup.addListener(scheduleCleanup);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cache-cleanup') runCleanup().catch(() => {});
});
