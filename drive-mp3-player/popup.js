import { formatTime, formatBytes } from './lib/util.js';
import { listFiles, getFile, putFile, deleteFile, clearAll, getSettings, saveSettings, setOrder, lastUsed, MB } from './lib/db.js';
import { runCleanup } from './lib/cleanup.js';
import { getToken, signOut, listFolder, getFolderInfo, parseFolderId, uploadFile, getAuthInfo } from './lib/drive.js';

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
  floatBtn: $('floatBtn'),
  miniBtn: $('miniBtn'),
  miniIcon: $('miniIcon'),
  selectBtn: $('selectBtn'),
  selectBar: $('selectBar'),
  selCount: $('selCount'),
  selAllBtn: $('selAllBtn'),
  selPlayBtn: $('selPlayBtn'),
  selCancelBtn: $('selCancelBtn'),
  redirectUri: $('redirectUri'),
  copyUriBtn: $('copyUriBtn'),
  folderBar: $('folderBar'),
  folderUpBtn: $('folderUpBtn'),
  folderName: $('folderName'),
  pinBtn: $('pinBtn'),
  folderPicker: $('folderPicker'),
  folderLink: $('folderLink'),
  openFolderBtn: $('openFolderBtn'),
  folderLinkError: $('folderLinkError'),
  myDriveBtn: $('myDriveBtn'),
  pinsTitle: $('pinsTitle'),
  pinList: $('pinList'),
  reorderHint: $('reorderHint'),
  listSummary: $('listSummary'),
  closeTrackBtn: $('closeTrackBtn'),
  saveStatus: $('saveStatus'),
  timeRemain: $('timeRemain'),
  authInfo: $('authInfo'),
  waveCanvas: $('waveCanvas'),
  waveWrap: $('waveWrap'),
  waveTip: $('waveTip'),
  autoCacheToggle: $('autoCacheToggle'),
  autoNextToggle: $('autoNextToggle'),
  maxAgeSelect: $('maxAgeSelect'),
  maxSizeSelect: $('maxSizeSelect'),
  cleanNowBtn: $('cleanNowBtn'),
  speedWrap: $('speedWrap'),
  speedBtn: $('speedBtn'),
  speedMenu: $('speedMenu'),
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
  driveFolders: [], // sub-folders of the open folder
  folder: null, // the open Drive folder { id, name } or null (start screen)
  folderStack: [], // folders we came from, for the Back button
  pins: store.get('pins', []),
  nextPageToken: '',
  driveLoading: false,
  driveError: '',
  cached: [],
  player: null,
  autoCache: false,
  selectMode: false,
  selected: new Set(),
  dragId: null,
  compact: store.get('compact', false),
  peaks: null, // { id, data } dạng sóng của bài đang mở
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

  el.guestTitle.textContent = `Listen to offline files (${app.cached.length} ${app.cached.length === 1 ? 'file' : 'files'})`;

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

/** Danh sách đã lưu theo thứ tự người dùng sắp xếp; file chưa có thứ tự xếp sau, mới nghe gần đây hơn lên trước. */
function sortedCached() {
  return app.cached.slice().sort((a, b) => {
    const ao = a.order ?? Infinity;
    const bo = b.order ?? Infinity;
    if (ao !== bo) return ao - bo;
    return lastUsed(b) - lastUsed(a);
  });
}

function localOnlyFiles() {
  return sortedCached().filter((r) => r.source === 'local');
}

function renderTabs() {
  const tab = currentTab();
  const both = driveAvailable();
  el.tabAll.hidden = !both;

  el.tabAll.textContent = app.folder ? `Drive (${app.driveFiles.length}${app.nextPageToken ? '+' : ''})` : 'Drive';

  const size = app.cached.length ? ` • ${formatBytes(totalCachedSize())}` : '';
  el.tabCached.textContent = `Saved offline (${app.cached.length})${size}`;

  el.tabAll.classList.toggle('active', tab === 'all');
  el.tabCached.classList.toggle('active', tab === 'cached');
  el.tabAll.setAttribute('aria-selected', String(tab === 'all'));
  el.tabCached.setAttribute('aria-selected', String(tab === 'cached'));
}

function renderSettings() {
  el.storageInfo.textContent = app.cached.length
    ? `${app.cached.length} ${app.cached.length === 1 ? 'file' : 'files'} • ${formatBytes(totalCachedSize())} stored on this device`
    : 'No files are stored on this device.';
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
    return sortedCached()
      .filter((r) => matchQuery(r.name))
      .map((r) => ({ id: r.id, name: r.name, size: r.size, duration: r.duration, source: r.source }));
  }
  return app.driveFiles.map((f) => {
    const rec = map.get(f.id);
    return { id: f.id, name: f.name, size: f.size, duration: rec && rec.duration, source: 'drive' };
  });
}

const SVG_CHECK =
  '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>';
const SVG_CLOUD =
  '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>';
const SVG_MONITOR =
  '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M20 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h6v2H8v2h8v-2h-2v-2h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 12H4V5h16v10z"/></svg>';
