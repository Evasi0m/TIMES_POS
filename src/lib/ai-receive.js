// Pure assembly of AI-bill-scan review rows → receive-order RPC payload.
//
// Extracted from BulkReceiveView's submit loop so the money-sensitive part
// (VAT net→gross, 0-cost/0-qty guard, totals) is unit-testable without a
// DB or React. The component still owns product resolution (matched vs
// just-inserted-new) and hands us rows whose `product` is already resolved.
//
// CMG bills print PRE-VAT unit costs; we store the GROSS (VAT-inclusive)
// cost. `hasVat !== false` means "add 7% VAT" (default on, since CMG always
// issues VAT invoices); pass `false` for the rare pre-summed bill.

import { roundMoney, addVat, vatBreakdown, VAT_RATE_DEFAULT } from './money.js';
import { normalizeCode } from './fuzzy-match.js';

/**
 * Build the `p_items` array for `create_stock_movement_with_items`.
 *
 * @param {Array<{product:{id:any,name:string}, quantity:number, unit_cost:number}>} rows
 *        rows with an ALREADY-RESOLVED `product` (null product rows are dropped)
 * @param {boolean} hasVat  add 7% VAT to each unit cost (default true)
 * @returns {Array<object>} RPC line items (unit_price = gross per-unit cost)
 * @throws if any resolved row has cost ≤ 0 or qty ≤ 0 (defensive — the UI
 *         already blocks submit on 'incomplete' rows, but never persist a
 *         0-cost line that would corrupt profit math)
 */
export function buildReceiveItems(rows, hasVat) {
  const vatApplies = hasVat !== false;
  const lines = (rows || [])
    .map((r) => {
      const product = r && r.product;
      if (!product) return null;
      const qty  = Math.max(0, Number(r.quantity)  || 0);
      const cost = Math.max(0, Number(r.unit_cost) || 0);
      if (cost <= 0 || qty <= 0) {
        throw new Error(
          `รายการ "${product.name || ''}" มี ทุน/จำนวน เป็น 0 — กรอกให้ครบก่อนบันทึก`
        );
      }
      const grossCost = vatApplies ? addVat(cost) : roundMoney(cost);
      return {
        product_id: product.id,
        product_name: product.name,
        quantity: qty,
        unit: 'เรือน',
        unit_price: grossCost,
        discount1_value: 0, discount1_type: null,
        discount2_value: 0, discount2_type: null,
      };
    })
    .filter(Boolean);

  // A CMG bill never lists the same product twice. Two rows resolving to
  // one product means one line was matched to the wrong model — refuse to
  // save rather than silently summing the quantities.
  const seen = new Set();
  for (const line of lines) {
    if (seen.has(line.product_id)) {
      throw new Error(
        `สินค้า "${line.product_name}" ถูกจับคู่ซ้ำ 2 แถวในบิลนี้ — ในบิลหนึ่งใบไม่มีรุ่นซ้ำ ให้แก้แถวที่จับคู่ผิดเป็นรุ่นที่ถูก`
      );
    }
    seen.add(line.product_id);
  }
  return lines;
}

/** Merge duplicate product_id rows in an RPC items payload (manual receive). */
export function mergeRpcLineItems(items) {
  const merged = new Map();
  for (const line of items || []) {
    const pid = line.product_id;
    if (!pid) continue;
    const prev = merged.get(pid);
    if (!prev) {
      merged.set(pid, { ...line });
      continue;
    }
    if (prev.unit_price !== line.unit_price) {
      throw new Error(
        `สินค้า "${line.product_name}" ซ้ำในบิลนี้แต่ราคาต่างกัน — รวมแถวหรือแก้ราคาให้ตรงก่อนบันทึก`
      );
    }
    prev.quantity += line.quantity;
  }
  const withoutPid = (items || []).filter((l) => !l.product_id);
  return [...merged.values(), ...withoutPid];
}

/** Stable merge key for a review row (resolved product or pending new SKU). */
export function billRowMergeKey(row) {
  if (row?.product?.id) return `id:${row.product.id}`;
  if (row?.status === 'new') {
    const name = String(row.newProduct?.name || '').trim();
    if (name) return `new:${name}`;
  }
  const code = normalizeCode(row?.model_code);
  if (code && (row?.status === 'auto' || row?.status === 'new')) return `code:${code}`;
  return null;
}

/**
 * Detect duplicate rows that would collide on save with different unit costs.
 * @returns {{ name: string, detail: string, indices: number[] }[]}
 */
