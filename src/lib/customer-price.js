// Customer-facing sell price from latest cost + per-brand markup,
// then snapped to a Thai retail ending (default 90). Pure: no React, no DB.

import { roundMoney } from './money.js';
import { BRAND_RULES } from './product-classify.js';

export const CUSTOMER_PRICE_BRAND_IDS = BRAND_RULES.map((r) => r.id);

export const DEFAULT_CUSTOMER_PRICE_CONFIG = Object.freeze({
  ending: 90,
  round: 'down',
  default_markup_pct: 30,
  brands: Object.freeze({
    casio: 30,
    seiko: 30,
    alba: 30,
    citizen: 30,
    other: 30,
  }),
});

const ROUND_MODES = new Set(['down', 'up', 'nearest']);

function finiteNumber(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function clampEnding(raw) {
  const n = Math.floor(finiteNumber(raw, 90));
  if (n < 0) return 0;
  if (n > 99) return 99;
  return n;
}

function clampPct(raw, fallback) {
  const n = finiteNumber(raw, fallback);
  if (n < 0) return 0;
  if (n > 500) return 500;
  return n;
}

/**
 * Merge a partial shop_settings.customer_price_config with defaults.
 * Corrupted / missing fields fall back silently.
 */
export function mergeCustomerPriceConfig(partial) {
  const result = {
    ending: DEFAULT_CUSTOMER_PRICE_CONFIG.ending,
    round: DEFAULT_CUSTOMER_PRICE_CONFIG.round,
    default_markup_pct: DEFAULT_CUSTOMER_PRICE_CONFIG.default_markup_pct,
    brands: { ...DEFAULT_CUSTOMER_PRICE_CONFIG.brands },
  };
  if (!partial || typeof partial !== 'object') return result;

  result.ending = clampEnding(partial.ending);
  if (ROUND_MODES.has(partial.round)) result.round = partial.round;
  result.default_markup_pct = clampPct(
    partial.default_markup_pct,
    result.default_markup_pct,
  );

  const srcBrands = partial.brands;
  if (srcBrands && typeof srcBrands === 'object') {
    for (const id of CUSTOMER_PRICE_BRAND_IDS) {
      if (!(id in srcBrands)) continue;
      result.brands[id] = clampPct(srcBrands[id], result.brands[id]);
    }
  }
  return result;
}

export function markupPctForBrand(brand, config) {
  const cfg = config && config.brands ? config : mergeCustomerPriceConfig(config);
  const id = CUSTOMER_PRICE_BRAND_IDS.includes(brand) ? brand : 'other';
  if (Object.prototype.hasOwnProperty.call(cfg.brands, id)) {
    return cfg.brands[id];
  }
  return cfg.default_markup_pct;
}

/** Largest k*100+ending that is <= n. Below `ending` ? 0. */
export function floorToEnding(n, ending = 90) {
  const x = Math.floor(Number(n) || 0);
  const e = clampEnding(ending);
  if (x < e) return 0;
  const lastTwo = x % 100;
  if (lastTwo >= e) return x - (lastTwo - e);
  return x - lastTwo - (100 - e);
}

/** Smallest k*100+ending that is >= n. */
export function ceilToEnding(n, ending = 90) {
  const x = Math.ceil(Number(n) || 0);
  const e = clampEnding(ending);
  if (x <= e) return e;
  const lastTwo = x % 100;
  if (lastTwo <= e) return x - lastTwo + e;
  return x - lastTwo + 100 + e;
}

export function snapToEnding(n, ending = 90, mode = 'down') {
  if (mode === 'up') return ceilToEnding(n, ending);
  if (mode === 'nearest') {
    const down = floorToEnding(n, ending);
    const up = ceilToEnding(n, ending);
    const v = Number(n) || 0;
    if (v - down <= up - v) return down;
    return up;
  }
  return floorToEnding(n, ending);
}

/**
 * @returns {number|null} snapped sell price, or null when cost is missing
 */
export function customerSellPrice(cost, brand, config) {
  const cfg = mergeCustomerPriceConfig(config);
  const c = Number(cost);
  if (!Number.isFinite(c) || c <= 0) return null;
  const pct = markupPctForBrand(brand, cfg);
  const raw = c * (1 + pct / 100);
  const snapped = snapToEnding(raw, cfg.ending, cfg.round);
  if (snapped <= 0) return null;
  return roundMoney(snapped);
}

/**
 * Display fields for a product card. Never includes cost.
 *
 * @returns {{
 *   sell: number|null,
 *   retail: number,
 *   hasSell: boolean,
 *   discountBaht: number,
 *   discountPct: number,
 *   strikeRetail: boolean,
 * }}
 */
export function customerPriceQuote(product, config) {
  const retailRaw = Number(product?.retail_price);
  const retail = Number.isFinite(retailRaw) && retailRaw > 0 ? roundMoney(retailRaw) : 0;
  const brand = product?._brand || 'other';
  const sell = customerSellPrice(product?.cost_price, brand, config);
  const hasSell = sell != null;
  const discountBaht = hasSell && retail > sell ? roundMoney(retail - sell) : 0;
  const discountPct =
    retail > 0 && discountBaht > 0
      ? Math.round((discountBaht / retail) * 100)
      : 0;
  return {
    sell,
    retail,
    hasSell,
    discountBaht,
    discountPct,
    strikeRetail: discountBaht > 0,
  };
}

/** Sell price for filter/sort — null when cost missing. */
export function customerPriceForFilter(product, config) {
  return customerSellPrice(product?.cost_price, product?._brand || 'other', config);
}

/**
 * filterProducts + sell-price range (uses calculated sell, not retail tag).
 * `state` matches filterProducts shape; query is usually already applied via search.
 */
export function filterCustomerPriceProducts(list, state, config, filterProductsFn) {
  const base = filterProductsFn(list, { ...state, minPrice: 0, maxPrice: 0 });
  let d = base;
  if (state.minPrice > 0) {
    d = d.filter((p) => {
      const v = customerPriceForFilter(p, config);
      return v != null && v >= state.minPrice;
    });
  }
  if (state.maxPrice > 0) {
    d = d.filter((p) => {
      const v = customerPriceForFilter(p, config);
      return v != null && v <= state.maxPrice;
    });
  }
  return d;
}

/** Sort with sell price for price-asc/desc; products without sell go last. */
export function sortCustomerPriceProducts(list, mode, config, sortProductsFn) {
  if (mode !== 'price-asc' && mode !== 'price-desc') {
    return sortProductsFn(list, mode);
  }
  const arr = [...list];
  const sell = (p) => customerPriceForFilter(p, config);
  arr.sort((a, b) => {
    const va = sell(a);
    const vb = sell(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return mode === 'price-asc' ? va - vb : vb - va;
  });
  return arr;
}