const SVG_CLOUD_SM =
  '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>';
const SVG_TRASH =
  '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

function renderList() {
  const onDrive = currentTab() === 'all';
  const showPicker = onDrive && !app.folder;
  el.folderPicker.hidden = !showPicker;
  el.folderBar.hidden = !(onDrive && app.folder);
  el.searchInput.disabled = showPicker;
  el.searchInput.placeholder = showPicker ? 'Open a folder to search it…' : 'Search MP3 files…';
  if (showPicker) {
    renderPicker();
    el.fileList.replaceChildren();
    el.emptyState.hidden = true;
    el.loadMoreBtn.hidden = true;
    el.reorderHint.hidden = true;
    el.listSummary.hidden = true;
    renderSelectBar([]);
    return;
  }
  if (onDrive && app.folder) renderFolderBar();

  const files = visibleFiles();
  const map = cachedMap();
  const currentId = app.player && app.player.track ? app.player.track.id : null;
  const frag = document.createDocumentFragment();

  // Sub-folders first (Drive tab only)
  if (onDrive) {
    app.driveFolders.forEach((folder) => {
      const li = document.createElement('li');
      li.className = 'file-item folder-item';
      const glyph = document.createElement('span');
      glyph.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>';
      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = folder.name;
      name.title = folder.name;
      const chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.textContent = '›';
      li.append(glyph, name, chevron);
      li.addEventListener('click', () => openFolder(folder.id, folder.name, { push: true }));
      frag.appendChild(li);
    });
  }
  const reorderable = currentTab() === 'cached' && !app.query && !app.selectMode && files.length > 1;
  if (reorderable) {
    el.reorderHint.textContent = 'Drag ⋮⋮ to set the play order. Press a file to load it, then press ▶ to play.';
    el.reorderHint.hidden = false;
  } else if (onDrive && files.length > 0 && !app.selectMode) {
    el.reorderHint.textContent =
      'Press ☑ to choose the files you want. Chosen files are saved to "Saved offline" and removed automatically after the days set in Settings (90 by default).';
    el.reorderHint.hidden = false;
  } else {
    el.reorderHint.hidden = true;
  }
  updateSummary();

  files.forEach((f) => {
    const rec = map.get(f.id);
    const li = document.createElement('li');
    li.className = 'file-item' + (f.id === currentId ? ' playing' : '');
    li.dataset.id = f.id;
    if (app.selectMode) {
      const picked = app.selected.has(f.id);
      li.classList.toggle('picked', picked);
      const box = document.createElement('div');
      box.className = 'pick-box';
      box.textContent = '✓';
      li.appendChild(box);
    }

    if (reorderable) {
      const grip = document.createElement('span');
      grip.className = 'grip';
      grip.textContent = '⋮⋮';
      grip.title = 'Drag to reorder';
      li.appendChild(grip);
      li.draggable = true;
      li.addEventListener('dragstart', (e) => {
        app.dragId = f.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', f.id);
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => {
        app.dragId = null;
        li.classList.remove('dragging');
        clearDropMarks();
      });
      li.addEventListener('dragover', (e) => {
        if (!app.dragId || app.dragId === f.id) return;
        e.preventDefault();
        const r = li.getBoundingClientRect();
        clearDropMarks();
        li.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
      });
      li.addEventListener('drop', async (e) => {
        e.preventDefault();
        const after = li.classList.contains('drop-after');
        clearDropMarks();
        if (app.dragId && app.dragId !== f.id) await moveItem(files.map((x) => x.id), app.dragId, f.id, after);
      });
    }

    // One compact row: name on the left, small info on the right
    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = f.name;
    name.title = f.name;

    const meta = document.createElement('div');
    meta.className = 'file-meta';
    const parts = [];
    if (f.duration) parts.push(formatTime(f.duration));
    if (f.size) parts.push(formatBytes(f.size));
    if (parts.length) {
      const text = document.createElement('span');
      text.textContent = parts.join(' • ');
      meta.appendChild(text);
    }
    if (f.source === 'local') {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = 'local';
      chip.title = 'Uploaded from your computer';
      meta.appendChild(chip);
    }
    const state = document.createElement('span');
    state.className = 'state-icon' + (rec ? ' cached' : '');
    state.innerHTML = rec ? SVG_MONITOR : SVG_CLOUD_SM;
    state.title = rec ? 'Saved on this device, available offline' : 'On Google Drive, needs internet to play';
    meta.appendChild(state);

    li.append(name, meta);

    if (rec && !app.selectMode) {
      const del = document.createElement('button');
      del.className = 'trash-btn';
      del.title = 'Remove from this device to free up space';
      del.setAttribute('aria-label', 'Remove from this device');
      del.innerHTML = SVG_TRASH;
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromCache(f);
      });
      li.appendChild(del);
    }

    li.addEventListener('click', () => {
      if (app.selectMode) togglePick(f.id);
      else openTrack(f, onDrive ? [f] : files); // loads it paused: audio starts only when you press ▶
    });
    frag.appendChild(li);
  });

  el.fileList.replaceChildren(frag);
  renderSelectBar(files);
  renderEmpty(files.length + (onDrive ? app.driveFolders.length : 0));
  el.loadMoreBtn.hidden = !(currentTab() === 'all' && app.nextPageToken && !app.driveLoading);
}

