import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CUSTOMER_PRICE_CONFIG,
  mergeCustomerPriceConfig,
  floorToEnding,
  ceilToEnding,
  snapToEnding,
  markupPctForBrand,
  customerSellPrice,
  customerPriceQuote,
  filterCustomerPriceProducts,
  sortCustomerPriceProducts,
} from '../src/lib/customer-price.js';

describe('floorToEnding', () => {
  it('1000+30% raw 1300 floors to 1290', () => {
    expect(floorToEnding(1300, 90)).toBe(1290);
  });
  it('already on ending does not move', () => {
    expect(floorToEnding(1290, 90)).toBe(1290);
    expect(floorToEnding(90, 90)).toBe(90);
  });
  it('below ending returns 0', () => {
    expect(floorToEnding(89, 90)).toBe(0);
    expect(floorToEnding(50, 90)).toBe(0);
  });
  it('1250 floors to previous xx90', () => {
    expect(floorToEnding(1250, 90)).toBe(1190);
  });
});

describe('ceilToEnding / nearest', () => {
  it('1300 ceils to 1390', () => {
    expect(ceilToEnding(1300, 90)).toBe(1390);
  });
  it('nearest of 1300 prefers 1290 (closer)', () => {
    expect(snapToEnding(1300, 90, 'nearest')).toBe(1290);
  });
  it('nearest of 1350 prefers 1390', () => {
    expect(snapToEnding(1350, 90, 'nearest')).toBe(1390);
  });
});

describe('customerSellPrice', () => {
  it('cost 1000 + 30% down-to-90 = 1290', () => {
    expect(customerSellPrice(1000, 'casio', DEFAULT_CUSTOMER_PRICE_CONFIG)).toBe(1290);
  });
  it('cost 0 / missing returns null', () => {
    expect(customerSellPrice(0, 'casio')).toBe(null);
    expect(customerSellPrice(null, 'casio')).toBe(null);
    expect(customerSellPrice(-10, 'casio')).toBe(null);
  });
  it('uses per-brand markup', () => {
    const cfg = mergeCustomerPriceConfig({
      brands: { seiko: 50, casio: 30 },
    });
    expect(customerSellPrice(1000, 'seiko', cfg)).toBe(1490);
    expect(customerSellPrice(1000, 'casio', cfg)).toBe(1290);
  });
});

describe('mergeCustomerPriceConfig', () => {
  it('fills missing brands from defaults', () => {
    const cfg = mergeCustomerPriceConfig({ brands: { casio: 25 } });
    expect(cfg.brands.casio).toBe(25);
    expect(cfg.brands.seiko).toBe(30);
    expect(cfg.ending).toBe(90);
    expect(cfg.round).toBe('down');
  });
  it('ignores junk numbers', () => {
    const cfg = mergeCustomerPriceConfig({
      ending: 'nope',
      round: 'sideways',
      default_markup_pct: '',
      brands: { casio: 'x' },
    });
    expect(cfg.ending).toBe(90);
    expect(cfg.round).toBe('down');
    expect(cfg.default_markup_pct).toBe(30);
    expect(cfg.brands.casio).toBe(30);
  });
});

describe('markupPctForBrand', () => {
  it('unknown brand uses other', () => {
    const cfg = mergeCustomerPriceConfig({ brands: { other: 12 } });
    expect(markupPctForBrand('nope', cfg)).toBe(12);
  });
});

describe('customerPriceQuote', () => {
  it('strikes retail when sell is below tag', () => {
    const q = customerPriceQuote(
      { cost_price: 1000, retail_price: 1990, _brand: 'casio' },
      DEFAULT_CUSTOMER_PRICE_CONFIG,
    );
    expect(q.sell).toBe(1290);
    expect(q.retail).toBe(1990);
    expect(q.strikeRetail).toBe(true);
    expect(q.discountBaht).toBe(700);
    expect(q.discountPct).toBe(35);
  });
  it('does not strike when sell is above retail', () => {
    const q = customerPriceQuote(
      { cost_price: 1000, retail_price: 990, _brand: 'casio' },
      DEFAULT_CUSTOMER_PRICE_CONFIG,
    );
    expect(q.sell).toBe(1290);
    expect(q.strikeRetail).toBe(false);
    expect(q.discountBaht).toBe(0);
  });
  it('no sell when cost missing', () => {
    const q = customerPriceQuote(
      { cost_price: 0, retail_price: 6900, _brand: 'casio' },
      DEFAULT_CUSTOMER_PRICE_CONFIG,
    );
    expect(q.hasSell).toBe(false);
    expect(q.sell).toBe(null);
    expect(q.strikeRetail).toBe(false);
  });
});

describe('filterCustomerPriceProducts / sortCustomerPriceProducts', () => {
  const rows = [
    { id: 1, name: 'MTP-1000', cost_price: 1000, retail_price: 1990, _brand: 'casio' },
    { id: 2, name: 'MTP-2000', cost_price: 500, retail_price: 990, _brand: 'casio' },
    { id: 3, name: 'SNK-001', cost_price: 0, retail_price: 3000, _brand: 'seiko' },
  ];

  it('filters by sell price range', () => {
    const out = filterCustomerPriceProducts(
      rows,
      { brand: 'all', series: '', subType: '', material: '', color: '', minPrice: 1200, maxPrice: 0, inStockOnly: false, query: '' },
      DEFAULT_CUSTOMER_PRICE_CONFIG,
      (list, state) => list,
    );
    expect(out.map((p) => p.id)).toEqual([1]);
  });

  it('sorts by sell price ascending; no-cost last', () => {
    const sorted = sortCustomerPriceProducts(
      rows,
      'price-asc',
      DEFAULT_CUSTOMER_PRICE_CONFIG,
      () => rows,
    );
    expect(sorted.map((p) => p.id)).toEqual([2, 1, 3]);
  });
});
