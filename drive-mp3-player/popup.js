import { formatTime, formatBytes } from './lib/util.js';
import { listFiles, putFile, deleteFile, clearAll } from './lib/db.js';
import { getToken, signOut, listMp3, uploadFile } from './lib/drive.js';

const $ = (id) => document.getElementById(id);
const el = {
  netPill: $('netPill'),
  netText: $('netText'),
  settingsBtn: $('settingsBtn'),
  signOutBtn: $('signOutBtn'),
  offlineBanner: $('offlineBanner'),
  loginView: $('loginView'),
  listView: $('listView'),
  settingsView: $('settingsView'),
  googleBtn: $('googleBtn'),
  guestBtn: $('guestBtn'),
  guestTitle: $('guestTitle'),
  searchInput: $('searchInput'),
  clearSearch: $('clearSearch'),
  uploadBtn: $('uploadBtn'),
  fileInput: $('fileInput'),
  tabs: $('tabs'),
  tabAll: $('tabAll'),
  tabCached: $('tabCached'),
  fileList: $('fileList'),
  emptyState: $('emptyState'),
  loadMoreBtn: $('loadMoreBtn'),
  backBtn: $('backBtn'),
  storageInfo: $('storageInfo'),
  clearAllBtn: $('clearAllBtn'),
  uploadOpt: $('uploadOpt'),
  uploadToDrive: $('uploadToDrive'),
  playerBar: $('playerBar'),
  nowPlaying: $('nowPlaying'),
  timeCurrent: $('timeCurrent'),
  timeTotal: $('timeTotal'),
  seekBar: $('seekBar'),
  backSkip: $('backSkip'),
  fwdSkip: $('fwdSkip'),
  playBtn: $('playBtn'),
  iconPlay: $('iconPlay'),
  iconPause: $('iconPause'),
  toast: $('toast')
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
  guest: false, // người dùng chọn "Nghe các file đã lưu Offline" khi chưa đăng nhập
  settingsOpen: false,
  tab: store.get('tab', 'all'), // 'all' | 'cached'
  query: '',
  driveFiles: [],
  nextPageToken: '',
  driveLoading: false,
  driveError: '',
  cached: [],
  player: null,
  dragging: false
};

let toastTimer = null;
let searchTimer = null;
let driveReqSeq = 0;

// ---------- Tiện ích ----------

const isOnline = () => navigator.onLine;

function toast(message, ms = 3000) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), ms);
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

/** Danh sách được xem là "có Drive": đã đăng nhập và có mạng. */
function driveAvailable() {
  return app.signedIn && isOnline();
}

function currentView() {
  if (app.settingsOpen) return 'settings';
  if (!app.signedIn && isOnline() && !app.guest) return 'login';
  return 'list';
}

function currentTab() {
  return driveAvailable() ? app.tab : 'cached';
}

// ---------- Hiển thị khung ----------

function render() {
  const online = isOnline();
  document.documentElement.dataset.net = online ? 'online' : 'offline';
  el.offlineBanner.hidden = online;

  const view = currentView();
  el.loginView.hidden = view !== 'login';
  el.listView.hidden = view !== 'list';
  el.settingsView.hidden = view !== 'settings';

  // Header: trạng thái mạng chỉ hiện khi không ở màn đăng nhập
  el.netPill.hidden = view === 'login';
  el.netText.textContent = online ? 'Online' : 'Offline';
  el.settingsBtn.hidden = false;
  el.signOutBtn.hidden = !app.signedIn;

  el.guestTitle.textContent = `Nghe các file đã lưu Offline (${app.cached.length} file)`;

  if (view === 'list') {
    renderTabs();
    renderList();
  }
  if (view === 'settings') renderSettings();
  renderPlayer();
}

function totalCachedSize() {
  return app.cached.reduce((sum, r) => sum + (r.size || 0), 0);
}

function localOnlyFiles() {
  return app.cached.filter((r) => r.source === 'local');
}

