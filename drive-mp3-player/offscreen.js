// Offscreen document: giữ thẻ <audio> nên nhạc vẫn phát khi popup đóng.
// Chỉ chrome.runtime khả dụng ở đây, nên lưu trạng thái bằng localStorage.

import { getFile, putFile, getSettings } from './lib/db.js';
import { downloadFile } from './lib/drive.js';
import { runCleanup } from './lib/cleanup.js';

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
  error: null,
  queue: [], // danh sách bài đang mở (để tự chuyển bài)
  index: -1,
  mode: readMode(), // 'normal' | 'repeat-one' | 'shuffle'
  speed: readSpeed(), // tốc độ phát 0.25 – 2
  saving: false // true nếu file đang tải sẽ được lưu vào máy
};

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function readSpeed() {
  try {
    const v = Number(localStorage.getItem('speed'));
    return SPEEDS.includes(v) ? v : 1;
  } catch (e) {
    return 1;
  }
}

function applySpeed() {
  audio.defaultPlaybackRate = state.speed;
  audio.playbackRate = state.speed;
  audio.preservesPitch = true; // đổi tốc độ nhưng giữ nguyên cao độ giọng, giống YouTube
}

function readMode() {
  try {
    const m = localStorage.getItem('mode');
    return m === 'repeat-one' || m === 'shuffle' ? m : 'normal';
  } catch (e) {
    return 'normal';
  }
}

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
        duration: state.duration,
        queue: state.queue
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

// ---------- Dạng sóng (tính trước cho cả file) ----------

const WAVE_BARS = 120;
const MAX_WAVE_BYTES = 80 * 1024 * 1024; // file quá lớn thì bỏ qua để tránh tốn RAM khi giải mã
let peaksFor = null; // { id, data } của bài đang mở

let recordQueue = Promise.resolve();
/** Cập nhật một phần bản ghi cache, xếp hàng để các lần ghi không đè lên nhau. */
function patchRecord(id, patch) {
  recordQueue = recordQueue
    .then(async () => {
      const rec = await getFile(id);
      if (rec) await putFile({ ...rec, ...patch });
    })
    .catch(() => {});
  return recordQueue;
}

function notifyCacheChanged() {
  chrome.runtime.sendMessage({ target: 'popup', type: 'cacheChanged' }).catch(() => {});
}

function setPeaks(id, data) {
  peaksFor = { id, data };
  chrome.runtime.sendMessage({ target: 'popup', type: 'peaks', trackId: id, peaks: data }).catch(() => {});
}

/** Giải mã MP3 ở 8 kHz (nhẹ) rồi lấy mức âm lượng RMS của WAVE_BARS đoạn đều nhau. */
async function computePeaks(blob) {
  if (blob.size > MAX_WAVE_BYTES) return null;
  const octx = new OfflineAudioContext(1, 8000, 8000);
  const buffer = await octx.decodeAudioData(await blob.arrayBuffer());
  const len = buffer.length;
  if (!len) return null;

  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));

  const rms = new Array(WAVE_BARS).fill(0);
  for (let i = 0; i < WAVE_BARS; i++) {
    const from = Math.floor((i * len) / WAVE_BARS);
    const to = Math.max(from + 1, Math.floor(((i + 1) * len) / WAVE_BARS));
    let sum = 0;
    for (const data of channels) {
      for (let j = from; j < to; j++) sum += data[j] * data[j];
    }
    rms[i] = Math.sqrt(sum / ((to - from) * channels.length));
  }

  // Chuẩn hóa theo phân vị 95% để vài tiếng động lớn không làm phần còn lại bị lép
  const sorted = rms.slice().sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1] || 1;
  return rms.map((v) => {
    const n = v / ref;
    if (n < 0.04) return 0; // coi như im lặng
    return Math.round(Math.min(1, Math.sqrt(n)) * 255);
  });
}

