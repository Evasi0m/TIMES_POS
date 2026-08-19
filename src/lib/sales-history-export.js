import * as XLSX from 'xlsx';
import { ECOMMERCE_CHANNELS } from './ecommerce-channels.js';
import { bangkokDateKey, fmtTimeBangkok } from './date.js';

export const SALES_HISTORY_EXPORT_COLUMNS_STORAGE_KEY = 'times-pos.sales-history-export-columns.v1';

const STATUS_LABELS = {
  active: 'ขายแล้ว',
  voided: 'ยกเลิก',
  pending: 'รอยืนยัน',
};

/** Column catalogue shown in the pre-export picker. */
export const SALES_HISTORY_EXPORT_COLUMNS = [
  { key: 'ลำดับ', label: 'ลำดับ', group: 'ข้อมูลรายการ', default: true, summaryLabel: true },
  { key: 'เลขที่บิล', label: 'เลขที่บิล', group: 'ข้อมูลรายการ', default: true, summaryLabel: true },
  { key: 'วันที่', label: 'วันที่ขาย', group: 'ข้อมูลรายการ', default: true },
  { key: 'เวลา', label: 'เวลาขาย', group: 'ข้อมูลรายการ', default: true },
  { key: 'Platform', label: 'Platform', group: 'ข้อมูลรายการ', default: true },
  { key: 'สถานะ', label: 'สถานะบิล', group: 'ข้อมูลรายการ', default: true },
  { key: 'วิธีชำระ', label: 'วิธีชำระเงิน', group: 'ข้อมูลรายการ', default: true },
  { key: 'รายการสินค้า', label: 'รายการสินค้า / SKU', group: 'สินค้า', default: true },
  { key: 'จำนวนรายการ', label: 'จำนวนรายการสินค้า', group: 'สินค้า', default: true, sum: true },
  { key: 'จำนวนชิ้น', label: 'จำนวนชิ้นรวม', group: 'สินค้า', default: true, sum: true },
  { key: 'ยอดก่อน VAT', label: 'ยอดก่อน VAT', group: 'ยอดเงิน', default: true, sum: true },
  { key: 'VAT', label: 'VAT', group: 'ยอดเงิน', default: true, sum: true },
  { key: 'ยอดขายรวม', label: 'ยอดขายรวม (รวม VAT)', group: 'ยอดเงิน', default: true, sum: true },
  { key: 'ร้านได้รับจริง', label: 'เงินที่ร้านได้รับจริง', group: 'ยอดเงิน', default: true, sum: true },
  { key: 'ส่วนลด', label: 'ส่วนลด', group: 'ยอดเงิน', default: false, sum: true },
  { key: 'กำไร', label: 'กำไร', group: 'ยอดเงิน', default: false, sum: true },
  { key: 'กำไรหลัง VAT', label: 'กำไรหลัง VAT', group: 'ยอดเงิน', default: false, sum: true },
  {
    key: 'เลขที่ใบกำกับภาษี',
    label: 'เลขที่ใบกำกับภาษี',
    group: 'ข้อมูลผู้ซื้อ/ภาษี',
    default: true,
  },
  { key: 'ชื่อผู้ซื้อ', label: 'ชื่อผู้ซื้อ / บริษัท', group: 'ข้อมูลผู้ซื้อ/ภาษี', default: true },
  {
    key: 'เลขประจำตัวผู้เสียภาษีผู้ซื้อ',
    label: 'เลขประจำตัวผู้เสียภาษีผู้ซื้อ',
    group: 'ข้อมูลผู้ซื้อ/ภาษี',
    default: true,
  },
  {
    key: 'สาขาผู้ซื้อ',
    label: 'สำนักงานใหญ่ / สาขาผู้ซื้อ',
    group: 'ข้อมูลผู้ซื้อ/ภาษี',
    default: true,
  },
  { key: 'ที่อยู่ผู้ซื้อ', label: 'ที่อยู่ผู้ซื้อ', group: 'ข้อมูลผู้ซื้อ/ภาษี', default: true },
  { key: 'หมายเหตุ', label: 'หมายเหตุ', group: 'ข้อมูลเพิ่มเติม', default: false },
];

const SALES_HISTORY_EXPORT_COLUMN_MAP = new Map(
  SALES_HISTORY_EXPORT_COLUMNS.map((column) => [column.key, column]),
);

export function defaultSalesHistoryExportColumns() {
  return SALES_HISTORY_EXPORT_COLUMNS
    .filter((column) => column.default)
    .map((column) => column.key);
}