function renderTabs() {
  const tab = currentTab();
  const both = driveAvailable();
  el.tabAll.hidden = !both;

  const allCount = localOnlyFiles().length + app.driveFiles.length;
  el.tabAll.textContent = `Tất cả (${allCount}${app.nextPageToken ? '+' : ''})`;

  const size = app.cached.length ? ` • ${formatBytes(totalCachedSize())}` : '';
  el.tabCached.textContent = `Đã lưu Offline (${app.cached.length})${size}`;

  el.tabAll.classList.toggle('active', tab === 'all');
  el.tabCached.classList.toggle('active', tab === 'cached');
  el.tabAll.setAttribute('aria-selected', String(tab === 'all'));
  el.tabCached.setAttribute('aria-selected', String(tab === 'cached'));
}

function renderSettings() {
  el.storageInfo.textContent = app.cached.length
    ? `${app.cached.length} file • ${formatBytes(totalCachedSize())} đang lưu trên máy`
    : 'Chưa có file nào được lưu trên máy.';
  el.clearAllBtn.disabled = app.cached.length === 0;
  el.uploadOpt.hidden = !app.signedIn;
}

// ---------- Danh sách ----------

function matchQuery(name) {
  const q = app.query.trim().toLowerCase();
  return !q || name.toLowerCase().includes(q);
}

function visibleFiles() {
  const map = cachedMap();
  if (currentTab() === 'cached') {
    return app.cached
      .filter((r) => matchQuery(r.name))
      .map((r) => ({ id: r.id, name: r.name, size: r.size, duration: r.duration, source: r.source }));
  }
  const local = localOnlyFiles()
    .filter((r) => matchQuery(r.name))
    .map((r) => ({ id: r.id, name: r.name, size: r.size, duration: r.duration, source: 'local' }));
  const drive = app.driveFiles.map((f) => {
    const rec = map.get(f.id);
    return { id: f.id, name: f.name, size: f.size, duration: rec && rec.duration, source: 'drive' };
  });
  return local.concat(drive);
}

const SVG_CHECK =
  '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
const SVG_CLOUD =
  '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>';
const SVG_TRASH =
  '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

