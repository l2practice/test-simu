import { formatTime, formatBytes, formatDate } from './lib/util.js';
import { listFiles, getFile, putFile, deleteFile, clearAll } from './lib/db.js';
import { getToken, signOut, getUserInfo, listMp3, uploadFile } from './lib/drive.js';

const $ = (id) => document.getElementById(id);
const el = {
  accountEmail: $('accountEmail'),
  signInBtn: $('signInBtn'),
  signOutBtn: $('signOutBtn'),
  offlineBanner: $('offlineBanner'),
  trackTitle: $('trackTitle'),
  trackStatus: $('trackStatus'),
  timeCurrent: $('timeCurrent'),
  timeTotal: $('timeTotal'),
  seekBar: $('seekBar'),
  backBtn: $('backBtn'),
  playBtn: $('playBtn'),
  fwdBtn: $('fwdBtn'),
  iconPlay: $('iconPlay'),
  iconPause: $('iconPause'),
  tabDrive: $('tabDrive'),
  tabCached: $('tabCached'),
  cachedCount: $('cachedCount'),
  searchInput: $('searchInput'),
  uploadBtn: $('uploadBtn'),
  fileInput: $('fileInput'),
  driveUploadRow: $('driveUploadRow'),
  uploadToDrive: $('uploadToDrive'),
  fileList: $('fileList'),
  emptyState: $('emptyState'),
  loadMoreBtn: $('loadMoreBtn'),
  cacheFooter: $('cacheFooter'),
  cacheInfo: $('cacheInfo'),
  clearAllBtn: $('clearAllBtn'),
  toast: $('toast'),
  prevBtn: $('prevBtn'),
  nextBtn: $('nextBtn'),
  shuffleBtn: $('shuffleBtn'),
  repeatBtn: $('repeatBtn'),
  repeatOne: $('repeatOne'),
  bars: $('bars'),
  tabSettings: $('tabSettings'),
  listView: $('listView'),
  settingsView: $('settingsView'),
  eqToggle: $('eqToggle'),
  eqBands: $('eqBands'),
  eqReset: $('eqReset'),
  themeDots: $('themeDots')
};

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* bỏ qua */
    }
  }
};

const app = {
  signedIn: store.get('signedIn', false),
  tab: store.get('tab', 'drive'), // 'drive' | 'cached'
  query: '',
  driveFiles: [],
  nextPageToken: '',
  driveLoading: false,
  driveError: '',
  cached: [], // bản ghi đã lưu trong IndexedDB
  player: null, // trạng thái từ offscreen
  dragging: false
};

let toastTimer = null;
let searchTimer = null;
let driveReqSeq = 0;

// ---------- Tiện ích ----------

function toast(message, ms = 3000) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), ms);
}

function isOnline() {
  return navigator.onLine;
}

function cachedMap() {
  return new Map(app.cached.map((r) => [r.id, r]));
}

async function ensureOffscreen() {
  await chrome.runtime.sendMessage({ target: 'background', type: 'ensureOffscreen' });
}

async function sendPlayer(type, payload = {}) {
  const msg = { target: 'offscreen', type, ...payload };
  try {
    const res = await chrome.runtime.sendMessage(msg);
    if (!res) throw new Error('no response');
    return res;
  } catch (e) {
    await ensureOffscreen();
    return chrome.runtime.sendMessage(msg);
  }
}

// ---------- Trình phát ----------

