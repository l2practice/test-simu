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

/** Liệt kê file MP3. Trả về { files, nextPageToken }. */
export async function listMp3({ query = '', pageToken = '' } = {}) {
  let q = "(mimeType='audio/mpeg' or name contains '.mp3') and trashed=false";
  if (query.trim()) q += ` and name contains '${escapeQuery(query.trim())}'`;

  const params = new URLSearchParams({
    q,
    pageSize: '50',
    orderBy: 'modifiedTime desc',
    fields: 'nextPageToken,files(id,name,size,modifiedTime,mimeType)'
  });
  if (pageToken) params.set('pageToken', pageToken);

  const res = await driveFetch(`${API}/files?${params}`);
  await throwIfError(res);
  const data = await res.json();
  const files = (data.files || [])
    .filter((f) => /\.mp3$/i.test(f.name) || f.mimeType === 'audio/mpeg')
    .map((f) => ({
      id: f.id,
      name: f.name,
      size: Number(f.size) || 0,
      modifiedTime: f.modifiedTime
    }));
  return { files, nextPageToken: data.nextPageToken || '' };
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
export async function uploadFile(file) {
  const metadata = { name: file.name, mimeType: 'audio/mpeg' };
  const boundary = 'drive_mp3_' + crypto.randomUUID();
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: audio/mpeg\r\n\r\n`,
    file,
    `\r\n--${boundary}--`
  ]);

  const res = await driveFetch(`${UPLOAD_API}?uploadType=multipart&fields=id,name,size`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  await throwIfError(res);
  const data = await res.json();
  return { id: data.id, name: data.name, size: Number(data.size) || file.size };
}