// ---------- Chọn nhiều file ----------

function selectedFiles() {
  return visibleFiles().filter((f) => app.selected.has(f.id));
}

function renderSelectBar(files) {
  el.selectBar.hidden = !app.selectMode;
  el.selectBtn.classList.toggle('active', app.selectMode);
  if (!app.selectMode) return;
  const n = files.filter((f) => app.selected.has(f.id)).length;
  el.selCount.textContent = String(n);
  el.selPlayBtn.disabled = n === 0;
  el.selAllBtn.textContent = n === files.length && n > 0 ? 'None' : 'All';
  el.selPlayBtn.textContent = currentTab() === 'all' ? '▶ Play & save' : '▶ Play';
}

function setSelectMode(on) {
  app.selectMode = on;
  if (!on) app.selected.clear();
  renderList();
}

function togglePick(id) {
  if (app.selected.has(id)) app.selected.delete(id);
  else app.selected.add(id);
  renderList();
}

el.selectBtn.addEventListener('click', () => setSelectMode(!app.selectMode));
el.selCancelBtn.addEventListener('click', () => setSelectMode(false));
el.selAllBtn.addEventListener('click', () => {
  const files = visibleFiles();
  const allPicked = files.length > 0 && files.every((f) => app.selected.has(f.id));
  files.forEach((f) => (allPicked ? app.selected.delete(f.id) : app.selected.add(f.id)));
  renderList();
});
el.selPlayBtn.addEventListener('click', () => {
  const picked = selectedFiles(); // keeps the order shown in the list
  if (!picked.length) return;
  const fromDrive = currentTab() === 'all';
  setSelectMode(false);
  // Files picked on Drive are downloaded and kept in "Saved offline" while they play
  openTrack(picked[0], picked, { save: fromDrive, autoplay: true }); // you pressed a Play button
  if (fromDrive) toast(`Saving ${picked.length} file${picked.length > 1 ? 's' : ''} to Saved offline while they play…`, 4000);
});

/** "N files • Total • Remaining" for the saved list (the play queue), using known durations. */
function updateSummary() {
  const files = visibleFiles();
  if (currentTab() !== 'cached' || files.length === 0) {
    el.listSummary.hidden = true;
    return;
  }
  const durs = files.map((f) => f.duration || 0);
  const total = durs.reduce((a, b) => a + b, 0);
  const p = app.player;
  const idx = p && p.track ? files.findIndex((f) => f.id === p.track.id) : -1;
  let remaining = total;
  if (idx >= 0) {
    const after = durs.slice(idx + 1).reduce((a, b) => a + b, 0);
    const own = (p.duration || durs[idx] || 0) - (p.currentTime || 0);
    remaining = after + Math.max(0, own);
  }
  const unknown = files.filter((f) => !f.duration).length;
  el.listSummary.textContent =
    `${files.length} ${files.length === 1 ? 'file' : 'files'} • Total ${formatTime(total)} • Remaining ${formatTime(remaining)}` +
    (unknown ? ` (${unknown} still measuring…)` : '');
  el.listSummary.hidden = false;
}

function clearDropMarks() {
  el.fileList.querySelectorAll('.drop-before, .drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
}

async function moveItem(ids, dragId, targetId, after) {
  const next = ids.filter((id) => id !== dragId);
  const at = next.indexOf(targetId);
  if (at < 0) return;
  next.splice(at + (after ? 1 : 0), 0, dragId);
  await setOrder(next);
  await refreshCache();
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
    if (app.query) emptyBox('No files found', 'Try a different keyword.');
    else if (app.autoCache) emptyBox('No saved files yet', 'Files are saved automatically the first time you play them (needs internet).');
    else emptyBox('No saved files yet', 'Auto-save is off, so files only play temporarily. Turn on "Save files for offline listening" in ⚙ Settings to listen without internet.');
  } else if (app.driveLoading) {
    emptyBox('Loading list…', '');
  } else if (app.driveError) {
    const disabled = /has not been used|is disabled|SERVICE_DISABLED/i.test(app.driveError);
    if (disabled) {
      // Drive API is not enabled in the user's Google Cloud project: explain and link to the fix
      const project = (app.driveError.match(/project[= ](\d{6,})/i) || [])[1];
      const url = 'https://console.developers.google.com/apis/api/drive.googleapis.com/overview' + (project ? '?project=' + project : '');
      emptyBox(
        'Google Drive API is not enabled',
        'Enable it for your Google Cloud project, wait a minute or two, then try again.',
        'Open the Enable page',
        () => window.open(url, '_blank')
      );
      const retry = document.createElement('button');
      retry.className = 'retry-btn';
      retry.textContent = 'Try again';
      retry.addEventListener('click', () => loadDrive(true));
      el.emptyState.appendChild(retry);
    } else {
      emptyBox('Could not load the list', app.driveError, 'Try again', () => loadDrive(true));
    }
  } else if (app.query) {
    emptyBox('No files found', 'Try a different keyword.');
  } else {
    emptyBox('This folder is empty', 'No MP3 files or sub-folders here. Use the Upload button to add files.');
  }
}