export function normalizeSalesHistoryExportColumns(columns) {
  if (!Array.isArray(columns)) return defaultSalesHistoryExportColumns();
  return [...new Set(columns.filter((key) => SALES_HISTORY_EXPORT_COLUMN_MAP.has(key)))];
}

export function loadSalesHistoryExportColumns() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const stored = localStorage.getItem(SALES_HISTORY_EXPORT_COLUMNS_STORAGE_KEY);
    if (stored == null) return null;
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? normalizeSalesHistoryExportColumns(parsed) : null;
  } catch {
    return null;
  }
}

export function saveSalesHistoryExportColumns(columns) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      SALES_HISTORY_EXPORT_COLUMNS_STORAGE_KEY,
      JSON.stringify(normalizeSalesHistoryExportColumns(columns)),
    );
  } catch {
    // Private browsing or a full storage quota should not prevent exporting.
  }
}

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
    const totalAfterDiscount =
      order.total_after_discount != null ? toNumber(order.total_after_discount) : gross;
    const profit = toNumber(summary.profit);
    const productDetails =
      Array.isArray(summary.allProductNames) && summary.allProductNames.length
        ? summary.allProductNames.join(' | ')
        : summary.productLabel || '';

    return {
      ลำดับ: index + 1,
      เลขที่บิล: order.id,
      วันที่: bangkokDateKey(order.sale_date),
      เวลา: fmtTimeBangkok(order.sale_date),
      Platform: channelLabels[order.channel] || order.channel || 'หน้าร้าน',
      สถานะ: STATUS_LABELS[order.status] || order.status || '',
      วิธีชำระ: paymentLabels[order.payment_method] || order.payment_method || '',
      รายการสินค้า: productDetails,
      จำนวนรายการ: summary.itemCount || 0,
      จำนวนชิ้น: summary.totalQuantity || 0,
      'ยอดก่อน VAT': gross - vat,
      ยอดขายรวม: gross,
      VAT: vat,
      ร้านได้รับจริง: shopRevenue,
      ส่วนลด: Math.max(0, toNumber(order.subtotal) - totalAfterDiscount),
      กำไร: profit,
      'กำไรหลัง VAT': profit / 1.07,
      เลขที่ใบกำกับภาษี: order.tax_invoice_no || '',
      ชื่อผู้ซื้อ: order.buyer_name || '',
      เลขประจำตัวผู้เสียภาษีผู้ซื้อ: order.buyer_tax_id || '',
      สาขาผู้ซื้อ: order.buyer_branch || 'สำนักงานใหญ่',
      ที่อยู่ผู้ซื้อ: order.buyer_address || '',
      หมายเหตุ: order.notes || '',
    };
  });
}

export function salesHistoryExportFilename({ from, to, channels = [] } = {}) {
  const platformSuffix = channels.length ? `_${channels.join('-')}` : '_ทุกแพลตฟอร์ม';
  return `ยอดขาย_${from}_ถึง_${to}${platformSuffix}.xlsx`;
}

/**
 * Project rows into a strict 2D sheet shape. SheetJS' json_to_sheet keeps
 * object keys that are not listed in `header`, so using an array-of-arrays is
 * intentional here: an unchecked column cannot leak into the workbook.
 */
export function buildSalesHistorySheetData(rows = [], columns) {
  if (!rows.length) return { headers: [], lines: [] };
  const headers = columns?.length ? columns : Object.keys(rows[0]);
  const dataLines = rows.map((row) => headers.map((key) => row[key] ?? ''));
  const summaryLabelIndex = headers.findIndex((key) => {
    const column = SALES_HISTORY_EXPORT_COLUMN_MAP.get(key);
    return column?.summaryLabel || (!column?.sum && column != null);
  });
  const totalLine = headers.map((key, index) => {
    if (index === summaryLabelIndex) return 'รวม';
    const column = SALES_HISTORY_EXPORT_COLUMN_MAP.get(key);
    if (!column?.sum) return '';
    return rows.reduce((sum, row) => {
      const value = Number(row[key]);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
  });
  const lines = [headers, ...dataLines, totalLine];
  return { headers, lines };
}

/** Download a real .xlsx workbook containing the selected sales columns. */
export function downloadSalesHistoryXlsx(filename, rows, columns) {
  if (!rows?.length) return false;
  const { headers, lines } = buildSalesHistorySheetData(rows, columns);
  const worksheet = XLSX.utils.aoa_to_sheet(lines);
  worksheet['!cols'] = headers.map((key) => ({
    wch: Math.min(32, Math.max(12, key.length + 2)),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'ยอดขาย');
  XLSX.writeFile(workbook, filename, { bookType: 'xlsx' });
  return true;
}
