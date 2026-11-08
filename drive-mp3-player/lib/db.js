// Bộ nhớ đệm MP3 bằng IndexedDB. Popup, offscreen document và service worker
// cùng origin (chrome-extension://<id>) nên dùng chung một database.
//
// Store "files": { id, name, size, blob, cachedAt, lastPlayedAt, duration, peaks, source }
// Store "meta":  { key, value }  (lưu cài đặt dọn dẹp)

const DB_NAME = 'drive-mp3-cache';
const DB_VERSION = 2;
const FILES = 'files';
const META = 'meta';

export const MB = 1024 * 1024;

export const DEFAULT_SETTINGS = {
  maxBytes: 500 * MB, // 0 = không giới hạn
  maxAgeDays: 90 // 0 = không tự xóa theo thời gian
};

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        let request;
        try {
          request = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = () => resolve(request && 'result' in request ? request.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Transaction aborted'));
      })
  );
}

/** Lấy bản ghi đầy đủ (kèm blob). */
export function getFile(id) {
  return tx(FILES, 'readonly', (store) => store.get(id));
}

/** Lưu/ghi đè một file. */
export function putFile(record) {
  return tx(FILES, 'readwrite', (store) => store.put(record));
}

export function deleteFile(id) {
  return tx(FILES, 'readwrite', (store) => store.delete(id));
}

export function clearAll() {
  return tx(FILES, 'readwrite', (store) => store.clear());
}

/** Liệt kê tất cả file đã lưu. Blob chỉ là tham chiếu, không nạp vào RAM. */
export function listFiles() {
  return tx(FILES, 'readonly', (store) => store.getAll()).then((rows) =>
    (rows || []).sort((a, b) => lastUsed(b) - lastUsed(a))
  );
}

/** Thời điểm dùng gần nhất: lần phát cuối, nếu chưa có thì lúc lưu. */
export function lastUsed(rec) {
  return rec.lastPlayedAt || rec.cachedAt || 0;
}

export async function getSettings() {
  const row = await tx(META, 'readonly', (store) => store.get('settings'));
  return { ...DEFAULT_SETTINGS, ...((row && row.value) || {}) };
}

export function saveSettings(settings) {
  return tx(META, 'readwrite', (store) => store.put({ key: 'settings', value: settings }));
}
