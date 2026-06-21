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
 * Validate bulk adjust payload.
 * @param {{ items: Array<{ productId: number, targetQty: number }>, subreason: string, note: string }}
 * @returns {string|null}
 */
export function validateBulkManualStockAdjust({ items, subreason, note }) {
  const batchErr = validateManualStockAdjust({ targetQty: 0, subreason, note });
  if (batchErr && batchErr !== 'ยอดที่ต้องการต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป') {
    return batchErr;
  }
  const list = items || [];
  if (!list.length) return 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ';
  if (list.length > 100) return 'ปรับได้สูงสุด 100 รายการต่อครั้ง';

  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const pid = Number(item?.productId);
    if (!Number.isFinite(pid) || pid <= 0) {
      return `แถว ${i + 1}: ไม่พบสินค้า`;
    }
    if (seen.has(pid)) return `สินค้า ID ${pid} ซ้ำในรายการ`;
    seen.add(pid);

    const rowErr = validateManualStockAdjust({
      targetQty: item.targetQty,
      subreason,
      note,
    });
    if (rowErr) return `แถว ${i + 1}: ${rowErr}`;
  }
  return null;
}

/** Count rows where target qty differs from current stock. */
export function countBulkAdjustChanges(items) {
  return (items || []).filter((it) => {
    const target = Number(it.targetQty);
    const current = Number(it.currentStock) || 0;
    return Number.isInteger(target) && target >= 0 && target !== current;
  }).length;
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

/**
 * Bulk adjust product stock (super_admin RPC).
 * @returns {Promise<{ ok: true, data: object } | { ok: false, message: string }>}
 */
export async function bulkManualAdjustProductStock({ batchId, items, subreason, note }) {
  const err = validateBulkManualStockAdjust({ items, subreason, note });
  if (err) return { ok: false, message: err };

  const { sb } = await import('./supabase-client.js');
  const payload = (items || []).map((it) => ({
    product_id: Number(it.productId),
    target_qty: Number(it.targetQty),
  }));

  const { data, error } = await sb.rpc('bulk_manual_adjust_product_stock', {
    p_batch_id: batchId || Date.now(),
    p_subreason: subreason,
    p_note: String(note).trim(),
    p_items: payload,
  });

  if (error) {
    return { ok: false, message: mapError(error) };
  }

  return { ok: true, data: data || {} };
}

/**
 * Fire-and-forget Telegram alert for stock manual adjust.
 * Does not throw — caller should not block on this.
 */
export async function notifyStockAdjustTelegram({ auditId, batchId } = {}) {
  if (!auditId && !batchId) return;
  try {
    const { sb } = await import('./supabase-client.js');
    await sb.functions.invoke('telegram-send', {
      body: {
        action: 'alert',
        kind: 'stock_adjust',
        ...(auditId != null ? { audit_id: auditId } : {}),
        ...(batchId != null ? { batch_id: batchId } : {}),
      },
    });
  } catch (e) {
    console.warn('[stock-adjust] Telegram notify failed:', e?.message || e);
  }
}

/** Format bulk apply result for toast. */
export function formatBulkAdjustToast(data) {
  const applied = data?.applied ?? 0;
  const unchanged = data?.unchanged ?? 0;
  const errors = Array.isArray(data?.errors) ? data.errors.length : 0;
  if (errors > 0) {
    return {
      msg: `ปรับสต็อกกลุ่ม — สำเร็จ ${applied} · ไม่เปลี่ยน ${unchanged} · ผิดพลาด ${errors}`,
      type: applied > 0 ? 'warning' : 'error',
    };
  }
  return {
    msg: `ปรับสต็อกกลุ่มเรียบร้อย — สำเร็จ ${applied}${unchanged ? ` · ไม่เปลี่ยน ${unchanged}` : ''}`,
    type: 'success',
  };
}