function renderPlayer() {
  const p = app.player;
  const track = p && p.track;

  el.trackTitle.textContent = track ? track.name.replace(/\.mp3$/i, '') : 'Chưa chọn bài hát';
  el.trackTitle.title = track ? track.name : '';
  el.trackStatus.classList.remove('error');

  if (!track) {
    el.trackStatus.textContent = 'Chọn một file bên dưới để nghe';
  } else if (p.error) {
    el.trackStatus.textContent = p.error;
    el.trackStatus.classList.add('error');
  } else if (p.loading) {
    const pct = Math.round((p.progress || 0) * 100);
    el.trackStatus.textContent = p.progress > 0 && p.progress < 1 ? `Đang tải xuống và lưu offline… ${pct}%` : 'Đang chuẩn bị…';
  } else if (p.playing) {
    el.trackStatus.textContent = 'Đang phát';
  } else {
    el.trackStatus.textContent = 'Đã tạm dừng';
  }

  el.playBtn.disabled = !track || p.loading;
  el.backBtn.disabled = !track || p.loading;
  el.fwdBtn.disabled = !track || p.loading;
  el.seekBar.disabled = !track || p.loading;
  el.prevBtn.disabled = !track || p.loading;
  el.nextBtn.disabled = !track || p.loading;
  const mode = (p && p.mode) || 'normal';
  el.shuffleBtn.setAttribute('aria-pressed', String(mode === 'shuffle'));
  el.repeatBtn.setAttribute('aria-pressed', String(mode === 'repeat-one'));
  el.repeatOne.hidden = mode !== 'repeat-one';
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (!(p && p.playing)) resetBars();
  el.iconPlay.hidden = !!(p && p.playing);
  el.iconPause.hidden = !(p && p.playing);
  el.playBtn.title = p && p.playing ? 'Tạm dừng (Space)' : 'Phát (Space)';

  const duration = p ? p.duration || 0 : 0;
  const current = p ? p.currentTime || 0 : 0;
  el.timeTotal.textContent = formatTime(duration);
  if (!app.dragging) {
    el.timeCurrent.textContent = formatTime(current);
    el.seekBar.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
  }

  // đánh dấu bài đang phát trong danh sách
  const id = track ? track.id : null;
  el.fileList.querySelectorAll('.file-item').forEach((li) => {
    li.classList.toggle('playing', li.dataset.id === id);
  });
}

function onPlayerState(state) {
  app.player = state;
  renderPlayer();
}

function toTrack(file) {
  const cached = cachedMap().get(file.id);
  return {
    id: file.id,
    name: file.name,
    size: file.size || (cached && cached.size) || 0,
    source: file.source || (cached && cached.source) || 'drive'
  };
}

function playTrack(file, list) {
  const track = toTrack(file);
  // Hàng đợi = danh sách đang hiển thị (đã lọc theo tìm kiếm)
  const queue = (list && list.length ? list : [file]).slice(0, 300).map(toTrack);
  // Cập nhật giao diện ngay, không chờ offscreen phản hồi
  app.player = { ...(app.player || {}), track, loading: true, loaded: false, playing: false, progress: 0, currentTime: 0, duration: 0, error: null };
  renderPlayer();
  sendPlayer('load', { track, queue, autoplay: true, startAt: 0 }).then((res) => {
    if (res && res.error) toast(res.error);
  });
}

// ---------- Cache (IndexedDB) ----------

async function refreshCache() {
  try {
    app.cached = await listFiles();
  } catch (e) {
    app.cached = [];
  }
  el.cachedCount.textContent = String(app.cached.length);
  renderList();
  renderFooter();
}

function renderFooter() {
  if (app.cached.length === 0) {
    el.cacheFooter.hidden = true;
    return;
  }
  const total = app.cached.reduce((sum, r) => sum + (r.size || 0), 0);
  el.cacheInfo.textContent = `${app.cached.length} file • ${formatBytes(total)} trên máy`;
  el.cacheFooter.hidden = false;
}

async function removeFromCache(file) {
  const rec = cachedMap().get(file.id);
  if (rec && rec.source === 'local') {
    if (!confirm(`"${rec.name}" là file tải từ máy tính và chỉ tồn tại trong bộ nhớ extension. Xóa sẽ mất hẳn. Tiếp tục?`)) return;
  }
  await deleteFile(file.id);
  toast('Đã xóa khỏi bộ nhớ máy');
  await refreshCache();
}

