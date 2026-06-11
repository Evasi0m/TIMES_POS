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
  const voided = Number(data?.voided ?? 0);
  const changed = imported + updated + voided;
  const capped = data?.capped === true;
  const awaitingFound = Number(data?.awaiting_found ?? 0);
  const staleFound = Number(data?.stale_found ?? 0);
  const staleRefreshed = Number(data?.stale_refreshed ?? 0);

  let base = `อัปเดตแล้ว — นำเข้า ${imported} · อัปเดต ${updated}`;
  if (voided > 0) {
    base += ` · ยกเลิก ${voided}`;
  }
  if (changed > 0) {
    base += ` · เปลี่ยนแปลง ${changed} รายการ`;
  }
  if (awaitingFound > 0) {
    base += ` · TikTok ที่จะจัดส่ง ${awaitingFound}`;
  }
  if (staleFound > 0) {
    base += staleRefreshed > 0
      ? ` · เคลียร์สถานะค้าง ${staleRefreshed}/${staleFound}`
      : ` · สถานะค้างใน POS ${staleFound} (กำลัง sync)`;
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
  if (capped) {
    base += ' (ยังมีต่อ — กดอีกครั้งเพื่อ sync ส่วนที่เหลือ)';
  }
  const hadStaleWork = staleFound > 0 && staleRefreshed < staleFound;
  if (hadStaleWork && !capped) {
    base += ' · ยังมีสถานะค้าง — กดอัปเดตอีกครั้ง';
  }
  return {
    message: base,
    level: changed > 0 || staleRefreshed > 0 || (afterCount != null && afterCount !== beforeCount)
      ? 'success'
      : 'info',
  };
}
