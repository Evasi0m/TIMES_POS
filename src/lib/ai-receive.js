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
  return (rows || [])
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