async function loadDrive(reset) {
  if (!driveAvailable() || !app.folder) {
    render();
    return;
  }
  const seq = ++driveReqSeq;
  if (reset) {
    app.driveFiles = [];
    app.driveFolders = [];
    app.nextPageToken = '';
  }
  app.driveLoading = true;
  app.driveError = '';
  render();

  try {
    const { folders, files, nextPageToken } = await listFolder({
      folderId: app.folder.id,
      query: app.query,
      pageToken: reset ? '' : app.nextPageToken
    });
    if (seq !== driveReqSeq) return;
    app.driveFiles = reset ? files : app.driveFiles.concat(files);
    app.driveFolders = reset ? folders : app.driveFolders.concat(folders);
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

// ---------- Drive folders ----------

function isPinned(id) {
  return app.pins.some((p) => p.id === id);
}

function savePins() {
  store.set('pins', app.pins);
}

function renderFolderBar() {
  el.folderName.textContent = app.folder.name;
  el.folderName.title = app.folder.name;
  const pinned = isPinned(app.folder.id);
  el.pinBtn.textContent = pinned ? '★' : '☆';
  el.pinBtn.classList.toggle('pinned', pinned);
  el.pinBtn.title = pinned ? 'Unpin this folder' : 'Pin this folder';
}

function renderPicker() {
  el.pinsTitle.hidden = app.pins.length === 0;
  const frag = document.createDocumentFragment();
  app.pins.forEach((pin) => {
    const li = document.createElement('li');
    li.className = 'pin-item';
    const glyph = document.createElement('span');
    glyph.style.flex = 'none';
    glyph.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" style="color:var(--accent2)"><path fill="currentColor" d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>';
    const name = document.createElement('span');
    name.textContent = pin.name;
    name.title = pin.name;
    const remove = document.createElement('button');
    remove.className = 'pin-remove';
    remove.textContent = '✕';
    remove.title = 'Remove from pinned folders';
    remove.addEventListener('click', (e) => {
      e.stopPropagation();
      app.pins = app.pins.filter((p) => p.id !== pin.id);
      savePins();
      renderPicker();
    });
    li.append(glyph, name, remove);
    li.addEventListener('click', () => openFolder(pin.id, pin.name));
    frag.appendChild(li);
  });
  el.pinList.replaceChildren(frag);
}

async function openFolder(id, name, { push = false } = {}) {
  if (push && app.folder) app.folderStack.push(app.folder);
  app.folder = { id, name: name || '…' };
  store.set('lastFolder', app.folder);
  app.selected.clear();
  app.selectMode = false;
  app.query = '';
  el.searchInput.value = '';
  el.clearSearch.hidden = true;
  await loadDrive(true);
}

function closeFolder() {
  app.folder = null;
  app.folderStack = [];
  app.driveFiles = [];
  app.driveFolders = [];
  app.nextPageToken = '';
  app.driveError = '';
  store.set('lastFolder', null);
  render();
}

async function goUp() {
  const prev = app.folderStack.pop();
  if (prev) await openFolder(prev.id, prev.name);
  else closeFolder();
}

async function submitFolderLink() {
  const id = parseFolderId(el.folderLink.value);
  el.folderLinkError.hidden = true;
  if (!id) {
    el.folderLinkError.textContent = 'Paste a Google Drive folder link (drive.google.com/drive/folders/…).';
    el.folderLinkError.hidden = false;
    return;
  }
  el.openFolderBtn.disabled = true;
  el.openFolderBtn.textContent = 'Opening…';
  try {
    const info = await getFolderInfo(id);
    el.folderLink.value = '';
    app.folderStack = [];
    await openFolder(info.id, info.name);
  } catch (err) {
    el.folderLinkError.textContent = err.message || String(err);
    el.folderLinkError.hidden = false;
  } finally {
    el.openFolderBtn.disabled = false;
    el.openFolderBtn.textContent = 'Open';
  }
}

el.openFolderBtn.addEventListener('click', submitFolderLink);
el.folderLink.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitFolderLink();
});
el.myDriveBtn.addEventListener('click', () => {
  app.folderStack = [];
  openFolder('root', 'My Drive');
});
el.folderUpBtn.addEventListener('click', goUp);
el.pinBtn.addEventListener('click', () => {
  if (!app.folder) return;
  if (isPinned(app.folder.id)) app.pins = app.pins.filter((p) => p.id !== app.folder.id);
  else app.pins = app.pins.concat([{ id: app.folder.id, name: app.folder.name }]);
  savePins();
  renderFolderBar();
});

