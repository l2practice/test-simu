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

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: !!interactive }, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      // Chrome mới có thể trả về object { token, grantedScopes }
      const token = typeof result === 'string' ? result : result && result.token;
      if (!token) {
        reject(new Error('Không lấy được token'));
        return;
      }
      resolve(token);
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

async function getToken({ interactive, invalidate }) {
  if (invalidate) await removeCachedToken(invalidate);
  return getAuthToken(interactive);
}

async function signOut() {
  try {
    const token = await getAuthToken(false);
    await removeCachedToken(token);
    // Thu hồi token phía Google để lần sau hỏi quyền lại
    await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }).catch(() => {});
  } catch (e) {
    // Chưa đăng nhập: bỏ qua
  }
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