export function findBillRowCostConflicts(rows) {
  const groups = new Map();
  (rows || []).forEach((r, index) => {
    const key = billRowMergeKey(r);
    if (!key) return;
    const cost = roundMoney(Number(r.unit_cost) || 0);
    const name = r.product?.name || r.newProduct?.name || r.model_code || `แถว ${index + 1}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ index, cost, name });
  });

  const conflicts = [];
  for (const entries of groups.values()) {
    if (entries.length < 2) continue;
    const costs = new Set(entries.map((e) => e.cost));
    if (costs.size <= 1) continue;
    const name = entries[0].name;
    const detail = entries.map((e) => `แถว ${e.index + 1}: ทุน ${e.cost}`).join(', ');
    conflicts.push({ name, detail, indices: entries.map((e) => e.index) });
  }
  return conflicts;
}

/**
 * Rows that resolve to the same product (or the same new-product name).
 * A CMG bill never repeats a model, so every group here is a mis-match.
 * @returns {{ name: string, indices: number[] }[]}
 */
export function findDuplicateProductRows(rows) {
  const groups = new Map();
  (rows || []).forEach((r, index) => {
    let key = null;
    if (r?.product?.id) key = `id:${r.product.id}`;
    else if (r?.status === 'new') {
      const name = String(r.newProduct?.name || '').trim();
      if (name) key = `new:${name.toUpperCase()}`;
    }
    if (!key) return;
    const name = r.product?.name || r.newProduct?.name || r.model_code || `แถว ${index + 1}`;
    if (!groups.has(key)) groups.set(key, { name, indices: [] });
    groups.get(key).indices.push(index);
  });
  return [...groups.values()].filter((g) => g.indices.length > 1);
}

export function formatDuplicateProductError(dups) {
  const first = dups[0];
  if (!first) return '';
  const rowsTxt = first.indices.map((i) => i + 1).join(' และ ');
  return `แถว ${rowsTxt} จับคู่เป็น "${first.name}" เหมือนกัน — ในบิลหนึ่งใบไม่มีรุ่นซ้ำ แก้แถวที่ผิดให้เป็นรุ่นที่ถูกก่อนบันทึก`;
}

export function formatBillRowCostConflictError(conflicts) {
  const first = conflicts[0];
  if (!first) return '';
  const suffix = conflicts.length > 1 ? ` (+${conflicts.length - 1} รุ่น)` : '';
  return `สินค้า "${first.name}" ซ้ำในบิลแต่ทุนต่างกัน (${first.detail})${suffix} — ลบแถวซ้ำหรือแก้ทุนให้ตรงก่อนบันทึก`;
}

/** Probe product for pre-submit buildReceiveItems (unique key per pending new SKU). */
export function probeProductForSubmitRow(row) {
  if (row?.status === 'new' && row.newProduct?.name?.trim()) {
    const name = row.newProduct.name.trim();
    return { id: `new:${name}`, name };
  }
  if (row?.product?.id) return row.product;
  return null;
}

/**
 * Totals for a receive header from already-built items.
 * @returns {{ total:number, vat:number }} grand total (gross) + VAT portion
 */
export function receiveTotals(items, hasVat) {
  const vatApplies = hasVat !== false;
  const total = roundMoney(
    (items || []).reduce((s, l) => s + (Number(l.unit_price) || 0) * (Number(l.quantity) || 0), 0)
  );
  const { vat } = vatBreakdown(total, vatApplies ? VAT_RATE_DEFAULT : 0);
  return { total, vat };
}

/**
 * Gross cost to store for a newly-created product (pre-VAT bill cost + VAT).
 * Mirrors buildReceiveItems' per-unit math so a new product's cost_price and
 * the receive line's unit_price always agree.
 */
export function grossUnitCost(unitCost, hasVat) {
  return hasVat !== false ? addVat(unitCost) : roundMoney(unitCost);
}

/**
 * Suggested retail (ราคาป้าย) for a new product from its pre-VAT bill cost.
 * `factor` is a multiplier on the GROSS cost (e.g. 1.5 / 2). Rounded to a
 * tidy 10-baht so suggested tags don't read like 1712.31.
 */
export function suggestedRetail(unitCost, hasVat, factor = 2) {
  const gross = grossUnitCost(unitCost, hasVat);
  const raw = gross * (Number(factor) || 1);
  return Math.max(0, Math.round(raw / 10) * 10);
}
