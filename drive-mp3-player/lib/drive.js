// Gọi Google Drive REST API. Token lấy qua service worker (chrome.identity
// không dùng được trong offscreen document).

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';

export async function getToken({ interactive = false, invalidate = null } = {}) {
  const res = await chrome.runtime.sendMessage({
    target: 'background',
    type: 'getToken',
    interactive,
    invalidate
  });
  if (!res || res.error) {
    const e = new Error((res && res.error) || 'Could not reach the extension service worker');
    e.needsLogin = !!(res && res.needsLogin);
    throw e;
  }
  return res.token;
}

export async function getAuthInfo() {
  return chrome.runtime.sendMessage({ target: 'background', type: 'authInfo' });
}

export async function signOut() {
  await chrome.runtime.sendMessage({ target: 'background', type: 'signOut' });
}

/** fetch kèm Bearer token, tự làm mới token một lần nếu gặp 401. */
export async function driveFetch(url, options = {}, { interactive = false } = {}) {
  const run = (token) =>
    fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
    });

  let token = await getToken({ interactive });
  let res = await run(token);
  if (res.status === 401) {
    token = await getToken({ interactive, invalidate: token });
    res = await run(token);
  }
  return res;
}

async function throwIfError(res) {
  if (res.ok) return;
  let detail = '';
  try {
    const data = await res.json();
    detail = data.error && data.error.message ? data.error.message : '';
  } catch (e) {
    /* bỏ qua */
  }
  throw new Error(`Drive API ${res.status}${detail ? ': ' + detail : ''}`);
}

function escapeQuery(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function getUserInfo() {
  const res = await driveFetch(`${API}/about?fields=user(displayName,emailAddress)`);
  await throwIfError(res);
  const data = await res.json();
  return data.user || {};
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Accepts a Drive folder link or a bare folder ID and returns the ID.
 * Examples: https://drive.google.com/drive/folders/<id>?usp=sharing,
 *           https://drive.google.com/drive/u/0/folders/<id>, https://drive.google.com/open?id=<id>, <id>
 */
export function parseFolderId(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  const folders = text.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (folders) return folders[1];
  const idParam = text.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (idParam) return idParam[1];
  if (/^[A-Za-z0-9_-]{15,}$/.test(text)) return text;
  const file = text.match(/\/d\/([A-Za-z0-9_-]+)/);
  return file ? file[1] : '';
}

/** Folder name check: throws if the ID is not a folder or is not accessible. */
export async function getFolderInfo(id) {
  const res = await driveFetch(
    `${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType&supportsAllDrives=true`
  );
  if (res.status === 404) throw new Error('Folder not found, or your Google account has no access to it.');
  await throwIfError(res);
  const data = await res.json();
  if (data.mimeType !== FOLDER_MIME) throw new Error('That link is a file, not a folder. Paste a folder link.');
  return { id: data.id, name: data.id === id && id === 'root' ? 'My Drive' : data.name };
}

/** Lists the sub-folders and MP3 files directly inside a folder. Returns { folders, files, nextPageToken }. */
export async function listFolder({ folderId, query = '', pageToken = '' }) {
  let q =
    `'${escapeQuery(folderId)}' in parents and trashed=false and ` +
    `(mimeType='${FOLDER_MIME}' or mimeType='audio/mpeg' or name contains '.mp3')`;
  if (query.trim()) q += ` and name contains '${escapeQuery(query.trim())}'`;

  const params = new URLSearchParams({
    q,
    pageSize: '100',
    orderBy: 'folder,name',
    fields: 'nextPageToken,files(id,name,size,modifiedTime,mimeType)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true'
  });
  if (pageToken) params.set('pageToken', pageToken);

  const res = await driveFetch(`${API}/files?${params}`);
  await throwIfError(res);
  const data = await res.json();
  const items = data.files || [];
  const folders = items.filter((f) => f.mimeType === FOLDER_MIME).map((f) => ({ id: f.id, name: f.name }));
  const files = items
    .filter((f) => f.mimeType !== FOLDER_MIME && (/\.mp3$/i.test(f.name) || f.mimeType === 'audio/mpeg'))
    .map((f) => ({ id: f.id, name: f.name, size: Number(f.size) || 0, modifiedTime: f.modifiedTime }));
  return { folders, files, nextPageToken: data.nextPageToken || '' };
}

/** Tải toàn bộ file về dạng Blob, báo tiến độ 0..1 qua onProgress. */
export async function downloadFile(id, { size = 0, onProgress, signal } = {}) {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
    signal
  });
  await throwIfError(res);

  const total = Number(res.headers.get('Content-Length')) || size || 0;
  if (!res.body || !res.body.getReader) {
    const blob = await res.blob();
    if (onProgress) onProgress(1);
    return new Blob([blob], { type: 'audio/mpeg' });
  }

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress && total) onProgress(Math.min(received / total, 1));
  }
  if (onProgress) onProgress(1);
  return new Blob(chunks, { type: 'audio/mpeg' });
}

/** Upload file lên Drive (multipart). Trả về { id, name, size }. */
export async function uploadFile(file, parentId) {
  const metadata = { name: file.name, mimeType: 'audio/mpeg' };
  if (parentId && parentId !== 'root') metadata.parents = [parentId]; // upload into the open folder
  const boundary = 'drive_mp3_' + crypto.randomUUID();
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: audio/mpeg\r\n\r\n`,
    file,
    `\r\n--${boundary}--`
  ]);

  const res = await driveFetch(`${UPLOAD_API}?uploadType=multipart&supportsAllDrives=true&fields=id,name,size`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  await throwIfError(res);
  const data = await res.json();
  return { id: data.id, name: data.name, size: Number(data.size) || file.size };
}