async function removeAllCache() {
  const hasLocal = app.cached.some((r) => r.source === 'local');
  const msg = hasLocal
    ? 'Xóa TẤT CẢ file đã lưu? Các file tải từ máy tính (không có trên Drive) sẽ mất hẳn.'
    : 'Xóa tất cả file đã lưu để giải phóng dung lượng? (File trên Drive vẫn còn nguyên)';
  if (!confirm(msg)) return;
  await clearAll();
  toast('Đã xóa toàn bộ bộ nhớ đệm');
  await refreshCache();
}

// ---------- Danh sách ----------

function visibleFiles() {
  const q = app.query.trim().toLowerCase();
  const byName = (f) => !q || f.name.toLowerCase().includes(q);

  if (app.tab === 'cached') {
    return app.cached.filter(byName).map((r) => ({
      id: r.id,
      name: r.name,
      size: r.size,
      date: r.cachedAt,
      source: r.source
    }));
  }
  return app.driveFiles.map((f) => ({ ...f, date: f.modifiedTime, source: 'drive' }));
}

function renderList() {
  const files = visibleFiles();
  const map = cachedMap();
  const frag = document.createDocumentFragment();
  const currentId = app.player && app.player.track ? app.player.track.id : null;

  files.forEach((f) => {
    const rec = map.get(f.id);
    const li = document.createElement('li');
    li.className = 'file-item' + (f.id === currentId ? ' playing' : '');
    li.dataset.id = f.id;

    const icon = document.createElement('div');
    icon.className = 'file-icon';
    icon.textContent = '♪';

    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = f.name;
    name.title = f.name;
    const meta = document.createElement('div');
    meta.className = 'file-meta';

    const parts = [];
    if (f.size) parts.push(formatBytes(f.size));
    const d = formatDate(f.date);
    if (d) parts.push(d);
    const metaText = document.createElement('span');
    metaText.textContent = parts.join(' • ');
    meta.appendChild(metaText);

    if (rec) {
      const badge = document.createElement('span');
      badge.className = 'badge-offline';
      badge.title = 'Đã lưu trên máy — nghe được khi offline';
      badge.textContent = '✓ Offline';
      meta.appendChild(badge);
    }
    if (rec && rec.source === 'local') {
      const local = document.createElement('span');
      local.className = 'badge-local';
      local.textContent = 'Từ máy tính';
      meta.appendChild(local);
    }

    info.append(name, meta);
    li.append(icon, info);

    if (rec) {
      const del = document.createElement('button');
      del.className = 'icon-btn';
      del.title = 'Xóa khỏi bộ nhớ máy để giải phóng dung lượng';
      del.setAttribute('aria-label', 'Xóa khỏi bộ nhớ máy');
      del.textContent = '🗑';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromCache(f);
      });
      li.appendChild(del);
    }

    li.addEventListener('click', () => playTrack(f, files));
    frag.appendChild(li);
  });

  el.fileList.replaceChildren(frag);
  renderEmpty(files.length);
  el.loadMoreBtn.hidden = !(app.tab === 'drive' && app.nextPageToken && !app.driveLoading);
}

function renderEmpty(count) {
  const box = el.emptyState;
  box.replaceChildren();
  box.hidden = true;
  if (count > 0) return;

  const strong = document.createElement('strong');
  const text = document.createElement('span');

  if (app.tab === 'cached') {
    strong.textContent = app.query ? 'Không tìm thấy file nào' : 'Chưa có file nào được lưu';
    text.textContent = app.query ? 'Thử từ khóa khác.' : 'File sẽ tự động được lưu khi bạn phát lần đầu.';
  } else if (!app.signedIn) {
    strong.textContent = 'Chưa kết nối Google Drive';
    text.textContent = 'Đăng nhập để xem các file MP3 trong Drive của bạn.';
    box.append(strong, text);
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Đăng nhập Google';
    btn.addEventListener('click', signIn);
    box.appendChild(btn);
    box.hidden = false;
    return;
  } else if (app.driveLoading) {
    strong.textContent = 'Đang tải danh sách…';
    text.textContent = '';
  } else if (app.driveError) {
    strong.textContent = 'Không tải được danh sách';
    text.textContent = app.driveError;
    box.append(strong, text);
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = 'Thử lại';
    btn.addEventListener('click', () => loadDrive(true));
    box.appendChild(btn);
    box.hidden = false;
    return;
  } else {
    strong.textContent = app.query ? 'Không tìm thấy file nào' : 'Drive chưa có file MP3';
    text.textContent = app.query ? 'Thử từ khóa khác.' : 'Bạn có thể dùng nút Upload để thêm file.';
  }
  box.append(strong, text);
  box.hidden = false;
}

