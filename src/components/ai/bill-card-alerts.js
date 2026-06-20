// Priority-ordered bill-level alerts for BulkReceiveView BillCard (mobile summary).

function isTikTokLineReady(row) {
  if (!row || row.tiktok_skip) return true;
  return !!(row.tiktok_sku || row.tiktok_mapping);
}

const SEVERITY = { error: 0, warn: 1, info: 2 };

export const BILL_STATUS_LABELS = {
  ready: 'พร้อมบันทึก',
  unresolved: 'ต้องจับคู่',
  incomplete: 'กรอกตัวเลข',
  tiktok_unresolved: 'จับ TikTok',
  empty: 'อ่านไม่ได้',
  saving: 'กำลังบันทึก',
  saved: 'บันทึกแล้ว',
  failed: 'บันทึกไม่สำเร็จ'
};

/** Stable CSS chip classes (not dynamic Tailwind). */
export const BILL_STATUS_CHIP_CLS = {
  ready: 'brv-status-chip--ready',
  unresolved: 'brv-status-chip--warn',
  incomplete: 'brv-status-chip--warn',
  tiktok_unresolved: 'brv-status-chip--warn',
  empty: 'brv-status-chip--error',
  saving: 'brv-status-chip--saving',
  saved: 'brv-status-chip--ready',
  failed: 'brv-status-chip--error',
};

/**
 * @returns {{ key: string, severity: 'error'|'warn'|'info', message: string, onClick?: () => void, saveError?: string }[]}
 */
export function collectBillAlerts(bill, {
  dup = null,
  tiktokMirrorEnabled = false,
  onZoom,
} = {}) {
  if (!bill) return [];

  const alerts = [];
  const isNonCmg = !bill.is_cmg_bill;
  const isEmpty = bill.rows.length === 0;
  const unresolved = bill.rows.filter((r) => r.status === 'suggestions' || r.status === 'none').length;
  const incompleteRows = (!isNonCmg && !isEmpty && unresolved === 0)
    ? bill.rows.filter((r) => !(Number(r.unit_cost) > 0) || !(Number(r.quantity) > 0)).length
    : 0;
  const reviewRows = (!isNonCmg && !isEmpty)
    ? bill.rows.filter((r) => r.needsReview).length
    : 0;
  const validationBillWarnings = bill.validation?.bill?.warnings?.length || 0;
  const validationRowIssues = bill.validation?.rows?.length || 0;

  if (dup) {
    alerts.push({
      key: 'dup',
      severity: 'error',
      message: `เลขบิลนี้เคยรับเข้าแล้ว (#${dup.id}${dup.date ? ` · ${new Date(dup.date).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })}` : ''}) — ตรวจก่อนบันทึกซ้ำ`,
    });
  }
  if (isNonCmg) {
    alerts.push({
      key: 'non-cmg',
      severity: 'error',
      message: 'AI บอกว่ารูปนี้ไม่ใช่บิล CMG — บิลนี้จะถูกข้ามตอนบันทึก',
    });
  }
  if (!isNonCmg && isEmpty) {
    alerts.push({
      key: 'empty',
      severity: 'warn',
      message: 'อ่านรายการไม่ได้ — ลบบิลนี้แล้วถ่ายใหม่',
    });
  }
  if (!isNonCmg && !isEmpty && unresolved > 0) {
    alerts.push({
      key: 'unresolved',
      severity: 'warn',
      message: `เหลือ ${unresolved} รายการที่ต้องจับคู่`,
    });
  }
  if (incompleteRows > 0) {
    alerts.push({
      key: 'incomplete',
      severity: 'warn',
      message: `เหลือ ${incompleteRows} รายการที่ AI อ่าน ทุน/จำนวน ไม่ออก — กรอกให้ครบก่อนบันทึก`,
    });
  }
  if (tiktokMirrorEnabled && !isNonCmg && !isEmpty && unresolved === 0 && incompleteRows === 0) {
    const tiktokLeft = bill.rows.filter((r) => {
      const hasPos = r.product || (r.status === 'new' && r.newProduct);
      return hasPos && !r.tiktok_skip && !isTikTokLineReady(r);
    }).length;
    if (tiktokLeft > 0) {
      alerts.push({
        key: 'tiktok',
        severity: 'warn',
        message: `เหลือ ${tiktokLeft} รายการที่ต้องจับคู่ TikTok`,
      });
    }
  }
  if (validationBillWarnings > 0) {
    alerts.push({
      key: 'bill-math',
      severity: 'warn',
      message: `ผลรวมบิลไม่ตรง footer (${validationBillWarnings} จุด) — แตะดูรูปเทียบ`,
      onClick: bill.previewUrl && onZoom ? () => onZoom(bill.previewUrl) : undefined,
    });
  }
  if (validationRowIssues > 0) {
    alerts.push({
      key: 'row-math',
      severity: 'warn',
      message: `${validationRowIssues} แถวเลขไม่ตรงบิล — แตะดูรูปเทียบ`,
      onClick: bill.previewUrl && onZoom ? () => onZoom(bill.previewUrl) : undefined,
    });
  }
  if (reviewRows > 0) {
    alerts.push({
      key: 'ai-review',
      severity: 'warn',
      message: `AI ไม่มั่นใจ ${reviewRows} รายการ — แตะดูรูปเทียบให้ชัวร์`,
      onClick: bill.previewUrl && onZoom ? () => onZoom(bill.previewUrl) : undefined,
    });
  }
  if (bill.saveState === 'failed' && bill.saveError) {
    alerts.push({
      key: 'save-failed',
      severity: 'error',
      message: 'บันทึกไม่สำเร็จ',
      saveError: bill.saveError,
    });
  }

  alerts.sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity]);
  return alerts;
}
