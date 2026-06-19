// Super-admin manual stock adjustment — RPC wrapper + subreason constants.

import { mapError } from './error-map.js';

export const STOCK_ADJUST_SUBREASONS = [
  { value: 'recording_error', label: 'บันทึกผิดพลาด / ซ้ำ' },
  { value: 'physical_count', label: 'นับสต็อกจริงไม่ตรง' },
  { value: 'damage_loss', label: 'เสียหาย / สูญหาย' },
  { value: 'legacy_data', label: 'ข้อมูลเก่า / ย้ายระบบ' },
  { value: 'other', label: 'อื่นๆ' },
];

const SUBREASON_SET = new Set(STOCK_ADJUST_SUBREASONS.map((r) => r.value));

export function stockAdjustSubreasonLabel(code) {
  return STOCK_ADJUST_SUBREASONS.find((r) => r.value === code)?.label || code || '';
}

/** Parse `[subreason] note` prefix from stock_movements.notes. */
export function parseManualAdjustNotes(notes) {
  const raw = String(notes || '').trim();
  const m = raw.match(/^\[([a-z_]+)\]\s*(.*)$/s);
  if (!m) return { subreason: null, subreasonLabel: null, note: raw || null };
  const subreason = m[1];
  return {
    subreason,
    subreasonLabel: stockAdjustSubreasonLabel(subreason),
    note: m[2]?.trim() || null,
  };
}

/**
 * Client-side validation before RPC (mirrors server rules).
 * @returns {string|null} error message or null if ok
 */
export function validateManualStockAdjust({ targetQty, subreason, note }) {
  const qty = Number(targetQty);
  if (!Number.isFinite(qty) || qty < 0 || !Number.isInteger(qty)) {
    return 'ยอดที่ต้องการต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  }
  if (!subreason || !SUBREASON_SET.has(subreason)) {
    return 'กรุณาเลือกเหตุผล';
  }
  const trimmed = String(note || '').trim();
  if (!trimmed) return 'กรุณากรอกหมายเหตุ';
  if (subreason === 'other' && trimmed.length < 20) {
    return 'กรณี "อื่นๆ" ต้องกรอกหมายเหตุอย่างน้อย 20 ตัวอักษร';
  }
  return null;
}

/**
 * Adjust product stock to target qty (super_admin RPC).
 * @returns {Promise<{ ok: true, data: object } | { ok: false, message: string }>}
 */
export async function manualAdjustProductStock({ productId, targetQty, subreason, note }) {
  const err = validateManualStockAdjust({ targetQty, subreason, note });
  if (err) return { ok: false, message: err };

  const { sb } = await import('./supabase-client.js');
  const { data, error } = await sb.rpc('manual_adjust_product_stock', {
    p_product_id: productId,
    p_target_qty: Number(targetQty),
    p_subreason: subreason,
    p_note: String(note).trim(),
  });

  if (error) {
    return { ok: false, message: mapError(error) };
  }

  return { ok: true, data: data || {} };
}