async function loadDrive(reset) {
  if (!app.signedIn || !isOnline()) {
    renderList();
    return;
  }
  const seq = ++driveReqSeq;
  if (reset) {
    app.driveFiles = [];
    app.nextPageToken = '';
  }
  app.driveLoading = true;
  app.driveError = '';
  renderList();

  try {
    const { files, nextPageToken } = await listMp3({
      query: app.query,
      pageToken: reset ? '' : app.nextPageToken
    });
    if (seq !== driveReqSeq) return;
    app.driveFiles = reset ? files : app.driveFiles.concat(files);
    app.nextPageToken = nextPageToken;
  } catch (err) {
    if (seq !== driveReqSeq) return;
    app.driveError = err.message || String(err);
  } finally {
    if (seq === driveReqSeq) {
      app.driveLoading = false;
      renderList();
    }
  }
}

// ---------- Tabs / tìm kiếm ----------

function setTab(tab) {
  app.tab = tab;
  store.set('tab', tab);
  const tabs = { drive: el.tabDrive, cached: el.tabCached, settings: el.tabSettings };
  Object.entries(tabs).forEach(([name, btn]) => {
    btn.classList.toggle('active', tab === name);
    btn.setAttribute('aria-selected', String(tab === name));
  });
  el.listView.hidden = tab === 'settings';
  el.settingsView.hidden = tab !== 'settings';
  if (tab === 'settings') return;
  if (tab === 'drive' && app.signedIn && isOnline() && app.driveFiles.length === 0) {
    loadDrive(true);
  } else {
    renderList();
  }
}

el.tabDrive.addEventListener('click', () => setTab('drive'));
el.tabCached.addEventListener('click', () => setTab('cached'));
el.tabSettings.addEventListener('click', () => setTab('settings'));

el.searchInput.addEventListener('input', () => {
  app.query = el.searchInput.value;
  clearTimeout(searchTimer);
  if (app.tab === 'drive' && app.signedIn && isOnline()) {
    searchTimer = setTimeout(() => loadDrive(true), 350);
  } else {
    renderList();
  }
});

el.loadMoreBtn.addEventListener('click', () => loadDrive(false));
el.clearAllBtn.addEventListener('click', removeAllCache);

// ---------- Tài khoản ----------

function renderAccount(email) {
  el.signInBtn.hidden = app.signedIn;
  el.signOutBtn.hidden = !app.signedIn;
  el.accountEmail.hidden = !(app.signedIn && email);
  el.accountEmail.textContent = email || '';
  el.driveUploadRow.hidden = !app.signedIn;
}

async function afterSignedIn() {
  app.signedIn = true;
  store.set('signedIn', true);
  renderAccount('');
  getUserInfo()
    .then((u) => renderAccount(u.emailAddress || u.displayName || ''))
    .catch(() => {});
  await loadDrive(true);
}

async function signIn() {
  try {
    await getToken({ interactive: true });
    await afterSignedIn();
  } catch (err) {
    toast('Đăng nhập thất bại: ' + (err.message || err), 5000);
  }
}

async function doSignOut() {
  await signOut();
  app.signedIn = false;
  store.set('signedIn', false);
  app.driveFiles = [];
  app.nextPageToken = '';
  renderAccount('');
  renderList();
  toast('Đã đăng xuất. File đã lưu offline vẫn còn trên máy.');
}

el.signInBtn.addEventListener('click', signIn);
el.signOutBtn.addEventListener('click', doSignOut);

// ---------- Upload ----------

