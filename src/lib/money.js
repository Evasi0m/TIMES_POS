// Currency-safe math for THB (Thai baht). Pure functions, no React, no
// Supabase — so they're trivial to unit-test (see tests/money.test.js).
//
// Background: JavaScript Number is IEEE-754 double, so 0.1 + 0.2 !== 0.3.
// Cascading discounts × VAT × quantity quickly drift by satang on a real
// receipt. Every step rounds to 2 decimals (1 satang = 0.01 baht).

/** Round a value to 2 decimals (1 satang). Tolerates strings/null/undefined. */
export const roundMoney = (n) =>
  Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

/** Format as "฿1,234" or "฿1,234.50" depending on whether there are satang. */
export const fmtTHB = (n) =>
  '฿' + roundMoney(n).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

export const VAT_RATE_DEFAULT = 7;

/**
 * Split a VAT-inclusive grand total into ex-VAT + VAT.
 * Thai retail standard: the displayed price already includes VAT.
 *
 * Returns { vat, exVat } where roundMoney(vat + exVat) === roundMoney(grand).
 */
export function vatBreakdown(grandTotal, vatRate = VAT_RATE_DEFAULT) {
  const r = (Number(vatRate) || 0) / 100;
  const g = roundMoney(grandTotal);
  if (r <= 0) return { vat: 0, exVat: g };
  const exVat = roundMoney(g / (1 + r));
  const vat = roundMoney(g - exVat);
  return { vat, exVat };
}

/**
 * Compute a line total after up to two cascading discounts (each can be
 * 'percent' or 'baht'). Negative totals are clamped to 0. Every step rounds
 * to satang so cascading drift can't accumulate.
 *
 * @param {number} unitPrice  per-unit price BEFORE discounts
 * @param {number} qty        quantity (≥ 0; non-numbers become 0)
 * @param {number} d1v        first discount value
 * @param {'percent'|'baht'|null|undefined} d1t  first discount type
 * @param {number} d2v        second discount value (applied after first)
 * @param {'percent'|'baht'|null|undefined} d2t  second discount type
 */
export function applyDiscounts(unitPrice, qty, d1v, d1t, d2v, d2t) {
  let s1 = roundMoney(unitPrice);
  if (d1t === 'percent') s1 = roundMoney(s1 * (1 - (Number(d1v) || 0) / 100));
  else if (d1t === 'baht') s1 = roundMoney(s1 - (Number(d1v) || 0));
  let s2 = s1;
  if (d2t === 'percent') s2 = roundMoney(s2 * (1 - (Number(d2v) || 0) / 100));
  else if (d2t === 'baht') s2 = roundMoney(s2 - (Number(d2v) || 0));
  return roundMoney(Math.max(0, s2) * (Number(qty) || 0));
}

/**
 * Estimate the net amount the shop receives per unit after platform +
 * paylater/COD provider fees, given the sticker price. Used to pre-fill
 * "เงินที่ร้านได้รับ" for paylater/cod e-commerce sales where the exact
 * deduction isn't known until 1–2 days after the sale.
 *
 * Formula (per shop spec — see plan auto-net-received-formula-a236c5):
 *
 *   tier1 (price-bracket markdown — counter-intuitive but correct):
 *     unit_price > 8000        → −55%
 *     8000 ≥ unit_price > 3500 → −58%
 *     unit_price ≤ 3500        → −55%
 *   then +37% then +11%  →  C
 *   tier2 (markdown by C):
 *     C > 6000 → −10%
 *     C > 2500 → −8%
 *     else     → −5%
 *   then ×(1 − 0.2308) − 1.07 baht (paylater fee + flat transaction fee)
 *
 * Note the rule order: ">8000 → 55%" overrides ">3500 → 58%", and
 * ">6000 → 10%" overrides ">2500 → 8%". Implementation uses if/else if
 * with the wider bracket first to honour that.
 */
export function estimateNetReceivedPerUnit(unitPrice) {
  const p = Number(unitPrice) || 0;
  if (p <= 0) return 0;
  // tier1
  let tier1 = 0.55;
  if (p > 8000) tier1 = 0.55;
  else if (p > 3500) tier1 = 0.58;
  const A = roundMoney(p * (1 - tier1));
  const B = roundMoney(A * 1.37);
  const C = roundMoney(B * 1.11);
  // tier2
  let tier2 = 0.05;
  if (C > 6000) tier2 = 0.10;
  else if (C > 2500) tier2 = 0.08;
  const D = roundMoney(C * (1 - tier2));
  const E = roundMoney(D * (1 - 0.2308) - 1.07);
  return E;
}

/**
 * Sum of `estimateNetReceivedPerUnit(line.unit_price) × line.quantity`
 * across the cart. Per-line so that the price-bracket tiers reflect the
 * sticker price of each individual product.
 */
export function estimateNetReceivedTotal(cart) {
  if (!Array.isArray(cart) || !cart.length) return 0;
  const sum = cart.reduce((acc, l) => {
    const perUnit = estimateNetReceivedPerUnit(l?.unit_price);
    const q = Number(l?.quantity) || 0;
    return acc + perUnit * q;
  }, 0);
  return roundMoney(Math.max(0, sum));
}
