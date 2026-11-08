// Offscreen document: giữ thẻ <audio> nên nhạc vẫn phát khi popup đóng.
// Chỉ chrome.runtime khả dụng ở đây, nên lưu trạng thái bằng localStorage.

import { getFile, putFile } from './lib/db.js';
import { downloadFile } from './lib/drive.js';

const audio = document.getElementById('player');
const LAST_KEY = 'lastState';

let state = {
  track: null, // { id, name, size, source: 'drive' | 'local' }
  playing: false,
  loading: false,
  loaded: false, // audio.src đã sẵn sàng
  progress: 0, // tiến độ tải 0..1
  currentTime: 0,
  duration: 0,
  error: null
};

let objectUrl = null;
let loadSeq = 0;
let abortCtl = null;
let lastPersist = 0;

// ---------- Trạng thái ----------

function broadcast() {
  chrome.runtime.sendMessage({ target: 'popup', type: 'state', state }).catch(() => {});
}

function persist(force = false) {
  const now = Date.now();
  if (!force && now - lastPersist < 2000) return;
  lastPersist = now;
  try {
    localStorage.setItem(
      LAST_KEY,
      JSON.stringify({
        track: state.track,
        currentTime: state.currentTime,
        duration: state.duration
      })
    );
  } catch (e) {
    /* bỏ qua */
  }
}

function syncFromAudio() {
  if (!state.loaded) return; // đang nạp bài mới: giữ nguyên vị trí đã đặt
  state.currentTime = audio.currentTime || 0;
  state.duration = isFinite(audio.duration) ? audio.duration : state.duration;
  state.playing = !audio.paused && !audio.ended;
}

function update(force = false) {
  syncFromAudio();
  persist(force);
  broadcast();
  updateMediaSession();
}

// ---------- Nạp bài hát ----------

function waitForMetadata() {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('Không giải mã được file MP3'));
    };
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', onOk);
      audio.removeEventListener('error', onErr);
    };
    audio.addEventListener('loadedmetadata', onOk);
    audio.addEventListener('error', onErr);
  });
}

async function loadTrack(track, { autoplay = true, startAt = 0 } = {}) {
  const seq = ++loadSeq;
  if (abortCtl) abortCtl.abort();
  abortCtl = null;

  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  state = {
    ...state,
    track,
    playing: false,
    loading: true,
    loaded: false,
    progress: 0,
    currentTime: startAt || 0,
    duration: 0,
    error: null
  };
  persist(true);
  broadcast();

  try {
    let record = await getFile(track.id);
    let blob = record && record.blob;

    if (!blob) {
      if (track.source === 'local') throw new Error('Không tìm thấy file đã lưu trên máy');
      if (!navigator.onLine) throw new Error('Đang offline và file này chưa được lưu để nghe offline');

      abortCtl = new AbortController();
      let lastSent = 0;
      blob = await downloadFile(track.id, {
        size: track.size,
        signal: abortCtl.signal,
        onProgress: (p) => {
          if (seq !== loadSeq) return;
          state.progress = p;
          const now = Date.now();
          if (now - lastSent > 150 || p >= 1) {
            lastSent = now;
            broadcast();
          }
        }
      });
      if (seq !== loadSeq) return;

      // Tự động lưu cache ngay lần phát đầu tiên
      await putFile({
        id: track.id,
        name: track.name,
        size: blob.size,
        blob,
        cachedAt: Date.now(),
        source: 'drive'
      });
      chrome.runtime.sendMessage({ target: 'popup', type: 'cacheChanged' }).catch(() => {});
    }
    if (seq !== loadSeq) return;

    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    audio.load();
    await waitForMetadata();
    if (seq !== loadSeq) return;

    if (startAt > 0 && isFinite(audio.duration)) {
      audio.currentTime = Math.min(startAt, Math.max(audio.duration - 0.1, 0));
    }

    state.loading = false;
    state.loaded = true;
    state.progress = 1;
    syncFromAudio();

    if (autoplay) await audio.play();
    update(true);
  } catch (err) {
    if (seq !== loadSeq || (err && err.name === 'AbortError')) return;
    state.loading = false;
    state.loaded = false;
    state.playing = false;
    state.error = err.message || String(err);
    broadcast();
  }
}

// ---------- Lệnh điều khiển ----------

async function play() {
  if (!state.track) return;
  if (!state.loaded) {
    await loadTrack(state.track, { autoplay: true, startAt: state.currentTime });
    return;
  }
  await audio.play();
}

function pause() {
  audio.pause();
}

function seekTo(time) {
  if (!state.loaded) {
    state.currentTime = Math.max(0, time);
    update(true);
    return;
  }
  const max = isFinite(audio.duration) ? audio.duration : time;
  audio.currentTime = Math.min(Math.max(0, time), max);
  update(true);
}

async function handle(msg) {
  switch (msg.type) {
    case 'getState':
      syncFromAudio();
      return { state };
    case 'load':
      await loadTrack(msg.track, { autoplay: msg.autoplay !== false, startAt: msg.startAt || 0 });
      return { ok: true };
    case 'play':
      await play();
      return { ok: true };
    case 'pause':
      pause();
      return { ok: true };
    case 'toggle':
      if (state.playing) pause();
      else await play();
      return { ok: true };
    case 'seek':
      seekTo(msg.time);
      return { ok: true };
    case 'skip':
      seekTo((state.loaded ? audio.currentTime : state.currentTime) + msg.delta);
      return { ok: true };
    default:
      return { error: 'Unknown message: ' + msg.type };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return false;
  handle(msg).then(sendResponse, (err) => sendResponse({ error: err.message || String(err) }));
  return true;
});

// ---------- Sự kiện thẻ audio ----------

['play', 'pause', 'ended', 'durationchange', 'seeked', 'playing', 'waiting'].forEach((ev) =>
  audio.addEventListener(ev, () => update(ev === 'pause' || ev === 'ended'))
);
audio.addEventListener('timeupdate', () => update(false));
audio.addEventListener('error', () => {
  if (!audio.src) return;
  state.error = 'Lỗi phát âm thanh';
  state.playing = false;
  broadcast();
});

// ---------- Media Session (phím media của bàn phím/tai nghe) ----------

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    if (state.track) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: state.track.name.replace(/\.mp3$/i, ''),
        artist: 'Drive MP3 Player'
      });
    }
    navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
  } catch (e) {
    /* bỏ qua */
  }
}

if ('mediaSession' in navigator) {
  const set = (action, fn) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch (e) {
      /* hành động không được hỗ trợ */
    }
  };
  set('play', () => play());
  set('pause', () => pause());
  set('seekbackward', () => seekTo(audio.currentTime - 5));
  set('seekforward', () => seekTo(audio.currentTime + 5));
  set('seekto', (d) => seekTo(d.seekTime));
}

// ---------- Khôi phục sau khi offscreen bị đóng (tạm dừng > 30s) ----------

(async function restore() {
  let last = null;
  try {
    last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
  } catch (e) {
    last = null;
  }
  if (!last || !last.track) return;

  state.track = last.track;
  state.currentTime = last.currentTime || 0;
  state.duration = last.duration || 0;

  // Nếu file đã có trong cache, nạp sẵn ở trạng thái tạm dừng để hiện đúng thời lượng.
  try {
    const record = await getFile(last.track.id);
    if (record && record.blob && !state.loading && !state.loaded) {
      await loadTrack(last.track, { autoplay: false, startAt: state.currentTime });
      return;
    }
  } catch (e) {
    /* bỏ qua */
  }
  broadcast();
})();
