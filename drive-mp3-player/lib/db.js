// Bộ nhớ đệm MP3 bằng IndexedDB. Popup và offscreen document cùng origin
// (chrome-extension://<id>) nên dùng chung một database.

const DB_NAME = 'drive-mp3-cache';
const DB_VERSION = 1;
const STORE = 'files';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        try {
          result = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Transaction aborted'));
      })
  );
}

/** Lấy bản ghi đầy đủ (kèm blob). */
export function getFile(id) {
  return tx('readonly', (store) => store.get(id));
}

/** Lưu/ghi đè một file. record: { id, name, size, blob, cachedAt, source } */
export function putFile(record) {
  return tx('readwrite', (store) => store.put(record));
}

export function deleteFile(id) {
  return tx('readwrite', (store) => store.delete(id));
}

export function clearAll() {
  return tx('readwrite', (store) => store.clear());
}

/** Liệt kê tất cả file đã lưu. Blob chỉ là tham chiếu, không nạp vào RAM. */
export function listFiles() {
  return tx('readonly', (store) => store.getAll()).then((rows) =>
    (rows || []).sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0))
  );
}
