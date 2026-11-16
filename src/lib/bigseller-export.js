// BigSeller stock export — pure logic (no React, no Supabase).
//
// POS is the real stock number. BigSeller (warehouse TIMES STOCK) already
// deducts its own online orders (TikTok / Shopee / Lazada), so POS exports
// only the changes BigSeller cannot see, as Manual Stock-In / Stock-Out files.
//
//   1. filter movements by reason + channel   (isExportableMovement)
//   2. product → Merchant SKU                 (resolveMerchantSku / resolveSkuMap)
//   3. net per Merchant SKU                   (aggregateBySku)
//   4. Excel rows in BigSeller's template     (buildStockInAoa / buildStockOutAoa)
//
// Migration 088 holds the tables / RPCs; the UI is BigSellerExportModal.jsx.

/** Reasons from the stock_movements_reason_check constraint (migration 083). */
export const ALWAYS_EXPORT_REASONS = new Set([
  'receive', 'receive_void', 'receive_edit',
  'manual_adjust', 'supplier_claim', 'supplier_claim_void', 'stock_reconcile',
]);
/** Order-linked reasons: exported only for channels BigSeller can't see. */
export const CHANNEL_REASONS = new Set([
  'sale', 'sale_void', 'sale_edit', 'return_in', 'return_void',
]);
export const NEVER_EXPORT_REASONS = new Set(['initial']);
/** Channels whose orders BigSeller already deducts by itself. */
export const BIGSELLER_OWN_CHANNELS = new Set(['tiktok', 'shopee', 'lazada']);

/** BigSeller allows at most this many data rows per import file. */
export const MAX_ROWS_PER_FILE = 2000;

/** Header text copied exactly from BigSeller's templates (sheet "SKU"). */
export const STOCK_IN_HEADERS = [
  '*ชื่อSKU\n (ต้องกรอก SKU หรือ GTIN อย่างใดอย่างหนึ่ง)',
  '*GTIN\n (ต้องกรอก SKU หรือ GTIN อย่างใดอย่างหนึ่ง)',
  '*จำนวน Stock-In',
  'ราคาต่อหน่วย',
  'วันที่ผลิต',
  'วันที่หมดอายุ',
  'S/N',
];
export const STOCK_OUT_HEADERS = ['*ชื่อSKU', '*จำนวน Stock-Out', 'S/N'];
export const SHEET_NAME = 'SKU';

/**
 * 'export' | 'skip' | 'unknown' for one movement.
 * 'unknown' = a reason not in the agreed rule table — caller must surface it.
 */
export function movementDecision(m) {
  const reason = m?.reason;
  if (ALWAYS_EXPORT_REASONS.has(reason)) return 'export';
  if (NEVER_EXPORT_REASONS.has(reason)) return 'skip';
  if (CHANNEL_REASONS.has(reason)) {
    const ch = m.channel == null ? null : String(m.channel).trim().toLowerCase();
    return ch && BIGSELLER_OWN_CHANNELS.has(ch) ? 'skip' : 'export';
  }
  return 'unknown';
}

export function isExportableMovement(m) {
  return movementDecision(m) === 'export';
}

const clean = s => String(s ?? '').trim();
const upper = s => clean(s).toUpperCase();

/**
 * Merchant SKU for one product.
 *   1. TikTok mapping seller_sku (all mappings must agree, else 'conflict')
 *   2. longest BigSeller SKU that the product name starts with
 * @param {{name: string}} product
 * @param {string[]} tiktokSkus   seller_sku values mapped to this product
 * @param {string[]} merchantSkus full BigSeller SKU list
 * @returns {{sku: string|null, source: 'tiktok'|'prefix'|null, problem?: 'conflict'|'ambiguous'|'none'}}
 */
