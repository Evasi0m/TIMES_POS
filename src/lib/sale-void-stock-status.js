/** POS stock state after voiding a sale bill. */
export const VOID_STOCK_STATUS = {
  RESTORED: 'restored',
  MISSING: 'missing',
  NEVER_CUT: 'never_cut',
};

export function voidStockStatusLabel(status) {
  switch (status) {
    case VOID_STOCK_STATUS.RESTORED:
      return {
        text: 'สต็อกคืนแล้ว',
        hint: 'ไม่ต้องเข้าหน้ารับคืนเพื่อบวกสต็อก — ใช้รับคืนเฉพาะเมื่อต้องการเอกสาร',
        tone: 'success',
      };
    case VOID_STOCK_STATUS.MISSING:
      return {
        text: 'สต็อกยังไม่คืน',
        hint: 'เคยตัดสต็อกแล้วแต่ void ไม่ได้คืน — ตรวจ admin หรือปรับสต็อก manual',
        tone: 'warning',
      };
    case VOID_STOCK_STATUS.NEVER_CUT:
      return {
        text: 'ไม่เคยตัดสต็อก',
        hint: 'ยกเลิกก่อนยืนยันขาย — ไม่ต้องบวกสต็อกกลับ',
        tone: 'muted',
      };
    default:
      return null;
  }
}

/** Batch lookup: sale / sale_void movements per voided bill. */
export async function fetchVoidStockStatusMap(sb, saleOrderIds) {
  const ids = [...new Set((saleOrderIds || []).filter(Boolean))];
  if (!ids.length) return {};

  const { data, error } = await sb.from('stock_movements')
    .select('ref_id, reason')
    .eq('ref_table', 'sale_orders')
    .in('ref_id', ids)
    .in('reason', ['sale', 'sale_void']);
  if (error) throw error;

  const bySale = {};
  for (const row of data || []) {
    const id = row.ref_id;
    if (!bySale[id]) bySale[id] = { sale: false, sale_void: false };
    if (row.reason === 'sale') bySale[id].sale = true;
    if (row.reason === 'sale_void') bySale[id].sale_void = true;
  }

  const out = {};
  for (const id of ids) {
    const m = bySale[id] || {};
    if (m.sale_void) out[id] = VOID_STOCK_STATUS.RESTORED;
    else if (m.sale) out[id] = VOID_STOCK_STATUS.MISSING;
    else out[id] = VOID_STOCK_STATUS.NEVER_CUT;
  }
  return out;
}

export async function fetchVoidStockStatus(sb, saleOrderId) {
  const map = await fetchVoidStockStatusMap(sb, [saleOrderId]);
  return map[saleOrderId] ?? null;
}
