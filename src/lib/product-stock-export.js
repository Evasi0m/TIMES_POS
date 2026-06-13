// Structured stock CSV export for the Products page.
// Pure helpers — no React, no Supabase.

import {
  BRAND_RULES,
  SERIES_RULES,
  MATERIAL_MAP,
  COLOR_MAP,
} from './product-classify.js';
import { downloadStructuredCsv } from './csv.js';
import { roundMoney } from './money.js';
import { dateISOBangkok, fmtThaiDateShort, BANGKOK_TZ } from './date.js';

/** Section order when exporting "ทั้งหมด". */
export const SECTION_EXPORT_ORDER = ['seiko', 'alba', 'citizen', 'casio', 'other'];

const NAMED_BRAND_IDS = SECTION_EXPORT_ORDER.filter((id) => id !== 'other');

export const EXPORT_BRAND_OPTIONS = [
  { id: 'all', label: 'ทั้งหมด' },
  ...BRAND_RULES.filter((b) => b.id !== 'other').map((b) => ({ id: b.id, label: b.label })),
];

const COLUMNS = [
  'ลำดับ',
  'ชื่อรุ่น',
  'บาร์โค้ด',
  'Series',
  'วัสดุ',
  'สี',
  'ทุนตั้งต้น',
  'ทุนล่าสุด',
  'วันที่รับล่าสุด',
  'ราคาป้าย',
  'คงเหลือ',
  'มูลค่าป้ายรวม',
  'มูลค่าทุนรวม',
];

const brandLabel = (id) => BRAND_RULES.find((b) => b.id === id)?.label || id;

const seriesLabel = (p) => {
  if (p._brand !== 'casio' || !p._series) return '';
  return SERIES_RULES.find((s) => s.id === p._series)?.label || '';
};

const materialLabel = (p) => {
  if (p._brand !== 'casio' || !p._material) return '';
  return MATERIAL_MAP[p._material]?.label || '';
};

const colorLabel = (p) => {
  if (p._brand !== 'casio' || !p._color) return '';
  return COLOR_MAP[p._color]?.label || '';
};

/** 2-decimal string without thousands separator (Excel-friendly). */
const num = (n) => roundMoney(n).toFixed(2);