export function resolveMerchantSku(product, tiktokSkus = [], merchantSkus = []) {
  const tt = [...new Set(tiktokSkus.map(clean).filter(Boolean))];
  if (tt.length === 1) return { sku: tt[0], source: 'tiktok' };
  if (tt.length > 1) {
    const distinct = new Set(tt.map(upper));
    if (distinct.size === 1) return { sku: tt[0], source: 'tiktok' };
    return { sku: null, source: null, problem: 'conflict', candidates: tt };
  }

  const name = upper(product?.name);
  if (!name) return { sku: null, source: null, problem: 'none' };
  let best = [];
  let bestLen = 0;
  for (const s of merchantSkus) {
    const u = upper(s);
    if (!u || !name.startsWith(u)) continue;
    if (u.length > bestLen) { best = [clean(s)]; bestLen = u.length; }
    else if (u.length === bestLen) best.push(clean(s));
  }
  if (best.length === 1) return { sku: best[0], source: 'prefix' };
  if (best.length > 1) return { sku: null, source: null, problem: 'ambiguous', candidates: best };
  return { sku: null, source: null, problem: 'none' };
}

/**
 * Resolve every product in `productIds`.
 * Saved 'skip' → not sent to BigSeller. Saved 'manual' wins; otherwise resolve
 * fresh (TikTok, then prefix), falling back to an earlier saved pick.
 * Every SKU must exist in the uploaded BigSeller list (`merchantSkus`) — one
 * that doesn't (e.g. a TikTok seller_sku BigSeller lacks, or a typo) is
 * reported as 'not_in_bigseller' instead of being exported.
 * @param {number[]} productIds
 * @param {{productsById: Map, tiktokByProduct: Map<number,string[]>, merchantSkus: string[], savedMap: Map<number,{merchant_sku, source}>}} ctx
 * @returns {{resolved: Map<number,{sku, source}>, toSave: Array<{product_id, merchant_sku, source}>, unresolved: Array<{product_id, name, problem, candidates?}>, skipped: Array<{product_id, name}>}}
 */
export function resolveSkuMap(productIds, { productsById, tiktokByProduct, merchantSkus, savedMap }) {
  const resolved = new Map();
  const toSave = [];
  const unresolved = [];
  const skipped = [];
  const known = new Map(merchantSkus.map(s => [upper(s), clean(s)]));
  for (const pid of productIds) {
    const saved = savedMap?.get(pid);
    const product = productsById.get(pid);
    const name = product?.name || `#${pid}`;
    const tt = tiktokByProduct?.get(pid) || [];
    if (saved?.source === 'skip') { skipped.push({ product_id: pid, name }); continue; }

    let pick = null;
    let problem = null;
    let candidates;
    if (saved?.source === 'manual') {
      pick = { sku: saved.merchant_sku, source: 'manual' };
    } else {
      const r = resolveMerchantSku(product, tt, merchantSkus);
      if (r.sku) pick = { sku: r.sku, source: r.source };
      else if (saved) pick = { sku: saved.merchant_sku, source: saved.source };
      else { problem = r.problem; candidates = r.candidates; }
    }

    if (pick) {
      const canonical = known.get(upper(pick.sku));
      if (!canonical) {
        unresolved.push({ product_id: pid, name, problem: 'not_in_bigseller', candidates: [pick.sku] });
        continue;
      }
      pick = { ...pick, sku: canonical };
      resolved.set(pid, pick);
      if (pick.source !== 'manual' && (!saved || saved.merchant_sku !== pick.sku || saved.source !== pick.source)) {
        toSave.push({ product_id: pid, merchant_sku: pick.sku, source: pick.source });
      }
    } else {
      unresolved.push({ product_id: pid, name, problem, candidates });
    }
  }
  return { resolved, toSave, unresolved, skipped };
}

/** Net qty per product over exportable movements. */
export function netByProduct(movements) {
  const net = new Map();
  for (const m of movements) {
    if (!isExportableMovement(m)) continue;
    const pid = Number(m.product_id);
    net.set(pid, (net.get(pid) || 0) + Number(m.qty_delta || 0));
  }
  return net;
}

/**
 * Net per Merchant SKU → stock-in / stock-out rows. Net 0 is omitted.
 * Products without a SKU are returned in `unresolved` with their net.
 * @param {Map<number, number>} netMap   product_id → net qty
 * @param {Map<number, {sku}>} resolved
 * @param {Map<number, {cost_price?, name?}>} productsById
 * @param {Set<number>} skipIds   products marked "ไม่ส่ง BigSeller"
 */
