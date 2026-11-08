export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

export function formatBytes(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do {
    bytes /= 1024;
    i++;
  } while (bytes >= 1024 && i < units.length - 1);
  return `${bytes.toFixed(bytes >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = typeof iso === 'number' ? new Date(iso) : new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