// ---------- Cache (IndexedDB) ----------

async function refreshCache() {
  try {
    app.cached = await listFiles();
  } catch (e) {
    app.cached = [];
  }
  render();
}

/** Close the player: stop audio and forget the current track. */
async function stopPlayer() {
  app.player = null;
  app.peaks = null;
  renderPlayer();
  renderList();
  try {
    await sendPlayer('stop');
  } catch (e) {
    /* ignore */
  }
}

function currentTrackIsLocal() {
  const t = app.player && app.player.track;
  return !!t && t.source === 'local';
}

async function removeFromCache(file) {
  const rec = cachedMap().get(file.id);
  if (rec && rec.source === 'local') {
    if (!confirm(`"${rec.name}" was uploaded from your computer and only exists in the extension's storage. Deleting it is permanent. Continue?`)) return;
  }
  await deleteFile(file.id);
  const cur = app.player && app.player.track;
  if (cur && cur.id === file.id && cur.source === 'local') await stopPlayer(); // nothing left to play
  toast('Removed from this device');
  await refreshCache();
}

async function removeAllCache() {
  const hasLocal = app.cached.some((r) => r.source === 'local');
  const msg = hasLocal
    ? 'Delete ALL saved files? Files uploaded from your computer (not on Drive) will be lost permanently.'
    : 'Delete all saved files to free up space? (Files on Drive are not affected)';
  if (!confirm(msg)) return;
  const stopLocal = currentTrackIsLocal();
  await clearAll();
  if (stopLocal) await stopPlayer();
  toast('Cache cleared');
  await refreshCache();
}

// ---------- Dạng sóng ----------

const WAVE_BARS = 120;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Vẽ dạng sóng của cả file. Phần đã phát sáng màu, phần chưa phát mờ hơn; chỗ im lặng là thanh phẳng. */
function drawWave(progress) {
  const canvas = el.waveCanvas;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const p = app.player;
  const data = app.peaks && p && p.track && app.peaks.id === p.track.id ? app.peaks.data : null;
  const slot = w / WAVE_BARS;
  const barW = Math.max(1.5, slot * 0.62);
  const played = cssVar('--accent2') || '#a78bfa';
  const unplayed = 'rgba(255,255,255,0.28)';
  const minH = 3;
  const RULER_H = 16; // dải thước thời gian ở đáy
  const waveH = h - RULER_H;

  for (let i = 0; i < WAVE_BARS; i++) {
    const v = data ? data[i] / 255 : 0;
    const bh = Math.max(minH, v * (waveH - 4));
    const x = i * slot + (slot - barW) / 2;
    g.fillStyle = (i + 0.5) / WAVE_BARS <= progress ? played : unplayed;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, (waveH - bh) / 2, barW, bh, barW / 2);
    else g.rect(x, (waveH - bh) / 2, barW, bh);
    g.fill();
  }

  drawRuler(g, w, h, waveH, p ? p.duration || 0 : 0);
}

const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

function tickLabel(t) {
  return t < 60 ? `${t}s` : formatTime(t);
}

/** Thước thời gian: vạch + nhãn theo giây/phút, tự chọn khoảng cách vừa mắt. */
function drawRuler(g, w, h, waveH, duration) {
  if (!(duration > 0)) return;
  const minGap = 46; // px tối thiểu giữa hai nhãn
  const step = TICK_STEPS.find((s) => (s / duration) * w >= minGap) || TICK_STEPS[TICK_STEPS.length - 1];

  g.font = '10px system-ui, sans-serif';
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(169,163,201,0.9)';
  g.strokeStyle = 'rgba(169,163,201,0.55)';
  g.lineWidth = 1;

  let lastRight = -Infinity;
  for (let t = 0; t <= duration; t += step) {
    const x = Math.round((t / duration) * w) + 0.5;
    const label = tickLabel(t);
    const tw = g.measureText(label).width;
    // nhãn căn giữa vạch, nhưng không tràn ra ngoài hai mép
    let lx = x - tw / 2;
    lx = Math.max(0, Math.min(w - tw, lx));
    g.beginPath();
    g.moveTo(x, waveH + 1);
    g.lineTo(x, waveH + 5);
    g.stroke();
    if (lx > lastRight + 6 && x + tw / 2 <= w + 1) {
      g.fillText(label, lx, h - 1);
      lastRight = lx + tw;
    }
  }
}

// Rê chuột trên sóng để xem chính xác thời điểm đó là giây thứ mấy
el.waveWrap.addEventListener('mousemove', (e) => {
  const duration = app.player ? app.player.duration || 0 : 0;
  if (!(duration > 0)) return;
  const rect = el.waveWrap.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  el.waveTip.textContent = formatTime(ratio * duration);
  el.waveTip.style.left = Math.min(rect.width - 22, Math.max(22, ratio * rect.width)) + 'px';
  el.waveTip.hidden = false;
});
el.waveWrap.addEventListener('mouseleave', () => (el.waveTip.hidden = true));