export function aggregateBySku(netMap, resolved, productsById = new Map(), skipIds = new Set()) {
  const bySku = new Map();   // key: upper sku → {sku, qty, costSum, costQty}
  const unresolved = [];
  for (const [pid, qty] of netMap) {
    if (!qty || skipIds.has(pid)) continue;
    const r = resolved.get(pid);
    if (!r?.sku) {
      unresolved.push({ product_id: pid, name: productsById.get(pid)?.name || `#${pid}`, net: qty });
      continue;
    }
    const key = upper(r.sku);
    const cur = bySku.get(key) || { sku: r.sku, qty: 0, costSum: 0, costQty: 0 };
    cur.qty += qty;
    const cost = Number(productsById.get(pid)?.cost_price);
    if (qty > 0 && cost > 0) { cur.costSum += cost * qty; cur.costQty += qty; }
    bySku.set(key, cur);
  }
  const stockIn = [];
  const stockOut = [];
  for (const v of bySku.values()) {
    if (v.qty > 0) {
      const unit_cost = v.costQty > 0 ? Math.round((v.costSum / v.costQty) * 100) / 100 : null;
      stockIn.push({ sku: v.sku, qty: v.qty, unit_cost });
    } else if (v.qty < 0) {
      stockOut.push({ sku: v.sku, qty: -v.qty });
    }
  }
  const bySkuName = (a, b) => a.sku.localeCompare(b.sku);
  return { stockIn: stockIn.sort(bySkuName), stockOut: stockOut.sort(bySkuName), unresolved };
}

/**
 * stock_reconcile lines in this batch, per product — shown for a manual check
 * before import (a reconcile caused by a TikTok order BigSeller already
 * deducted would otherwise be counted twice).
 * @returns {Array<{product_id, name, sku, qty}>}
 */
export function reconcileLines(movements, resolved = new Map(), productsById = new Map()) {
  const byProduct = new Map();
  for (const m of movements) {
    if (m.reason !== 'stock_reconcile') continue;
    const pid = Number(m.product_id);
    byProduct.set(pid, (byProduct.get(pid) || 0) + Number(m.qty_delta || 0));
  }
  return [...byProduct].filter(([, qty]) => qty).map(([pid, qty]) => ({
    product_id: pid,
    name: productsById.get(pid)?.name || `#${pid}`,
    sku: resolved.get(pid)?.sku || null,
    qty,
  }));
}

/** Rows (array of arrays) for one Stock-In sheet, header first. */
export function buildStockInAoa(rows) {
  return [STOCK_IN_HEADERS, ...rows.map(r => [r.sku, '', r.qty, r.unit_cost ?? '', '', '', ''])];
}

/** Rows (array of arrays) for one Stock-Out sheet, header first. */
export function buildStockOutAoa(rows) {
  return [STOCK_OUT_HEADERS, ...rows.map(r => [r.sku, r.qty, ''])];
}

/** Split rows into ≤ MAX_ROWS_PER_FILE chunks (BigSeller import limit). */
export function chunkRows(rows, size = MAX_ROWS_PER_FILE) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** "BigSeller_StockIn_20261116-1430_b12.xlsx" (+ "_part2" when split). */
export function exportFilename(kind, date, batchId, part = 1, parts = 1) {
  const d = new Date(date);
  const p = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  const tag = kind === 'in' ? 'StockIn' : 'StockOut';
  const suffix = parts > 1 ? `_part${part}` : '';
  return `BigSeller_${tag}_${stamp}${batchId ? `_b${batchId}` : ''}${suffix}.xlsx`;
}

/**
 * SKU list from an uploaded sheet (array of arrays). Uses the column whose
 * header contains "SKU", else column A; a header row is skipped.
 */
export function parseSkuSheet(aoa) {
  if (!Array.isArray(aoa) || !aoa.length) return [];
  const head = (aoa[0] || []).map(c => upper(c));
  let col = head.findIndex(h => h.includes('SKU'));
  const hasHeader = col >= 0;
  if (col < 0) col = 0;
  const seen = new Set();
  const out = [];
  for (const row of aoa.slice(hasHeader ? 1 : 0)) {
    const v = clean(row?.[col]);
    if (!v || seen.has(v.toUpperCase())) continue;
    seen.add(v.toUpperCase());
    out.push(v);
  }
  return out;
}
