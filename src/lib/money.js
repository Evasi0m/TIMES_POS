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
 * Default config for the paylater/COD net-received estimator. Mirrors
 * the original hard-coded constants from the first iteration of the
 * formula. Each shop can override any subset via `shop_settings.paylater_config`
 * (see migration 011); missing fields fall back to these defaults.
 *
 * Schema (all numbers; thresholds in baht, rates in percent 0–100):
 *   tier1.high_threshold > tier1.mid_threshold        (price-bracket cuts)
 *   tier1.high_pct, tier1.mid_pct, tier1.low_pct      (markdown % per bracket)
 *   markup.pct1, markup.pct2                          (cascading +%)
 *   tier2.high_threshold > tier2.mid_threshold        (C-bracket cuts)
 *   tier2.high_pct, tier2.mid_pct, tier2.low_pct      (markdown % per bracket)
 *   fee.provider_pct, fee.flat_baht                   (final ×(1−p%) − f baht)
 *
 * Tier rules use STRICT > comparisons with the wider bracket first; see
 * the original spec in plan auto-net-received-formula-a236c5 for the
 * historical ">8000→55, >3500→58, else→55" pattern.
 */
export const DEFAULT_PAYLATER_CONFIG = Object.freeze({
  tier1:  { high_threshold: 8000, mid_threshold: 3500, high_pct: 55, mid_pct: 58, low_pct: 55 },
  markup: { pct1: 37, pct2: 11 },
  tier2:  { high_threshold: 6000, mid_threshold: 2500, high_pct: 10, mid_pct: 8, low_pct: 5 },
  fee:    { provider_pct: 23.08, flat_baht: 1.07 },
});

/**
 * Deep-merge a partial config (e.g. from `shop_settings.paylater_config`,
 * which may be NULL or have missing subtrees) with `DEFAULT_PAYLATER_CONFIG`.
 * Returns a fully-populated config that's safe to feed into
 * `estimateNetReceivedPerUnit`. Non-numeric overrides are silently
 * ignored (fall back to default) so a corrupted DB row can't crash the
 * POS.
 */
export function mergePaylaterConfig(partial) {
  const result = {
    tier1:  { ...DEFAULT_PAYLATER_CONFIG.tier1 },
    markup: { ...DEFAULT_PAYLATER_CONFIG.markup },
    tier2:  { ...DEFAULT_PAYLATER_CONFIG.tier2 },
    fee:    { ...DEFAULT_PAYLATER_CONFIG.fee },
  };
  if (!partial || typeof partial !== 'object') return result;
  for (const group of ['tier1', 'markup', 'tier2', 'fee']) {
    const src = partial[group];
    if (!src || typeof src !== 'object') continue;
    for (const key of Object.keys(result[group])) {
      // Skip null/undefined/empty-string explicitly — Number(null) === 0
      // would otherwise silently zero out a percentage rate.
      const raw = src[key];
      if (raw === null || raw === undefined || raw === '') continue;
      const v = Number(raw);
      if (Number.isFinite(v)) result[group][key] = v;
    }
  }
  return result;
}

/**
 * Estimate the net amount the shop receives per unit after platform +
 * paylater/COD provider fees, given the sticker price. Used to pre-fill
 * "เงินที่ร้านได้รับ" for paylater/cod e-commerce sales where the exact
 * deduction isn't known until 1–2 days after the sale.
 *
 * Formula (parameters editable per shop — see DEFAULT_PAYLATER_CONFIG):
 *
 *   tier1 (price-bracket markdown):
 *     price > tier1.high_threshold        → −tier1.high_pct%
 *     price > tier1.mid_threshold (≤high) → −tier1.mid_pct%
 *     else                                → −tier1.low_pct%
 *   then ×(1 + markup.pct1%) ×(1 + markup.pct2%)  →  C
 *   tier2 (C-bracket markdown):
 *     C > tier2.high_threshold        → −tier2.high_pct%
 *     C > tier2.mid_threshold (≤high) → −tier2.mid_pct%
 *     else                            → −tier2.low_pct%
 *   then ×(1 − fee.provider_pct%) − fee.flat_baht
 *
 * Note rule ordering uses STRICT > with the wider bracket first.
 */
export function estimateNetReceivedPerUnit(unitPrice, config = DEFAULT_PAYLATER_CONFIG) {
  const p = Number(unitPrice) || 0;
  if (p <= 0) return 0;
  const cfg = config === DEFAULT_PAYLATER_CONFIG ? config : mergePaylaterConfig(config);
  // tier1
  let tier1Pct = cfg.tier1.low_pct;
  if (p > cfg.tier1.high_threshold) tier1Pct = cfg.tier1.high_pct;
  else if (p > cfg.tier1.mid_threshold) tier1Pct = cfg.tier1.mid_pct;
  const A = roundMoney(p * (1 - tier1Pct / 100));
  const B = roundMoney(A * (1 + cfg.markup.pct1 / 100));
  const C = roundMoney(B * (1 + cfg.markup.pct2 / 100));
  // tier2
  let tier2Pct = cfg.tier2.low_pct;
  if (C > cfg.tier2.high_threshold) tier2Pct = cfg.tier2.high_pct;
  else if (C > cfg.tier2.mid_threshold) tier2Pct = cfg.tier2.mid_pct;
  const D = roundMoney(C * (1 - tier2Pct / 100));
  const E = roundMoney(D * (1 - cfg.fee.provider_pct / 100) - cfg.fee.flat_baht);
  return E;
}

/**
 * Sum of `estimateNetReceivedPerUnit(line.unit_price) × line.quantity`
 * across the cart. Per-line so that the price-bracket tiers reflect the
 * sticker price of each individual product.
 */
export function estimateNetReceivedTotal(cart, config = DEFAULT_PAYLATER_CONFIG) {
  if (!Array.isArray(cart) || !cart.length) return 0;
  const cfg = config === DEFAULT_PAYLATER_CONFIG ? config : mergePaylaterConfig(config);
  const sum = cart.reduce((acc, l) => {
    const perUnit = estimateNetReceivedPerUnit(l?.unit_price, cfg);
    const q = Number(l?.quantity) || 0;
    return acc + perUnit * q;
  }, 0);
  return roundMoney(Math.max(0, sum));
}