function currentProgress() {
  if (app.dragging) return Number(el.seekBar.value) / 1000;
  const p = app.player;
  return p && p.duration > 0 ? Math.min(1, (p.currentTime || 0) / p.duration) : 0;
}

// ---------- Tự động dọn dẹp ----------

function describeRemoved(removed) {
  const bytes = removed.reduce((sum, r) => sum + r.size, 0);
  return `Automatically removed ${removed.length} old ${removed.length === 1 ? 'file' : 'files'} (${formatBytes(bytes)})`;
}

async function cleanup(showWhenEmpty = false) {
  const protectIds = app.player && app.player.track ? [app.player.track.id] : [];
  let removed = [];
  try {
    removed = await runCleanup({ protectIds });
  } catch (e) {
    /* bỏ qua */
  }
  if (removed.length) {
    await refreshCache();
    toast(describeRemoved(removed), 4500);
  } else if (showWhenEmpty) {
    toast('Nothing to clean up');
  }
}

async function loadCleanupSettings() {
  try {
    const s = await getSettings();
    el.maxAgeSelect.value = String(s.maxAgeDays);
    el.maxSizeSelect.value = String(Math.round(s.maxBytes / MB));
    el.autoCacheToggle.checked = !!s.autoCache;
    el.autoNextToggle.checked = !!s.autoNext;
    app.autoCache = !!s.autoCache;
    renderList();
  } catch (e) {
    /* bỏ qua */
  }
}

async function onCleanupSettingChange() {
  await saveSettings({
    maxAgeDays: Number(el.maxAgeSelect.value),
    maxBytes: Number(el.maxSizeSelect.value) * MB,
    autoCache: el.autoCacheToggle.checked,
    autoNext: el.autoNextToggle.checked
  });
  app.autoCache = el.autoCacheToggle.checked;
  renderList();
  await cleanup();
}

el.maxAgeSelect.addEventListener('change', onCleanupSettingChange);
el.maxSizeSelect.addEventListener('change', onCleanupSettingChange);
el.autoCacheToggle.addEventListener('change', onCleanupSettingChange);
el.autoNextToggle.addEventListener('change', onCleanupSettingChange);
el.cleanNowBtn.addEventListener('click', () => cleanup(true));

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
      p.progress > 0 && p.progress < 1 ? (p.saving ? `Downloading and saving offline… ${pct}%` : `Downloading… ${pct}%`) : `Preparing: ${track.name}`;
  } else {
    el.nowPlaying.textContent = `${p.playing ? 'Now playing' : 'Paused'}: ${track.name}`;
  }
  el.nowPlaying.title = track.name;
  if (p.prefetch) {
    el.saveStatus.textContent = `⬇ Saving for offline: ${p.prefetch.done}/${p.prefetch.total}`;
    el.saveStatus.hidden = false;
  } else {
    el.saveStatus.hidden = true;
  }
  renderSpeed();
  updateSummary();

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
    el.timeRemain.textContent = '-' + formatTime(Math.max(0, duration - current));
    el.seekBar.value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
  }
  drawWave(currentProgress());

  el.fileList.querySelectorAll('.file-item').forEach((li) => {
    li.classList.toggle('playing', li.dataset.id === track.id);
  });
}

// ---------- Tốc độ phát (giống YouTube) ----------

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function speedLabel(v) {
  return v === 1 ? 'Normal' : String(v);
}

function currentSpeed() {
  return (app.player && app.player.speed) || 1;
}

function renderSpeed() {
  const cur = currentSpeed();
  el.speedBtn.textContent = cur + 'x';
  el.speedMenu.querySelectorAll('.speed-opt').forEach((b) => {
    const active = Number(b.dataset.speed) === cur;
    b.classList.toggle('active', active);
    b.setAttribute('aria-checked', String(active));
  });
}

function setSpeed(v) {
  if (app.player) app.player.speed = v;
  renderSpeed();
  closeSpeedMenu();
  sendPlayer('setSpeed', { speed: v });
}

function closeSpeedMenu() {
  el.speedMenu.hidden = true;
  el.speedBtn.setAttribute('aria-expanded', 'false');
}

SPEEDS.forEach((v) => {
  const b = document.createElement('button');
  b.className = 'speed-opt';
  b.dataset.speed = String(v);
  b.setAttribute('role', 'menuitemradio');
  const check = document.createElement('span');
  check.className = 'speed-check';
  check.textContent = '✓';
  const label = document.createElement('span');
  label.textContent = speedLabel(v);
  b.append(check, label);
  b.addEventListener('click', () => setSpeed(v));
  el.speedMenu.appendChild(b);
});

el.speedBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = el.speedMenu.hidden;
  el.speedMenu.hidden = !open;
  el.speedBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => {
  if (!el.speedWrap.contains(e.target)) closeSpeedMenu();
});

function stepSpeed(dir) {
  const i = SPEEDS.indexOf(currentSpeed());
  const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, i + dir))];
  if (next !== currentSpeed()) setSpeed(next);
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

