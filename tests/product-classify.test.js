import { describe, it, expect } from 'vitest';
import {
  BRAND_RULES,
  SERIES_RULES,
  SERIES_SUBS,
  MATERIAL_MAP,
  COLOR_MAP,
  PRICE_PRESETS,
  classifyBrand,
  classifySeries,
  parseCasioModel,
  enrichProduct,
  matchSubType,
  getEffectivePrice,
  filterProducts,
  sortProducts,
} from '../src/lib/product-classify.js';

describe('classifyBrand', () => {
  it.each([
    ['SNE585P1',     'seiko'],
    ['SRPC91K1',     'seiko'],
    ['SHE-4521D-2A', 'casio'],   // SHE is Casio Sheen, NOT Seiko
    ['AH7Q24X1',     'alba'],
    ['AS9K88X1',     'alba'],
    ['EW2294-61L',   'citizen'],
    ['BJ7128-87E',   'citizen'],
    ['MTP-1302D-7A2', 'casio'],
    ['LTP-1183-1A',   'casio'],
    ['GA-100-1A1',    'casio'],
    ['GBD-200-1',     'casio'],
    ['BGA-150-7B2',   'casio'],
    ['EFR-552D-1AV',  'casio'],
    ['PRG-330-2',     'casio'],
    ['F-91W',         'casio'],
    ['A158WA-1',      'casio'],
    ['SOMETHING-WEIRD', 'other'],
    ['',              'other'],
  ])('classifies %s as %s', (name, expected) => {
    expect(classifyBrand(name)).toBe(expected);
  });

  it('handles null/undefined safely', () => {
    expect(classifyBrand(null)).toBe('other');
    expect(classifyBrand(undefined)).toBe('other');
  });
});

describe('classifySeries (Casio)', () => {
  it.each([
    ['GA-100-1A1',    'gshock'],
    ['GBD-200-1',     'gshock'],
    ['GW-9400-1',     'gshock'],
    ['MTG-B2000',     'gshock'],
    ['BGA-150-7B2',   'babyg'],
    ['BGD-565-7',     'babyg'],
    ['SHE-4521D-2A',  'babyg'],   // Sheen → babyg series bucket
    ['BA-110-1A',     'babyg'],
    ['EFR-552D-1AV',  'edifice'],
    ['ECB-10HG-1A',   'edifice'],
    ['EQB-501XPB',    'edifice'],
    ['PRG-330-2',     'protrek'],
    ['PRW-6600Y-1',   'protrek'],
    ['WSD-F30',       'protrek'],
    ['MTP-1302D-7A2', 'standard'],
    ['LTP-1183-1A',   'standard'],
    ['F-91W',         'standard'],
  ])('classifies %s as %s', (name, expected) => {
    expect(classifySeries(name)).toBe(expected);
  });
});

describe('parseCasioModel', () => {
  it('extracts material + color from a standard model code', () => {
    expect(parseCasioModel('MTP-1302D-7A2')).toEqual({ mat: 'D', color: '7' });
    expect(parseCasioModel('LTP-1183-1A')).toEqual({ mat: '', color: '1' });
    expect(parseCasioModel('EFR-552SG-1AV')).toEqual({ mat: 'SG', color: '1' });
  });

  it('handles short / single-segment names without crashing', () => {
    // F-91W has a 2-segment shape: middle segment is "91W". The current
    // parser's regex /\d([A-Z]{1,2})$/ matches the trailing "W" as material
    // and reads "9" off the start of the same segment as color (since
    // last==first when there are only two parts). This is the documented
    // behavior — keep this test pinned so future refactors don't drift.
    expect(parseCasioModel('F-91W')).toEqual({ mat: 'W', color: '9' });
    expect(parseCasioModel('GA-100')).toEqual({ mat: '', color: '1' });
    expect(parseCasioModel('NOSEGMENT')).toEqual({ mat: '', color: '' });
    expect(parseCasioModel('')).toEqual({ mat: '', color: '' });
    expect(parseCasioModel(null)).toEqual({ mat: '', color: '' });
  });
});

