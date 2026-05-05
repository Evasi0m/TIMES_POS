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