el.uploadToDrive.checked = store.get('uploadToDrive', false);
el.uploadToDrive.addEventListener('change', () => store.set('uploadToDrive', el.uploadToDrive.checked));

el.uploadBtn.addEventListener('click', () => el.fileInput.click());

el.fileInput.addEventListener('change', async () => {
  const file = el.fileInput.files && el.fileInput.files[0];
  el.fileInput.value = '';
  if (!file) return;

  if (!/\.mp3$/i.test(file.name) && file.type !== 'audio/mpeg') {
    toast('Vui lòng chọn file MP3');
    return;
  }

  let id = 'local-' + crypto.randomUUID();
  let name = file.name;
  let size = file.size;
  let source = 'local';

  if (app.signedIn && el.uploadToDrive.checked) {
    if (!isOnline()) {
      toast('Đang offline — chỉ lưu trên máy, không upload lên Drive được.');
    } else {
      toast('Đang tải lên Google Drive… (giữ popup mở đến khi xong)', 60000);
      try {
        const up = await uploadFile(file);
        id = up.id;
        name = up.name;
        size = up.size || file.size;
        source = 'drive';
        toast('Đã tải lên Drive');
      } catch (err) {
        toast('Upload Drive lỗi, chỉ lưu trên máy: ' + (err.message || err), 5000);
      }
    }
  }

  try {
    await putFile({ id, name, size, blob: file, cachedAt: Date.now(), source });
  } catch (err) {
    toast('Không lưu được file: ' + (err.message || err), 5000);
    return;
  }

  await refreshCache();
  if (source === 'drive') {
    app.driveFiles = [];
    if (app.tab === 'drive') loadDrive(true);
  } else {
    setTab('cached');
  }
  playTrack({ id, name, size, source }, app.cached.map((r) => ({ id: r.id, name: r.name, size: r.size, source: r.source })));
});

// ---------- Điều khiển phát ----------

el.playBtn.addEventListener('click', () => sendPlayer('toggle'));
el.backBtn.addEventListener('click', () => sendPlayer('skip', { delta: -5 }));
el.fwdBtn.addEventListener('click', () => sendPlayer('skip', { delta: 5 }));
el.prevBtn.addEventListener('click', () => sendPlayer('prev'));
el.nextBtn.addEventListener('click', () => sendPlayer('next'));

function currentMode() {
  return (app.player && app.player.mode) || 'normal';
}

function setMode(mode) {
  if (app.player) app.player.mode = mode;
  renderPlayer();
  sendPlayer('setMode', { mode });
}

el.shuffleBtn.addEventListener('click', () => setMode(currentMode() === 'shuffle' ? 'normal' : 'shuffle'));
el.repeatBtn.addEventListener('click', () => setMode(currentMode() === 'repeat-one' ? 'normal' : 'repeat-one'));
document.querySelectorAll('.mode-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// ---------- Thanh sóng nhạc ----------

const BAR_COUNT = 16;
for (let i = 0; i < BAR_COUNT; i++) el.bars.appendChild(document.createElement('span'));

function drawBars(levels) {
  const spans = el.bars.children;
  for (let i = 0; i < spans.length; i++) {
    const v = levels && levels[i] != null ? levels[i] : 0;
    spans[i].style.height = Math.max(3, Math.round(v * 26)) + 'px';
  }
}

function resetBars() {
  drawBars(null);
}

// ---------- Equalizer ----------

const EQ_LABELS = ['60Hz', '230Hz', '910Hz', '3.6kHz', '14kHz'];
let eq = store.get('eq', null);
if (!eq || !Array.isArray(eq.gains) || eq.gains.length !== EQ_LABELS.length) {
  eq = { enabled: false, gains: EQ_LABELS.map(() => 0) };
}

function saveEq() {
  store.set('eq', eq);
  sendPlayer('setEq', { eq });
}

function renderEq() {
  el.eqToggle.checked = eq.enabled;
  el.eqBands.classList.toggle('off', !eq.enabled);
  el.eqBands.querySelectorAll('input').forEach((input, i) => {
    input.value = String(eq.gains[i]);
  });
}

EQ_LABELS.forEach((label, i) => {
  const wrap = document.createElement('div');
  wrap.className = 'eq-band';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '-12';
  input.max = '12';
  input.step = '1';
  input.setAttribute('aria-label', 'Equalizer ' + label);
  input.addEventListener('input', () => {
    eq.gains[i] = Number(input.value);
    saveEq();
  });
  const name = document.createElement('span');
  name.textContent = label;
  wrap.append(input, name);
  el.eqBands.appendChild(wrap);
});

el.eqToggle.addEventListener('change', () => {
  eq.enabled = el.eqToggle.checked;
  renderEq();
  saveEq();
});
el.eqReset.addEventListener('click', () => {
  eq.gains = EQ_LABELS.map(() => 0);
  renderEq();
  saveEq();
});

// ---------- Giao diện (theme) ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  el.themeDots.querySelectorAll('.theme-dot').forEach((d) => d.classList.toggle('active', d.dataset.theme === theme));
  store.set('theme', theme);
}

