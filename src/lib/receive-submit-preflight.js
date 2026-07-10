import { buildReceiveItems } from './ai-receive.js';

function rowLabel(row) {
  return row.model_code || row.product?.name || row.newProduct?.name || 'ไม่ทราบรุ่น';
}

/**
 * Validate a bill's rows can produce RPC items before product insert / RPC.
 * Returns a Thai error string, or null when OK.
 */
export function validateBillRowsForSubmit(bill) {
  const rows = bill?.rows || [];
  if (!rows.length) return 'ไม่มีรายการในบิลนี้';

  const issues = [];
  for (const r of rows) {
    const label = rowLabel(r);
    if (r.status === 'auto' && !r.product?.id) {
      issues.push(`รายการ "{label}" จับคูไม่สมบูรณ์ — เลือกรุ่นใหม่`);
    } else if (r.status === 'new' && !String(r.newProduct?.name || '').trim()) {
      issues.push(`รายการ "{label}" ยังไม่ได้สร้างสินค้าใหม่`);
    } else if ((r.status === 'suggestions' || r.status === 'none')) {
      issues.push(`รายการ "{label}" ยังไม่ได้จับคูสินค้า`);
    }
  }
  if (issues.length) return issues.join('\n');

  const lineVatApplies = bill.has_vat !== false;
  const probeRows = rows.map((r) => {
    if (r.status === 'new' && r.newProduct) {
      return {
        ...r,
        product: { id: 1, name: r.newProduct.name.trim() },
      };
    }
    return r;
  });

  try {
    const items = buildReceiveItems(probeRows, lineVatApplies);
    if (items.length === 0) {
      const detail = rows
        .map((r) => `${rowLabel(r)} [${r.status}${r.product?.id ? '' : ',ไม่มี product'}]`)
        .join('; ');
      return `ไม่มีรายการที่บันทึกได้ในบิลนี้ — ${detail}`;
    }
  } catch (e) {
    return e?.message || String(e);
  }

  return null;
}
