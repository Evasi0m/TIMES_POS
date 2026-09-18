import {
  buildReceiveItems,
  findBillRowCostConflicts,
  formatBillRowCostConflictError,
  probeProductForSubmitRow,
} from './ai-receive.js';
import { isValidCmgInvoiceNo } from './cmg-bill-validate.js';

function rowLabel(row) {
  return row.model_code || row.product?.name || row.newProduct?.name || 'ไม่ทราบรุ่น';
}

/**
 * Validate a bill's rows can produce RPC items before product insert / RPC.
 * Returns a Thai error string, or null when OK.
 */
export function validateBillRowsForSubmit(bill, { dupInvoice } = {}) {
  const rows = bill?.rows || [];
  if (!rows.length) return 'ไม่มีรายการในบิลนี้';

  const inv = bill?.supplier_invoice_no?.trim();
  if (inv && !isValidCmgInvoiceNo(inv)) {
    return `เลขบิล ${inv} ไม่ใช่ 10 หลัก — ตรวจกับรูปบิลแล้วแก้เลขบิล`;
  }
  if (inv && dupInvoice) {
    const dateStr = dupInvoice.date
      ? new Date(dupInvoice.date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })
      : '';
    return `เลขบิล ${inv} ถูกใช้แล้ว (รับเข้า #${dupInvoice.id}${dateStr ? ` · ${dateStr}` : ''}) — ไม่สามารถบันทึกซ้ำได้`;
  }

  const issues = [];
  for (const r of rows) {
    const label = rowLabel(r);
    if (r.status === 'auto' && !r.product?.id) {
      issues.push(`รายการ "${label}" จับคูไม่สมบูรณ์ — เลือกรุ่นใหม่`);
    } else if (r.status === 'new' && !String(r.newProduct?.name || '').trim()) {
      issues.push(`รายการ "${label}" ยังไม่ได้สร้างสินค้าใหม่`);
    } else if ((r.status === 'suggestions' || r.status === 'none')) {
      issues.push(`รายการ "${label}" ยังไม่ได้จับคูสินค้า`);
    }
  }
  if (issues.length) return issues.join('\n');

  const costConflicts = findBillRowCostConflicts(rows);
  if (costConflicts.length) {
    return formatBillRowCostConflictError(costConflicts);
  }

  const lineVatApplies = bill.has_vat !== false;
  const probeRows = rows.map((r) => {
    const product = probeProductForSubmitRow(r);
    return product ? { ...r, product } : r;
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
