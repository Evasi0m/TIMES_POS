// Shared TikTok order poll — same payload as E-Commerce "อัปเดตข้อมูล TikTok".
import { sb } from './supabase-client.js';

export async function pollTikTokOrders({ resync = true, hours = 720 } = {}) {
  const { data, error } = await sb.functions.invoke('tiktok-poll-orders', {
    body: { hours, resync },
  });
  if (error) {
    let msg = error.message || 'sync failed';
    try {
      const ctx = await error.context?.json?.();
      if (ctx?.error) msg = ctx.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.ok === false) throw new Error(data.error || 'sync failed');
  return data;
}

export function formatPollToast(data, { beforeCount, afterCount } = {}) {
  const imported = Number(data?.imported ?? 0);
  const updated = Number(data?.updated ?? 0);
  const changed = imported + updated;
  const capped = data?.capped === true;
  let base = `อัปเดตแล้ว — นำเข้า ${imported} · อัปเดต ${updated}`;
  if (changed > 0) {
    base += ` · เปลี่ยนแปลง ${changed} รายการ`;
  }
  if (beforeCount != null && afterCount != null) {
    const delta = afterCount - beforeCount;
    if (delta > 0) {
      base += ` · คิวรอยืนยัน +${delta} (${beforeCount}→${afterCount})`;
    } else if (delta < 0) {
      base += ` · คิวรอยืนยัน ${delta} (${beforeCount}→${afterCount})`;
    } else {
      base += ` · คิวรอยืนยัน ${afterCount} รายการ`;
    }
  }
  return {
    message: capped ? `${base} (ยังมีต่อ — กดอีกครั้งเพื่อ sync ส่วนที่เหลือ)` : base,
    level: changed > 0 || (afterCount != null && afterCount !== beforeCount) ? 'success' : 'info',
  };
}
