// Pure formatter for stock adjust Telegram alerts (mirrors telegram-format.ts).

import { stockAdjustSubreasonLabel } from './stock-manual-adjust.js';

function truncate(s, n) {
  const t = String(s || '');
  return t.length <= n ? t : t.slice(0, n - 1) + '…';
}

/**
 * @param {Array<{ product_name: string, stock_before: number, stock_after: number, qty_delta: number, subreason: string, note: string }>} rows
 * @param {string|null} actorEmail
 */
export function formatStockAdjustAlertText(rows, actorEmail) {
  const lines = [];
  lines.push('⚠️ <b>ปรับสต็อก (มือ)</b>');
  if (actorEmail) lines.push(`โดย: ${actorEmail}`);
  if (!rows?.length) {
    lines.push('');
    lines.push('ไม่พบรายการ');
    return lines.join('\n');
  }
  const subreason = rows[0].subreason;
  const note = rows[0].note;
  lines.push(`เหตุผล: ${stockAdjustSubreasonLabel(subreason) || subreason}`);
  if (note) lines.push(`หมายเหตุ: ${truncate(note, 120)}`);
  lines.push('');
  const show = rows.slice(0, 5);
  for (const r of show) {
    const sign = r.qty_delta > 0 ? '+' : '';
    lines.push(`• ${truncate(r.product_name, 36)}: ${r.stock_before} → ${r.stock_after} (${sign}${r.qty_delta})`);
  }
  if (rows.length > 5) {
    lines.push(`<i>… และอีก ${rows.length - 5} รายการ</i>`);
  }
  return lines.join('\n');
}