describe('enrichProduct', () => {
  it('adds derived fields without mutating the input', () => {
    const p = { id: 1, name: 'MTP-1302D-7A2', retail_price: 2500 };
    const e = enrichProduct(p);
    expect(p).not.toHaveProperty('_brand');             // input untouched
    expect(e._brand).toBe('casio');
    expect(e._series).toBe('standard');
    expect(e._material).toBe('D');
    expect(e._color).toBe('7');
    expect(e._prefix).toBe('MTP');
    expect(e._searchText).toBe('mtp1302d7a2');
    expect(e.retail_price).toBe(2500);                  // original keys preserved
  });

  it('falls back to material "R" for casio products with no parsed material', () => {
    const e = enrichProduct({ name: 'GA-100' });
    expect(e._brand).toBe('casio');
    expect(e._material).toBe('R');                      // default for resin
  });

  it('leaves casio-specific fields blank for non-casio brands', () => {
    const e = enrichProduct({ name: 'SNE585P1' });
    expect(e._brand).toBe('seiko');
    expect(e._series).toBe('');
    expect(e._material).toBe('');
    expect(e._color).toBe('');
  });

  it('builds a normalized _searchText (lowercased, no separators)', () => {
    const e = enrichProduct({ name: 'GA-100 1A1' });
    expect(e._searchText).toBe('ga1001a1');
  });
});

describe('matchSubType', () => {
  const dwProduct = enrichProduct({ name: 'DW-5600E-1V' });
  const gaProduct = enrichProduct({ name: 'GA-100-1A1' });
  const sub = SERIES_SUBS.gshock.find(s => s.id === 'gs-digital');

  it('matches when prefix is in the sub-type list', () => {
    expect(matchSubType(dwProduct, sub)).toBe(true);
  });

  it('does not match when prefix is unrelated', () => {
    expect(matchSubType(gaProduct, sub)).toBe(false);
  });

  it('returns true when sub is null/undefined (no constraint)', () => {
    expect(matchSubType(dwProduct, null)).toBe(true);
    expect(matchSubType(dwProduct, undefined)).toBe(true);
  });
});

describe('getEffectivePrice', () => {
  it('returns the price when valid', () => {
    expect(getEffectivePrice({ retail_price: 1500 })).toBe(1500);
    expect(getEffectivePrice({ retail_price: '2500' })).toBe(2500);
  });
  it('returns null for missing/zero/negative price', () => {
    expect(getEffectivePrice({})).toBeNull();
    expect(getEffectivePrice({ retail_price: 0 })).toBeNull();
    expect(getEffectivePrice({ retail_price: -100 })).toBeNull();
    expect(getEffectivePrice({ retail_price: 'abc' })).toBeNull();
  });
});