function renderList() {
  const files = visibleFiles();
  const map = cachedMap();
  const currentId = app.player && app.player.track ? app.player.track.id : null;
  const frag = document.createDocumentFragment();

  files.forEach((f) => {
    const rec = map.get(f.id);
    const li = document.createElement('li');
    li.className = 'file-item' + (f.id === currentId ? ' playing' : '');
    li.dataset.id = f.id;

    const icon = document.createElement('div');
    icon.className = 'status-icon' + (rec ? ' cached' : '');
    icon.innerHTML = rec ? SVG_CHECK : SVG_CLOUD;
    icon.title = rec ? 'Đã lưu — nghe được khi offline' : 'Trên Google Drive — cần mạng để tải';

    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = f.name;
    name.title = f.name;
    const meta = document.createElement('div');
    meta.className = 'file-meta';
    const parts = [];
    if (f.duration) parts.push(formatTime(f.duration));
    if (f.size) parts.push(formatBytes(f.size));
    if (f.source === 'local') parts.push('Từ máy tính');
    parts.push(rec ? 'Đã lưu Offline' : 'Trên Drive');
    meta.textContent = parts.join(' • ');
    info.append(name, meta);
    li.append(icon, info);

    if (rec) {
      const del = document.createElement('button');
      del.className = 'trash-btn';
      del.title = 'Xóa khỏi bộ nhớ máy để giải phóng dung lượng';
      del.setAttribute('aria-label', 'Xóa khỏi bộ nhớ máy');
      del.innerHTML = SVG_TRASH;
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
  el.loadMoreBtn.hidden = !(currentTab() === 'all' && app.nextPageToken && !app.driveLoading);
}

function emptyBox(title, text, btnLabel, onClick) {
  const box = el.emptyState;
  box.replaceChildren();
  const strong = document.createElement('strong');
  strong.textContent = title;
  box.appendChild(strong);
  if (text) box.appendChild(document.createTextNode(text));
  if (btnLabel) {
    const b = document.createElement('button');
    b.className = 'retry-btn';
    b.textContent = btnLabel;
    b.addEventListener('click', onClick);
    box.appendChild(b);
  }
  box.hidden = false;
}

function renderEmpty(count) {
  el.emptyState.hidden = true;
  if (count > 0) return;

  if (currentTab() === 'cached') {
    if (app.query) emptyBox('Không tìm thấy file nào', 'Thử từ khóa khác.');
    else emptyBox('Chưa có file nào được lưu', 'File sẽ tự động được lưu khi bạn phát lần đầu (cần mạng).');
  } else if (app.driveLoading) {
    emptyBox('Đang tải danh sách…', '');
  } else if (app.driveError) {
    emptyBox('Không tải được danh sách', app.driveError, 'Thử lại', () => loadDrive(true));
  } else if (app.query) {
    emptyBox('Không tìm thấy file nào', 'Thử từ khóa khác.');
  } else {
    emptyBox('Drive chưa có file MP3', 'Bạn có thể dùng nút Upload để thêm file.');
  }
}

async function loadDrive(reset) {
  if (!driveAvailable()) {
    render();
    return;
  }
  const seq = ++driveReqSeq;
  if (reset) {
    app.driveFiles = [];
    app.nextPageToken = '';
  }
  app.driveLoading = true;
  app.driveError = '';
  render();

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
      render();
    }
  }
}

// ---------- Cache (IndexedDB) ----------

async function refreshCache() {
  try {
    app.cached = await listFiles();
  } catch (e) {
    app.cached = [];
  }
  render();
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

// ---------- Trình phát ----------

function renderPlayer() {
  const p = app.player;
  const track = p && p.track;
  el.playerBar.hidden = !track;
  if (!track) return;

  el.nowPlaying.classList.remove('error');
  if (p.error) {
    el.nowPlaying.textContent = p.error;
    el.nowPlaying.classList.add('error');
  } else if (p.loading) {
    const pct = Math.round((p.progress || 0) * 100);
    el.nowPlaying.textContent =
      p.progress > 0 && p.progress < 1 ? `Đang tải xuống & lưu offline… ${pct}%` : `Đang chuẩn bị: ${track.name}`;
  } else {
    el.nowPlaying.textContent = `${p.playing ? 'Đang phát' : 'Tạm dừng'}: ${track.name}`;
  }
  el.nowPlaying.title = track.name;

  const busy = !!p.loading;
  el.playBtn.disabled = busy;
  el.backSkip.disabled = busy;
  el.fwdSkip.disabled = busy;
  el.seekBar.disabled = busy;
  // SVG không có thuộc tính .hidden như phần tử HTML nên phải dùng attribute
  el.iconPlay.toggleAttribute('hidden', !!p.playing);
  el.iconPause.toggleAttribute('hidden', !p.playing);

  const duration = p.duration || 0;
  const current = p.currentTime || 0;
  el.timeTotal.textContent = formatTime(duration);
  if (!app.dragging) {
    el.timeCurrent.textContent = formatTime(current);
    el.seekBar.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
  }

  el.fileList.querySelectorAll('.file-item').forEach((li) => {
    li.classList.toggle('playing', li.dataset.id === track.id);
  });
}

function toTrack(file) {
  const rec = cachedMap().get(file.id);
  return {
    id: file.id,
    name: file.name,
    size: file.size || (rec && rec.size) || 0,
    source: file.source || (rec && rec.source) || 'drive'
  };
}

function playTrack(file, list) {
  const track = toTrack(file);
  // Hàng đợi = danh sách đang hiển thị, hết bài sẽ tự chuyển bài kế
  const queue = (list && list.length ? list : [file]).slice(0, 300).map(toTrack);

  app.player = {
    ...(app.player || {}),
    track,
    loading: true,
    loaded: false,
    playing: false,
    progress: 0,
    currentTime: 0,
    duration: 0,
    error: null
  };
  renderPlayer();
  sendPlayer('load', { track, queue, autoplay: true, startAt: 0 }).then((res) => {
    if (res && res.error) toast(res.error);
  });
}

el.playBtn.addEventListener('click', () => sendPlayer('toggle'));
el.backSkip.addEventListener('click', () => sendPlayer('skip', { delta: -5 }));
el.fwdSkip.addEventListener('click', () => sendPlayer('skip', { delta: 5 }));

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
el.seekBar.addEventListener('pointerup', () => setTimeout(() => (app.dragging = false), 0));

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

// ---------- Tài khoản ----------

async function afterSignedIn() {
  app.signedIn = true;
  app.guest = false;
  store.set('signedIn', true);
  render();
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
  app.guest = false;
  app.settingsOpen = false;
  store.set('signedIn', false);
  app.driveFiles = [];
  app.nextPageToken = '';
  render();
  toast('Đã đăng xuất. File đã lưu offline vẫn còn trên máy.');
}

el.googleBtn.addEventListener('click', signIn);
el.guestBtn.addEventListener('click', () => {
  app.guest = true;
  render();
});
el.signOutBtn.addEventListener('click', doSignOut);
el.settingsBtn.addEventListener('click', () => {
  app.settingsOpen = true;
  render();
});
el.backBtn.addEventListener('click', () => {
  app.settingsOpen = false;
  render();
});
el.clearAllBtn.addEventListener('click', removeAllCache);

// ---------- Tabs + tìm kiếm ----------

function setTab(tab) {
  app.tab = tab;
  store.set('tab', tab);
  if (tab === 'all' && driveAvailable() && app.driveFiles.length === 0 && !app.driveLoading) loadDrive(true);
  else render();
}

el.tabAll.addEventListener('click', () => setTab('all'));
el.tabCached.addEventListener('click', () => setTab('cached'));
el.loadMoreBtn.addEventListener('click', () => loadDrive(false));

el.searchInput.addEventListener('input', () => {
  app.query = el.searchInput.value;
  el.clearSearch.hidden = !app.query;
  clearTimeout(searchTimer);
  if (currentTab() === 'all' && driveAvailable()) {
    searchTimer = setTimeout(() => loadDrive(true), 350);
  } else {
    render();
  }
});

el.clearSearch.addEventListener('click', () => {
  el.searchInput.value = '';
  el.searchInput.dispatchEvent(new Event('input'));
  el.searchInput.focus();
});

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
  if (source === 'drive' && driveAvailable()) loadDrive(true);
  const list = app.cached.map((r) => ({ id: r.id, name: r.name, size: r.size, source: r.source }));
  playTrack({ id, name, size, source }, list);
});

// ---------- Tin nhắn từ offscreen + mạng ----------

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== 'popup') return false;
  if (msg.type === 'state') {
    app.player = msg.state;
    renderPlayer();
  } else if (msg.type === 'cacheChanged') {
    refreshCache();
  }
  return false;
});

window.addEventListener('online', () => {
  render();
  if (app.signedIn) loadDrive(true);
});
window.addEventListener('offline', render);

// ---------- Khởi động ----------

async function init() {
  render();
  await refreshCache();

  try {
    await ensureOffscreen();
    const res = await sendPlayer('getState');
    if (res && res.state) {
      app.player = res.state;
      renderPlayer();
    }
  } catch (e) {
    /* bỏ qua */
  }

  if (app.signedIn && isOnline()) {
    try {
      await getToken({ interactive: false });
      await afterSignedIn();
    } catch (e) {
      app.signedIn = false;
      store.set('signedIn', false);
      render();
    }
  }
}

init();