/** Human-readable money in summary rows. */
const fmtSummaryMoney = (n) =>
  roundMoney(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtExportTimestamp(d = new Date()) {
  const date = fmtThaiDateShort(dateISOBangkok(d));
  const time = d.toLocaleTimeString('th-TH', {
    timeZone: BANGKOK_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date} ${time}`;
}

/** Filter catalog by export scope (independent of UI filters). */
export function filterByExportScope(products, scope) {
  if (!Array.isArray(products)) return [];
  if (scope === 'all') return products.filter((p) => SECTION_EXPORT_ORDER.includes(p._brand));
  return products.filter((p) => p._brand === scope);
}

function scopeLabel(scope) {
  if (scope === 'all') {
    const names = NAMED_BRAND_IDS.map(brandLabel).join(', ');
    return `ขอบเขต: ทั้งหมด (${names})`;
  }
  return `ขอบเขต: ${brandLabel(scope)}`;
}

function productRow(p, index, latestCostMap) {
  const lc = latestCostMap?.[p.id];
  const stock = Number(p.current_stock) || 0;
  const retail = Number(p.retail_price) || 0;
  const cost = Number(p.cost_price) || 0;
  return [
    index,
    p.name || '',
    p.barcode || '',
    seriesLabel(p),
    materialLabel(p),
    colorLabel(p),
    num(cost),
    lc?.unit_price != null ? num(lc.unit_price) : '',
    lc?.receive_date ? fmtThaiDateShort(lc.receive_date) : '',
    num(retail),
    stock,
    num(retail * stock),
    num(cost * stock),
  ];
}

function sectionTotals(rows) {
  let stockQty = 0;
  let retailValue = 0;
  let costValue = 0;
  for (const p of rows) {
    const stock = Number(p.current_stock) || 0;
    const retail = Number(p.retail_price) || 0;
    const cost = Number(p.cost_price) || 0;
    stockQty += stock;
    retailValue = roundMoney(retailValue + retail * stock);
    costValue = roundMoney(costValue + cost * stock);
  }
  return { skuCount: rows.length, stockQty, retailValue, costValue };
}

function subtotalRow(brandId, totals) {
  const label = brandLabel(brandId);
  const summary =
    `รุ่น ${totals.skuCount.toLocaleString('th-TH')} · ` +
    `สต็อก ${totals.stockQty.toLocaleString('th-TH')} ชิ้น · ` +
    `มูลค่าป้าย ${fmtSummaryMoney(totals.retailValue)} · ` +
    `มูลค่าทุน ${fmtSummaryMoney(totals.costValue)}`;
  return [`สรุป ${label}`, '', '', '', '', '', '', '', '', '', '', summary, ''];
}

function grandTotalRow(totals) {
  const summary =
    `รวมทั้งหมด · รุ่น ${totals.skuCount.toLocaleString('th-TH')} · ` +
    `สต็อก ${totals.stockQty.toLocaleString('th-TH')} ชิ้น · ` +
    `มูลค่าป้าย ${fmtSummaryMoney(totals.retailValue)} · ` +
    `มูลค่าทุน ${fmtSummaryMoney(totals.costValue)}`;
  return ['สรุปรวมทั้งหมด', '', '', '', '', '', '', '', '', '', '', summary, ''];
}

/**
 * Build array-of-arrays lines for downloadStructuredCsv.
 */
export function buildStockExportLines({
  products,
  latestCostMap = {},
  scope = 'all',
  shopName = 'TIMES',
  exportedAt = new Date(),
  exporter = null,
}) {
  const filtered = filterByExportScope(products, scope);
  const brandsToExport =
    scope === 'all'
      ? SECTION_EXPORT_ORDER.filter((id) => filtered.some((p) => p._brand === id))
      : [scope];

  const lines = [
    ['รายงานสต็อกสินค้า'],
    [`ร้าน: ${shopName || 'TIMES'}`],
    [`วันที่ Export: ${fmtExportTimestamp(exportedAt)}`],
    [scopeLabel(scope)],
  ];

  if (exporter) {
    lines.push([`ผู้ Export: ${exporter.email || ''}`]);
    lines.push([`ชื่อผู้ใช้: ${exporter.name || exporter.email || ''}`]);
  }

  lines.push([]);

  const grand = { skuCount: 0, stockQty: 0, retailValue: 0, costValue: 0 };
  let sectionIndex = 0;

  for (const brandId of brandsToExport) {
    const sectionRows = filtered
      .filter((p) => p._brand === brandId)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));

    if (!sectionRows.length) continue;

    if (sectionIndex > 0) lines.push([]);

    const totals = sectionTotals(sectionRows);
    grand.skuCount += totals.skuCount;
    grand.stockQty += totals.stockQty;
    grand.retailValue = roundMoney(grand.retailValue + totals.retailValue);
    grand.costValue = roundMoney(grand.costValue + totals.costValue);

    lines.push([`【 ${brandLabel(brandId).toUpperCase()} 】  รายการ ${totals.skuCount.toLocaleString('th-TH')} รุ่น`]);
    lines.push([...COLUMNS]);
    sectionRows.forEach((p, i) => lines.push(productRow(p, i + 1, latestCostMap)));
    lines.push(subtotalRow(brandId, totals));
    sectionIndex += 1;
  }

  if (sectionIndex > 1) {
    lines.push([]);
    lines.push(grandTotalRow(grand));
  }

  return lines;
}

export function exportScopeLabel(scope) {
  return EXPORT_BRAND_OPTIONS.find((o) => o.id === scope)?.label || scope;
}

export function stockExportFilename(scope, exportedAt = new Date()) {
  const date = dateISOBangkok(exportedAt);
  const slug = scope === 'all' ? 'all' : scope;
  return `stock-${slug}-${date}.csv`;
}

/**
 * Filter, build lines, and trigger browser download.
 * @returns {number} row count exported, or 0 if nothing to export
 */
export function downloadProductStockCsv({
  products,
  latestCostMap,
  scope,
  shopName,
  exportedAt = new Date(),
  exporter = null,
}) {
  const count = filterByExportScope(products, scope).length;
  if (!count) return 0;
  const lines = buildStockExportLines({
    products,
    latestCostMap,
    scope,
    shopName,
    exportedAt,
    exporter,
  });
  downloadStructuredCsv(stockExportFilename(scope, exportedAt), lines);
  return count;
}