el.themeDots.querySelectorAll('.theme-dot').forEach((d) => d.addEventListener('click', () => applyTheme(d.dataset.theme)));
applyTheme(store.get('theme', 'purple'));
renderEq();

// Thanh tiến trình: kéo thả để chọn vị trí, thả ra mới tua thật.
el.seekBar.addEventListener('pointerdown', () => (app.dragging = true));
el.seekBar.addEventListener('input', () => {
  app.dragging = true;
  const duration = app.player ? app.player.duration || 0 : 0;
  el.timeCurrent.textContent = formatTime((Number(el.seekBar.value) / 1000) * duration);
});
el.seekBar.addEventListener('change', () => {
  const duration = app.player ? app.player.duration || 0 : 0;
  const time = (Number(el.seekBar.value) / 1000) * duration;
  if (app.player) app.player.currentTime = time;
  app.dragging = false;
  sendPlayer('seek', { time });
});
el.seekBar.addEventListener('pointerup', () => {
  setTimeout(() => (app.dragging = false), 0);
});

document.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' && e.target.type !== 'range') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!el.playBtn.disabled) sendPlayer('toggle');
  } else if (e.code === 'ArrowLeft' && tag !== 'INPUT') {
    e.preventDefault();
    sendPlayer('skip', { delta: -5 });
  } else if (e.code === 'ArrowRight' && tag !== 'INPUT') {
    e.preventDefault();
    sendPlayer('skip', { delta: 5 });
  }
});

// ---------- Tin nhắn từ offscreen ----------

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== 'popup') return false;
  if (msg.type === 'state') onPlayerState(msg.state);
  else if (msg.type === 'viz') drawBars(msg.levels);
  else if (msg.type === 'cacheChanged') refreshCache();
  return false;
});

// ---------- Online / offline ----------

function updateOnlineUi() {
  el.offlineBanner.hidden = isOnline();
  el.tabDrive.disabled = false;
}

window.addEventListener('online', () => {
  updateOnlineUi();
  if (app.signedIn && app.tab === 'drive') loadDrive(true);
});
window.addEventListener('offline', () => {
  updateOnlineUi();
  setTab('cached');
});

// ---------- Khởi động ----------

async function init() {
  updateOnlineUi();
  renderAccount('');
  await refreshCache();

  // Đồng bộ với trình phát đang chạy nền
  try {
    await ensureOffscreen();
    await sendPlayer('setEq', { eq });
    const res = await sendPlayer('getState');
    if (res && res.state) onPlayerState(res.state);
  } catch (e) {
    /* bỏ qua */
  }

  if (!isOnline()) {
    setTab('cached');
    return;
  }

  setTab(app.tab);

  if (app.signedIn) {
    try {
      await getToken({ interactive: false });
      await afterSignedIn();
    } catch (e) {
      app.signedIn = false;
      store.set('signedIn', false);
      renderAccount('');
      renderList();
    }
  } else {
    renderList();
  }
}

init();
