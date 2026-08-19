import * as XLSX from 'xlsx';
import { ECOMMERCE_CHANNELS } from './ecommerce-channels.js';
import { bangkokDateKey, fmtTimeBangkok } from './date.js';

const STATUS_LABELS = {
  active: 'ขายแล้ว',
  voided: 'ยกเลิก',
  pending: 'รอยืนยัน',
};

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Build one Excel row per sale bill using the same rows currently visible in
 * Sales History. Keeping this pure makes the export easy to verify without a
 * browser and ensures the selected date/channel/search filters are respected
 * by the caller.
 */
export function buildSalesHistoryExportRows(
  orders = [],
  orderSummary = {},
  { channelLabels = {}, paymentLabels = {} } = {}
) {
  return orders.map((order, index) => {
    const summary = orderSummary[order.id] || {};
    const gross = toNumber(order.grand_total);
    const vatRate = toNumber(order.vat_rate) || 7;
    const vat =
      order.vat_amount != null ? toNumber(order.vat_amount) : (gross * vatRate) / (100 + vatRate);
    const shopRevenue =
      ECOMMERCE_CHANNELS.has(order.channel) && order.net_received != null
        ? toNumber(order.net_received)
        : gross;
    const profit = toNumber(summary.profit);

    return {
      ลำดับ: index + 1,
      เลขที่บิล: order.id,
      วันที่: bangkokDateKey(order.sale_date),
      เวลา: fmtTimeBangkok(order.sale_date),
      Platform: channelLabels[order.channel] || order.channel || 'หน้าร้าน',
      สถานะ: STATUS_LABELS[order.status] || order.status || '',
      วิธีชำระ: paymentLabels[order.payment_method] || order.payment_method || '',
      รายการสินค้า: summary.productLabel || '',
      จำนวนรายการ: summary.itemCount || 0,
      ยอดขายรวม: gross,
      VAT: vat,
      ร้านได้รับจริง: shopRevenue,
      กำไร: profit,
      'กำไรหลัง VAT': profit / 1.07,
      เลขที่ใบกำกับภาษี: order.tax_invoice_no || '',
      ชื่อผู้ซื้อ: order.buyer_name || '',
      หมายเหตุ: order.notes || '',
    };
  });
}

export function salesHistoryExportFilename({ from, to, channels = [] } = {}) {
  const platformSuffix = channels.length ? `_${channels.join('-')}` : '_ทุกแพลตฟอร์ม';
  return `ยอดขาย_${from}_ถึง_${to}${platformSuffix}.xlsx`;
}

/** Download a real .xlsx workbook containing the supplied sales rows. */
export function downloadSalesHistoryXlsx(filename, rows) {
  if (!rows?.length) return false;
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = Object.keys(rows[0]).map((key) => ({
    wch: Math.min(32, Math.max(12, key.length + 2)),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ยอดขาย');
  XLSX.writeFile(workbook, filename, { bookType: 'xlsx' });
  return true;
}