/** Puts a file in the player. It only starts playing if opts.autoplay is true (an explicit Play button). */
function openTrack(file, list, opts = {}) {
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
  if (app.peaks && app.peaks.id !== track.id) app.peaks = null;
  renderPlayer();
  sendPlayer('load', { track, queue, autoplay: !!opts.autoplay, startAt: 0, save: !!opts.save }).then((res) => {
    if (res && res.error) toast(res.error);
  });
}

el.closeTrackBtn.addEventListener('click', stopPlayer);
el.playBtn.addEventListener('click', () => sendPlayer('toggle'));
el.backSkip.addEventListener('click', () => sendPlayer('skip', { delta: -5 }));
el.fwdSkip.addEventListener('click', () => sendPlayer('skip', { delta: 5 }));

// Thanh tiến trình: kéo thả để chọn vị trí, thả ra mới tua thật.
el.seekBar.addEventListener('pointerdown', () => (app.dragging = true));
el.seekBar.addEventListener('input', () => {
  app.dragging = true;
  const duration = app.player ? app.player.duration || 0 : 0;
  const at = (Number(el.seekBar.value) / 1000) * duration;
  el.timeCurrent.textContent = formatTime(at);
  el.timeRemain.textContent = '-' + formatTime(Math.max(0, duration - at));
  drawWave(currentProgress());
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
  if (e.shiftKey && (e.key === '>' || e.key === '.')) {
    e.preventDefault();
    stepSpeed(1);
  } else if (e.shiftKey && (e.key === '<' || e.key === ',')) {
    e.preventDefault();
    stepSpeed(-1);
  } else if (e.code === 'Space') {
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
  // Reopen the folder you were last in; otherwise show the folder chooser
  const last = store.get('lastFolder', null);
  if (!app.folder && last && last.id) await openFolder(last.id, last.name);
  else if (app.folder) await loadDrive(true);
}

async function signIn() {
  try {
    await getToken({ interactive: true });
    await afterSignedIn();
  } catch (err) {
    toast('Sign-in failed: ' + (err.message || err) + ' (see ⚙ Settings for the Redirect URI)', 8000);
  }
}

async function doSignOut() {
  await signOut();
  app.signedIn = false;
  app.guest = false;
  app.settingsOpen = false;
  store.set('signedIn', false);
  app.driveFiles = [];
  app.driveFolders = [];
  app.folder = null;
  app.folderStack = [];
  store.set('lastFolder', null);
  app.nextPageToken = '';
  render();
  toast('Signed out. Files saved offline are still on this device.');
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
  if (tab === 'all' && driveAvailable() && app.folder && app.driveFiles.length === 0 && app.driveFolders.length === 0 && !app.driveLoading) loadDrive(true);
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

/** Read an MP3's duration from its metadata (no playback). Returns 0 if it cannot be read. */
function readDuration(blob) {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    const url = URL.createObjectURL(blob);
    let finished = false;
    const done = (value) => {
      if (finished) return;
      finished = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.onloadedmetadata = () => done(isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    audio.src = url;
  });
}

let backfilling = false;
/** Saved files that do not have a duration yet (older uploads) get measured in the background. */
async function backfillDurations() {
  if (backfilling) return;
  backfilling = true;
  try {
    for (const rec of app.cached.filter((r) => !r.duration && r.blob)) {
      const duration = await readDuration(rec.blob);
      if (!duration) continue;
      const fresh = await getFile(rec.id);
      if (fresh) await putFile({ ...fresh, duration });
      const mine = app.cached.find((r) => r.id === rec.id);
      if (mine) mine.duration = duration;
      render();
    }
  } catch (e) {
    /* ignore */
  } finally {
    backfilling = false;
  }
}

async function addOneFile(file, toDrive, order) {
  let id = 'local-' + crypto.randomUUID();
  let name = file.name;
  let size = file.size;
  let source = 'local';

  if (toDrive) {
    try {
      const up = await uploadFile(file, app.folder && app.folder.id); // into the open folder, or My Drive
      id = up.id;
      name = up.name;
      size = up.size || file.size;
      source = 'drive';
    } catch (err) {
      toast('Drive upload failed for "' + file.name + '", saved on this device only: ' + (err.message || err), 5000);
    }
  }
  const duration = await readDuration(file);
  await putFile({ id, name, size, blob: file, cachedAt: Date.now(), source, order, duration: duration || undefined });
  return { id, name, size, source };
}

el.fileInput.addEventListener('change', async () => {
  const picked = Array.from(el.fileInput.files || []);
  const files = picked.filter((f) => /\.mp3$/i.test(f.name) || f.type === 'audio/mpeg');
  const skipped = picked.length - files.length;
  el.fileInput.value = '';
  if (!files.length) {
    toast('Please choose MP3 files');
    return;
  }

  const wantsDrive = app.signedIn && el.uploadToDrive.checked;
  const toDrive = wantsDrive && isOnline();
  if (wantsDrive && !isOnline()) toast('You are offline: saving on this device only, not uploading to Drive.');

  // Fix the current order first so new files are appended at the end of the list
  const existing = sortedCached();
  try {
    await setOrder(existing.map((r) => r.id));
  } catch (e) {
    /* ignore */
  }

  const added = [];
  for (let i = 0; i < files.length; i++) {
    toast(
      `Processing ${i + 1}/${files.length}: ${files[i].name}` + (toDrive ? ' (keep this window open until done)' : ''),
      60000
    );
    try {
      added.push(await addOneFile(files[i], toDrive, existing.length + added.length));
    } catch (err) {
      toast('Could not save "' + files[i].name + '": ' + (err.message || err), 5000);
    }
  }
  if (!added.length) return;

  await refreshCache();
  if (added.some((t) => t.source === 'drive') && driveAvailable()) loadDrive(true);
  if (added.some((t) => t.source === 'local') || !driveAvailable()) setTab('cached');
  // Do not auto-play: let the user arrange the order and press play themselves
  toast(
    `Added ${added.length} file${added.length > 1 ? 's' : ''}` +
      (skipped ? ` (${skipped} non-MP3 skipped)` : '') +
      '. Drag ⋮⋮ to arrange, press a file to load it, then press ▶ to play.',
    6000
  );
});

// ---------- Tin nhắn từ offscreen + mạng ----------

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.target !== 'popup') return false;
  if (msg.type === 'state') {
    app.player = msg.state;
    if (app.peaks && msg.state.track && app.peaks.id !== msg.state.track.id) app.peaks = null;
    renderPlayer();
  } else if (msg.type === 'peaks') {
    app.peaks = { id: msg.trackId, data: msg.peaks };
    drawWave(currentProgress());
  } else if (msg.type === 'cacheChanged') {
    refreshCache().then(backfillDurations);
  }
  return false;
});