async function ensurePeaks(track, blob, record, seq) {
  let data = record && record.peaks;
  if (!data) {
    try {
      data = await computePeaks(blob);
    } catch (e) {
      data = null;
    }
    if (!data) return;
    patchRecord(track.id, { peaks: data }).then(notifyCacheChanged);
  }
  if (seq === loadSeq) setPeaks(track.id, data);
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
      reject(new Error('Could not decode the MP3 file'));
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

  peaksFor = null;
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
    index: state.queue.findIndex((t) => t.id === track.id),
    playing: false,
    saving: false,
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
      if (track.source === 'local') throw new Error('Saved file not found on this device');
      if (!navigator.onLine) throw new Error('You are offline and this file is not saved for offline listening');

      const { autoCache } = await getSettings();
      state.saving = !!autoCache;
      broadcast();

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

      // Chỉ lưu xuống ổ đĩa khi bật "Tự lưu file"; nếu tắt thì file chỉ nằm tạm trong RAM
      if (autoCache) {
        await putFile({
          id: track.id,
          name: track.name,
          size: blob.size,
          blob,
          cachedAt: Date.now(),
          source: 'drive'
        });
        // Giữ tổng dung lượng dưới giới hạn (không xóa bài vừa tải)
        await runCleanup({ protectIds: [track.id] }).catch(() => {});
        notifyCacheChanged();
      }
    }
    if (seq !== loadSeq) return;

    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    applySpeed();
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

    // Ghi thời lượng vào bản ghi cache để popup hiển thị trong danh sách
    if (isFinite(audio.duration) && !(record && record.duration)) {
      patchRecord(track.id, { duration: audio.duration }).then(notifyCacheChanged);
    }
    // Ghi nhận lần nghe gần nhất để tính hạn 90 ngày
    if (autoplay) patchRecord(track.id, { lastPlayedAt: Date.now() });
    // Tính dạng sóng ở nền, không chặn việc phát nhạc
    ensurePeaks(track, blob, record, seq);

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

function pickNext(auto) {
  const q = state.queue;
  if (!q.length) return null;
  if (state.mode === 'shuffle') {
    if (q.length === 1) return q[0];
    let i;
    do {
      i = Math.floor(Math.random() * q.length);
    } while (i === state.index);
    return q[i];
  }
  const i = state.index + 1;
  if (i < q.length) return q[i];
  return auto ? null : q[0]; // tự phát hết danh sách thì dừng; bấm Next thì quay vòng
}

async function nextTrack(auto = false) {
  if (auto && state.mode === 'repeat-one') {
    audio.currentTime = 0;
    await audio.play();
    return;
  }
  const next = pickNext(auto);
  if (next) await loadTrack(next, { autoplay: true });
}

async function prevTrack() {
  if (state.loaded && audio.currentTime > 3) {
    seekTo(0);
    return;
  }
  const q = state.queue;
  if (!q.length) return;
  const i = state.index <= 0 ? q.length - 1 : state.index - 1;
  await loadTrack(q[i], { autoplay: true });
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
      return { state, peaks: peaksFor };
    case 'load':
      if (Array.isArray(msg.queue)) state.queue = msg.queue.slice(0, 300);
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
    case 'next':
      await nextTrack(false);
      return { ok: true };
    case 'prev':
      await prevTrack();
      return { ok: true };
    case 'setMode':
      state.mode = msg.mode;
      try {
        localStorage.setItem('mode', msg.mode);
      } catch (e) {
        /* bỏ qua */
      }
      broadcast();
      return { ok: true };
    case 'setSpeed': {
      const v = Number(msg.speed);
      if (!SPEEDS.includes(v)) return { error: 'Invalid playback speed' };
      state.speed = v;
      applySpeed();
      try {
        localStorage.setItem('speed', String(v));
      } catch (e) {
        /* bỏ qua */
      }
      broadcast();
      return { ok: true };
    }
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
audio.addEventListener('ended', () => {
  nextTrack(true).catch(() => {});
});
audio.addEventListener('timeupdate', () => update(false));
audio.addEventListener('error', () => {
  if (!audio.src) return;
  state.error = 'Audio playback error';
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
  set('nexttrack', () => nextTrack(false));
  set('previoustrack', () => prevTrack());
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
  state.queue = Array.isArray(last.queue) ? last.queue : [];
  state.index = state.queue.findIndex((t) => t.id === last.track.id);

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