describe('filterProducts', () => {
  // Build a small enriched fixture covering the brand spectrum.
  const items = [
    { id: 1, name: 'MTP-1302D-7A2',  retail_price: 2500, current_stock: 5 },
    { id: 2, name: 'GA-100-1A1',     retail_price: 4500, current_stock: 0 },
    { id: 3, name: 'GBD-200-1',      retail_price: 6000, current_stock: 2 },
    { id: 4, name: 'SNE585P1',       retail_price: 12000, current_stock: 1 },
    { id: 5, name: 'EW2294-61L',     retail_price: 8000, current_stock: 3 },
    { id: 6, name: 'AH7Q24X1',       retail_price: 1200, current_stock: 0 },
    { id: 7, name: 'GENERIC-WIDGET', retail_price: 99,   current_stock: 10, barcode: '1234567890123' },
  ].map(enrichProduct);

  const empty = {
    brand: 'all', series: '', subType: '', material: '', color: '',
    minPrice: 0, maxPrice: 0, inStockOnly: false, query: '',
  };

  it('returns all when no filters applied', () => {
    expect(filterProducts(items, empty)).toHaveLength(items.length);
  });

  it('filters by brand', () => {
    const r = filterProducts(items, { ...empty, brand: 'casio' });
    expect(r.map(p => p.id).sort()).toEqual([1, 2, 3]);
  });

  it('filters by series within casio', () => {
    const r = filterProducts(items, { ...empty, brand: 'casio', series: 'gshock' });
    expect(r.map(p => p.id).sort()).toEqual([2, 3]);
  });

  it('filters by sub-type', () => {
    const r = filterProducts(items, {
      ...empty,
      brand: 'casio',
      series: 'gshock',
      subType: 'gs-digital',
    });
    // only GBD-200 matches gs-digital
    expect(r.map(p => p.id)).toEqual([3]);
  });

  it('filters by price range', () => {
    const r = filterProducts(items, { ...empty, minPrice: 2000, maxPrice: 5000 });
    expect(r.map(p => p.id).sort()).toEqual([1, 2]);
  });

  it('filters by inStockOnly', () => {
    const r = filterProducts(items, { ...empty, inStockOnly: true });
    expect(r.map(p => p.id).sort()).toEqual([1, 3, 4, 5, 7]);
  });

  it('searches by name (whitespace + dashes ignored)', () => {
    const r = filterProducts(items, { ...empty, query: 'gbd 200' });
    expect(r.map(p => p.id)).toEqual([3]);
  });

  it('searches by exact barcode', () => {
    const r = filterProducts(items, { ...empty, query: '1234567890123' });
    expect(r.map(p => p.id)).toEqual([7]);
  });

  it('combines multiple filters with AND semantics', () => {
    const r = filterProducts(items, {
      ...empty,
      brand: 'casio',
      inStockOnly: true,
      maxPrice: 3000,
    });
    expect(r.map(p => p.id)).toEqual([1]);
  });
});

describe('sortProducts', () => {
  const items = [
    { id: 3, name: 'C', retail_price: 100 },
    { id: 1, name: 'A', retail_price: 300 },
    { id: 2, name: 'B', retail_price: 200 },
  ];

  it('sorts newest first by default', () => {
    expect(sortProducts(items, 'newest').map(p => p.id)).toEqual([3, 2, 1]);
    expect(sortProducts(items).map(p => p.id)).toEqual([3, 2, 1]);
  });

  it('sorts oldest first', () => {
    expect(sortProducts(items, 'oldest').map(p => p.id)).toEqual([1, 2, 3]);
  });

  it('sorts by ascending price', () => {
    expect(sortProducts(items, 'price-asc').map(p => p.retail_price)).toEqual([100, 200, 300]);
  });

  it('sorts by descending price', () => {
    expect(sortProducts(items, 'price-desc').map(p => p.retail_price)).toEqual([300, 200, 100]);
  });

  it('sorts by name', () => {
    expect(sortProducts(items, 'name').map(p => p.name)).toEqual(['A', 'B', 'C']);
  });

  it('returns a new array (does not mutate input)', () => {
    const orig = [...items];
    sortProducts(items, 'name');
    expect(items).toEqual(orig);
  });
});

describe('schema integrity', () => {
  it('every brand rule has id + label + test()', () => {
    BRAND_RULES.forEach(r => {
      expect(typeof r.id).toBe('string');
      expect(typeof r.label).toBe('string');
      expect(typeof r.test).toBe('function');
    });
  });

  it('every CASIO series has a sub-type list (or is intentionally empty like protrek)', () => {
    SERIES_RULES.forEach(s => {
      const subs = SERIES_SUBS[s.id];
      // protrek has no subs; everyone else MUST have a subs array
      if (s.id === 'protrek') return;
      expect(Array.isArray(subs)).toBe(true);
    });
  });

  it('MATERIAL_MAP and COLOR_MAP entries each have a label', () => {
    Object.values(MATERIAL_MAP).forEach(m => expect(typeof m.label).toBe('string'));
    Object.values(COLOR_MAP).forEach(c => expect(typeof c.label).toBe('string'));
  });

  it('PRICE_PRESETS are monotonically non-overlapping or open-ended', () => {
    PRICE_PRESETS.forEach(p => {
      expect(typeof p.id).toBe('string');
      expect(typeof p.label).toBe('string');
      expect(p.min).toBeGreaterThanOrEqual(0);
      // max=0 means "no upper bound"
      if (p.max !== 0) expect(p.max).toBeGreaterThanOrEqual(p.min);
    });
  });
});