window.addEventListener('online', () => {
  render();
  if (app.signedIn) loadDrive(true);
});
window.addEventListener('offline', render);

// ---------- Cửa sổ nổi + thu nhỏ ----------

const isWindow = new URLSearchParams(location.search).has('window');
document.documentElement.classList.toggle('win', isWindow);
el.floatBtn.hidden = isWindow;
el.miniBtn.hidden = !isWindow;

el.floatBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ target: 'background', type: 'openFloating' });
  window.close(); // đóng popup trên thanh công cụ, chỉ còn cửa sổ nổi
});

async function resizeWindowTo(innerW, innerH) {
  try {
    const win = await chrome.windows.getCurrent();
    const dw = window.outerWidth - window.innerWidth;
    const dh = window.outerHeight - window.innerHeight;
    await chrome.windows.update(win.id, { width: innerW + dw, height: innerH + dh });
  } catch (e) {
    /* bỏ qua */
  }
}

function applyCompact(resize) {
  document.documentElement.classList.toggle('compact', isWindow && app.compact);
  el.miniIcon.innerHTML =
    isWindow && app.compact
      ? '<path fill="currentColor" d="M5 5h14v14H5V5zm2 2v10h10V7H7z"/>'
      : '<path fill="currentColor" d="M19 13H5v-2h14v2z"/>';
  el.miniBtn.title = app.compact ? 'Expand' : 'Minimize';
  if (resize && isWindow) resizeWindowTo(400, app.compact ? 255 : 640);
  renderPlayer();
}

el.miniBtn.addEventListener('click', () => {
  app.compact = !app.compact;
  store.set('compact', app.compact);
  applyCompact(true);
});

// ---------- Redirect URI (để cấu hình OAuth) ----------

try {
  el.redirectUri.textContent = chrome.identity.getRedirectURL();
} catch (e) {
  el.redirectUri.textContent = '(unavailable)';
}
el.copyUriBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(el.redirectUri.textContent);
    toast('Redirect URI copied');
  } catch (e) {
    toast('Select the text and copy it manually');
  }
});

async function showAuthInfo() {
  try {
    const info = await getAuthInfo();
    el.authInfo.textContent = info.persistent
      ? 'Stay-signed-in is ON (refresh token). You should not need to sign in again unless you revoke access.'
      : 'Stay-signed-in is OFF: sign-in lasts about 1 hour per token. Add CLIENT_SECRET in config.js to stay signed in (see README).';
  } catch (e) {
    /* ignore */
  }
}

// ---------- Startup ----------

async function init() {
  applyCompact(false);
  render();
  await refreshCache();
  backfillDurations();
  await loadCleanupSettings();
  cleanup();

  try {
    await ensureOffscreen();
    const res = await sendPlayer('getState');
    if (res && res.state) {
      app.player = res.state;
      app.peaks = res.peaks || null;
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
      if (e.needsLogin) {
        // The session really ended (revoked, expired refresh token, no Google session)
        app.signedIn = false;
        store.set('signedIn', false);
        render();
        toast('Your Google session ended. Please sign in again.', 5000);
      } else {
        // Temporary problem (network etc.): stay signed in
        app.driveError = e.message || String(e);
        render();
      }
    }
  }
  showAuthInfo();
}

init();
