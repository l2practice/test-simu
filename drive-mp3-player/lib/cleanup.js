// Tự động dọn bộ nhớ đệm: xóa file lâu không nghe và giữ tổng dung lượng dưới giới hạn.
// File tải từ máy tính (source = 'local') không có bản trên Drive nên KHÔNG bao giờ bị tự xóa.

import { listFiles, deleteFile, getSettings, lastUsed } from './db.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * Trả về danh sách file đã xóa: [{ id, name, size, reason: 'expired' | 'size' }].
 * protectIds: các id không được xóa (ví dụ bài đang phát).
 */
export async function runCleanup({ protectIds = [] } = {}) {
  const { maxBytes, maxAgeDays } = await getSettings();
  const files = await listFiles(); // mới dùng nhất đứng đầu
  if (!files.length) return [];

  const protect = new Set(protectIds);
  if (files[0]) protect.add(files[0].id); // luôn giữ bài nghe gần nhất

  const removed = [];
  const remove = async (f, reason) => {
    await deleteFile(f.id);
    removed.push({ id: f.id, name: f.name, size: f.size || 0, reason });
  };
  const removable = (f) => f.source !== 'local' && !protect.has(f.id);

  // 1. Hết hạn: lâu không nghe
  let alive = files;
  if (maxAgeDays > 0) {
    const cutoff = Date.now() - maxAgeDays * DAY;
    const next = [];
    for (const f of alive) {
      if (removable(f) && lastUsed(f) < cutoff) await remove(f, 'expired');
      else next.push(f);
    }
    alive = next;
  }

  // 2. Vượt dung lượng: xóa file nghe lâu nhất trước
  if (maxBytes > 0) {
    let total = alive.reduce((sum, f) => sum + (f.size || 0), 0);
    const oldestFirst = alive.filter(removable).sort((a, b) => lastUsed(a) - lastUsed(b));
    for (const f of oldestFirst) {
      if (total <= maxBytes) break;
      await remove(f, 'size');
      total -= f.size || 0;
    }
  }

  return removed;
}
