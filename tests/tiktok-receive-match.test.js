import { describe, it, expect } from 'vitest';
import {
  posLineQuery,
  matchTikTokByBarcode,
  classifyPosToTikTok,
  filterCandidatesByMinPct,
  filterTikTokSkusByTerm,
  prefetchQueriesForLines,
  posSkuSearchVariants,
  tiktokSkuAsMatchProduct,
} from '../src/lib/tiktok-receive-match.js';

const CATALOG = [
  {
    tiktok_sku_id: 'sku-1',
    tiktok_product_id: 'prod-1',
    seller_sku: 'LTP-1302DS-4AVDF',
    product_name: 'Casio LTP',
    quantity: 9,
  },
  {
    tiktok_sku_id: 'sku-2',
    tiktok_product_id: 'prod-2',
    seller_sku: 'W-218H-8BVDF',
    product_name: 'Casio W218',
    quantity: 3,
  },
  {
    tiktok_sku_id: 'sku-3',
    tiktok_product_id: 'prod-3',
    seller_sku: '99999999',
    product_name: 'Unrelated',
    quantity: 1,
  },
];

describe('posLineQuery', () => {
  it('prefers product_name', () => {
    expect(posLineQuery({ product_name: 'LTP-1302DS', barcode: 'X' })).toBe('LTP-1302DS');
  });
  it('falls back to name then barcode', () => {
    expect(posLineQuery({ name: 'W-218H' })).toBe('W-218H');
    expect(posLineQuery({ barcode: 'LTP-1302DS-4AVDF' })).toBe('LTP-1302DS-4AVDF');
  });
  it('returns empty for missing fields', () => {
    expect(posLineQuery({})).toBe('');
  });
});

describe('matchTikTokByBarcode', () => {
  it('matches seller_sku exactly', () => {
    const hit = matchTikTokByBarcode(
      { barcode: 'LTP-1302DS-4AVDF' },
      CATALOG,
    );
    expect(hit?.tiktok_sku_id).toBe('sku-1');
    expect(hit?.seller_sku).toBe('LTP-1302DS-4AVDF');
  });
  it('returns null when barcode empty or no hit', () => {
    expect(matchTikTokByBarcode({ barcode: '' }, CATALOG)).toBeNull();
    expect(matchTikTokByBarcode({ barcode: 'NOPE' }, CATALOG)).toBeNull();
  });
});

describe('classifyPosToTikTok', () => {
  it('auto-matches identical model code', () => {
    const r = classifyPosToTikTok(
      { product_name: 'LTP-1302DS-4AVDF' },
      CATALOG,
    );
    expect(r.status).toBe('auto');
    expect(r.sku?.tiktok_sku_id).toBe('sku-1');
  });
  it('returns candidates for partial match', () => {
    const r = classifyPosToTikTok(
      { product_name: 'W-218H-8B' },
      CATALOG,
    );
    expect(['suggestions', 'auto']).toContain(r.status);
    expect(r.candidates?.length).toBeGreaterThan(0);
  });
  it('returns none for empty query or catalog', () => {
    expect(classifyPosToTikTok({}, CATALOG).status).toBe('none');
    expect(classifyPosToTikTok({ product_name: 'LTP' }, []).status).toBe('none');
  });
});

describe('filterCandidatesByMinPct', () => {
  const candidates = [
    { score: 0.95, sku: { tiktok_sku_id: 'a' } },
    { score: 0.72, sku: { tiktok_sku_id: 'b' } },
    { score: 0.55, sku: { tiktok_sku_id: 'c' } },
  ];

  it('filters by minimum percentage', () => {
    expect(filterCandidatesByMinPct(candidates, 80)).toHaveLength(1);
    expect(filterCandidatesByMinPct(candidates, 80)[0].sku.tiktok_sku_id).toBe('a');
  });
  it('returns all when threshold is 0', () => {
    expect(filterCandidatesByMinPct(candidates, 0)).toHaveLength(3);
  });
});

describe('prefetchQueriesForLines', () => {
  it('includes stripped suffix variant GBD-200-1 for distributor code', () => {
    const qs = prefetchQueriesForLines([
      { product_name: 'GBD-200-1DR', barcode: 'GBD2001DR' },
    ]);
    expect(qs).toContain('GBD-200-1DR');
    expect(qs).toContain('GBD-200');
    expect(qs).toContain('GBD-200-1');
    expect(qs).toContain('GBD2001DR');
  });
  it('dedupes and respects maxQueries', () => {
    const qs = prefetchQueriesForLines([
      { product_name: 'ABC', barcode: 'ABC' },
      { product_name: 'ABC', barcode: 'ABC' },
    ], 3);
    expect(qs).toEqual(['ABC']);
  });
});

describe('posSkuSearchVariants', () => {
  it('strips DR suffix from GBD-200-1DR', () => {
    const v = posSkuSearchVariants('GBD-200-1DR');
    expect(v).toContain('GBD-200-1');
    expect(v).toContain('GBD-200-1DR');
    expect(v).toContain('GBD-200');
  });
});

describe('classifyPosToTikTok GBD suffix', () => {
  const gbdCatalog = [{
    tiktok_sku_id: 'gbd-1',
    tiktok_product_id: 'prod-gbd',
    seller_sku: 'GBD-200-1',
    product_name: 'Casio GBD',
    quantity: 2,
  }];

  it('auto-matches GBD-200-1DR to GBD-200-1 at 97%', () => {
    const r = classifyPosToTikTok({ product_name: 'GBD-200-1DR' }, gbdCatalog);
    expect(r.status).toBe('auto');
    expect(r.sku?.seller_sku).toBe('GBD-200-1');
    expect(r.score).toBeGreaterThanOrEqual(0.97);
  });
});

describe('filterTikTokSkusByTerm', () => {
  const noise = [
    { tiktok_sku_id: 'gmw', tiktok_product_id: 'p1', seller_sku: 'GMW-B5000D-1', product_name: 'G-Shock', quantity: 1 },
    { tiktok_sku_id: 'gba', tiktok_product_id: 'p2', seller_sku: 'GBA-950-1A', product_name: 'G-Shock', quantity: 1 },
    { tiktok_sku_id: 'gbd', tiktok_product_id: 'p3', seller_sku: 'GBD-200-1', product_name: 'Casio GBD', quantity: 2 },
  ];

  it('filters unfiltered API page to matching SKU only', () => {
    const hits = filterTikTokSkusByTerm('GBD-200-1', noise);
    expect(hits).toHaveLength(1);
    expect(hits[0].seller_sku).toBe('GBD-200-1');
    expect(hits[0]._score).toBeGreaterThanOrEqual(0.97);
  });

  it('returns empty when nothing matches search term', () => {
    expect(filterTikTokSkusByTerm('ZZZ-999', noise)).toHaveLength(0);
  });
});

describe('tiktokSkuAsMatchProduct', () => {
  it('maps seller_sku to name and barcode fields', () => {
    const p = tiktokSkuAsMatchProduct(CATALOG[0]);
    expect(p.id).toBe('sku-1');
    expect(p.name).toBe('LTP-1302DS-4AVDF');
    expect(p.barcode).toBe('LTP-1302DS-4AVDF');
    expect(p.quantity).toBe(9);
  });
  it('preserves image_url from catalog row', () => {
    const p = tiktokSkuAsMatchProduct({
      ...CATALOG[0],
      image_url: 'https://cdn.example/sku.jpg',
    });
    expect(p.image_url).toBe('https://cdn.example/sku.jpg');
    expect(p.sku_image_url).toBe('https://cdn.example/sku.jpg');
  });
});
