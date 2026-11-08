// Service worker: điều phối offscreen document (nơi phát nhạc) và lấy token Google.
// Service worker có thể bị Chrome tắt bất cứ lúc nào nên KHÔNG giữ trạng thái phát nhạc ở đây.

import { runCleanup } from './lib/cleanup.js';

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
    justification: 'Phát file MP3 liên tục khi cửa sổ popup bị đóng.'
  });
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

// ---------- Đăng nhập Google bằng launchWebAuthFlow ----------
// chrome.identity.getAuthToken không chạy trên Microsoft Edge, còn launchWebAuthFlow thì chạy
// trên cả Chrome lẫn Edge. Dùng OAuth client loại "Web application" với Redirect URI là
// chrome.identity.getRedirectURL() (https://<extension-id>.chromiumapp.org/).
// Dùng luồng implicit: token sống ~1 giờ, hết hạn thì tự xin lại âm thầm (prompt=none).

const TOKEN_KEY = 'authToken';
let tokenInFlight = null;

function oauthConfig() {
  const cfg = (chrome.runtime.getManifest().oauth2) || {};
  if (!cfg.client_id || cfg.client_id.startsWith('YOUR_CLIENT_ID')) {
    throw new Error('Chưa cấu hình Client ID trong manifest.json (xem README).');
  }
  return cfg;
}

async function readCachedToken() {
  const data = await chrome.storage.local.get(TOKEN_KEY);
  const t = data[TOKEN_KEY];
  return t && t.token && t.expiresAt > Date.now() + 60 * 1000 ? t.token : null;
}

async function clearCachedToken() {
  await chrome.storage.local.remove(TOKEN_KEY);
}

function launchAuth(interactive) {
  const cfg = oauthConfig();
  const params = new URLSearchParams({
    client_id: cfg.client_id,
    response_type: 'token',
    redirect_uri: chrome.identity.getRedirectURL(),
    scope: (cfg.scopes || []).join(' '),
    include_granted_scopes: 'true',
    prompt: interactive ? 'select_account' : 'none'
  });
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: !!interactive }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Đăng nhập bị hủy'));
        return;
      }
      const hash = new URL(responseUrl).hash.replace(/^#/, '');
      const res = new URLSearchParams(hash);
      if (res.get('error')) {
        reject(new Error('Google trả về lỗi: ' + res.get('error')));
        return;
      }
      const token = res.get('access_token');
      if (!token) {
        reject(new Error('Không nhận được access token'));
        return;
      }
      const expiresIn = Number(res.get('expires_in')) || 3600;
      chrome.storage.local
        .set({ [TOKEN_KEY]: { token, expiresAt: Date.now() + expiresIn * 1000 } })
        .then(() => resolve(token));
    });
  });
}

async function getToken({ interactive, invalidate }) {
  if (invalidate) await clearCachedToken();
  const cached = await readCachedToken();
  if (cached) return cached;

  // Gộp các lần xin token đồng thời (popup + offscreen) thành một
  if (!tokenInFlight) {
    tokenInFlight = launchAuth(interactive).finally(() => {
      tokenInFlight = null;
    });
  }
  return tokenInFlight;
}

async function signOut() {
  const token = await readCachedToken();
  await clearCachedToken();
  if (token) {
    // Thu hồi token phía Google để lần sau hỏi quyền lại
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
      case 'signOut':
        await signOut();
        return { ok: true };
      default:
        return { error: 'Unknown message: ' + msg.type };
    }
  })().then(sendResponse, (err) => sendResponse({ error: err.message || String(err) }));

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
