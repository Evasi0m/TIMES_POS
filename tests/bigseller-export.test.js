import { describe, it, expect } from 'vitest';
import {
  movementDecision, resolveMerchantSku, resolveSkuMap, netByProduct, aggregateBySku,
  buildStockInAoa, buildStockOutAoa, chunkRows, exportFilename, parseSkuSheet, reconcileLines,
  STOCK_IN_HEADERS, STOCK_OUT_HEADERS,
} from '../src/lib/bigseller-export.js';

describe('movementDecision', () => {
  it('always exports receive / adjust / claim / reconcile reasons', () => {
    for (const reason of ['receive', 'receive_void', 'receive_edit', 'manual_adjust',
      'supplier_claim', 'supplier_claim_void', 'stock_reconcile']) {
      expect(movementDecision({ reason, channel: 'tiktok' })).toBe('export');
    }
  });
  it('exports order moves only for channels BigSeller cannot see', () => {
    for (const reason of ['sale', 'sale_void', 'sale_edit', 'return_in', 'return_void']) {
      expect(movementDecision({ reason, channel: 'store' })).toBe('export');
      expect(movementDecision({ reason, channel: 'facebook' })).toBe('export');
      expect(movementDecision({ reason, channel: 'web' })).toBe('export');
      expect(movementDecision({ reason, channel: null })).toBe('export');
      expect(movementDecision({ reason, channel: 'tiktok' })).toBe('skip');
      expect(movementDecision({ reason, channel: 'Shopee' })).toBe('skip');
      expect(movementDecision({ reason, channel: 'lazada' })).toBe('skip');
    }
  });
  it('skips initial and flags unknown reasons', () => {
    expect(movementDecision({ reason: 'initial' })).toBe('skip');
    expect(movementDecision({ reason: 'teleport' })).toBe('unknown');
  });
});

describe('resolveMerchantSku', () => {
  const skus = ['W-221H-1', 'W-221H-1A', 'GA-2100-1A1', 'ga-2100-1a1'];
  it('prefers the TikTok seller_sku', () => {
    expect(resolveMerchantSku({ name: 'W-221H-1AVDF' }, ['W-221H-1A'], skus))
      .toEqual({ sku: 'W-221H-1A', source: 'tiktok' });
  });
  it('flags conflicting TikTok SKUs', () => {
    const r = resolveMerchantSku({ name: 'X' }, ['A-1', 'B-2'], skus);
    expect(r.sku).toBeNull();
    expect(r.problem).toBe('conflict');
  });
  it('picks the longest prefix, not a shorter one', () => {
    expect(resolveMerchantSku({ name: ' w-221h-1avdf ' }, [], skus))
      .toEqual({ sku: 'W-221H-1A', source: 'prefix' });
  });
  it('reports ambiguous or missing', () => {
    expect(resolveMerchantSku({ name: 'GA-2100-1A1DR' }, [], skus).problem).toBe('ambiguous');
    expect(resolveMerchantSku({ name: 'ZZ-1' }, [], skus).problem).toBe('none');
  });
});

describe('resolveSkuMap', () => {
  const productsById = new Map([
    [1, { name: 'W-221H-1AVDF' }], [2, { name: 'ZZ-1' }], [3, { name: 'W-221H-1AVDF' }],
    [4, { name: 'ถ่าน CR2032' }], [5, { name: 'GA-100-1A1DR' }], [6, { name: 'X-1' }],
  ]);
  const merchantSkus = ['W-221H-1A', 'MY-SKU'];
  it('keeps manual picks, saves new auto picks, lists unresolved', () => {
    const savedMap = new Map([[3, { merchant_sku: 'my-sku', source: 'manual' }]]);
    const { resolved, toSave, unresolved } = resolveSkuMap([1, 2, 3], {
      productsById, tiktokByProduct: new Map(), merchantSkus, savedMap,
    });
    expect(resolved.get(1)).toEqual({ sku: 'W-221H-1A', source: 'prefix' });
    expect(resolved.get(3)).toEqual({ sku: 'MY-SKU', source: 'manual' });
    expect(toSave).toEqual([{ product_id: 1, merchant_sku: 'W-221H-1A', source: 'prefix' }]);
    expect(unresolved.map(u => u.product_id)).toEqual([2]);
  });
  it('skips products marked ไม่ส่ง BigSeller', () => {
    const savedMap = new Map([[4, { merchant_sku: null, source: 'skip' }]]);
    const r = resolveSkuMap([4], { productsById, tiktokByProduct: new Map(), merchantSkus, savedMap });
    expect(r.skipped).toEqual([{ product_id: 4, name: 'ถ่าน CR2032' }]);
    expect(r.unresolved).toEqual([]);
    expect(r.resolved.size).toBe(0);
  });
  it('rejects SKUs missing from the BigSeller list (TikTok or manual)', () => {
    const savedMap = new Map([[6, { merchant_sku: 'TYPO-1', source: 'manual' }]]);
    const r = resolveSkuMap([5, 6], {
      productsById, tiktokByProduct: new Map([[5, ['GA-100-1A1']]]), merchantSkus, savedMap,
    });
    expect(r.resolved.size).toBe(0);
    expect(r.toSave).toEqual([]);
    expect(r.unresolved).toEqual([
      { product_id: 5, name: 'GA-100-1A1DR', problem: 'not_in_bigseller', candidates: ['GA-100-1A1'] },
      { product_id: 6, name: 'X-1', problem: 'not_in_bigseller', candidates: ['TYPO-1'] },
    ]);
  });
});

describe('netByProduct + aggregateBySku', () => {
  const movements = [
    { product_id: 1, qty_delta: 5, reason: 'receive' },
    { product_id: 1, qty_delta: -2, reason: 'sale', channel: 'store' },
    { product_id: 1, qty_delta: -1, reason: 'sale', channel: 'tiktok' },   // skipped
    { product_id: 2, qty_delta: -3, reason: 'sale', channel: null },
    { product_id: 3, qty_delta: 4, reason: 'receive' },
    { product_id: 3, qty_delta: -4, reason: 'manual_adjust' },            // nets to 0
    { product_id: 4, qty_delta: 2, reason: 'receive' },                   // no SKU
    { product_id: 5, qty_delta: 1, reason: 'receive' },                   // same SKU as 1
  ];
  it('nets per Merchant SKU and splits in / out', () => {
    const net = netByProduct(movements);
    expect(net.get(1)).toBe(3);
    expect(net.get(3)).toBe(0);
    const resolved = new Map([
      [1, { sku: 'W-221H-1A' }], [2, { sku: 'GA-100-1A1' }], [3, { sku: 'X-1' }], [5, { sku: 'w-221h-1a' }],
    ]);
    const products = new Map([[1, { cost_price: 100 }], [5, { cost_price: 200 }], [4, { name: 'NO-SKU' }]]);
    const { stockIn, stockOut, unresolved } = aggregateBySku(net, resolved, products);
    expect(stockIn).toEqual([{ sku: 'W-221H-1A', qty: 4, unit_cost: 125 }]);
    expect(stockOut).toEqual([{ sku: 'GA-100-1A1', qty: 3 }]);
    expect(unresolved).toEqual([{ product_id: 4, name: 'NO-SKU', net: 2 }]);
    expect(aggregateBySku(net, resolved, products, new Set([4])).unresolved).toEqual([]);
  });
});

describe('sheet building', () => {
  it('uses the exact template headers', () => {
    expect(buildStockInAoa([{ sku: 'A', qty: 2, unit_cost: 9.5 }]))
      .toEqual([STOCK_IN_HEADERS, ['A', '', 2, 9.5, '', '', '']]);
    expect(buildStockOutAoa([{ sku: 'B', qty: 1 }])).toEqual([STOCK_OUT_HEADERS, ['B', 1, '']]);
    expect(STOCK_IN_HEADERS[0]).toContain('\n');
  });
  it('chunks at 2,000 rows and names parts', () => {
    const rows = Array.from({ length: 4001 }, (_, i) => ({ sku: String(i), qty: 1 }));
    expect(chunkRows(rows).map(c => c.length)).toEqual([2000, 2000, 1]);
    expect(exportFilename('in', '2026-11-16T14:30:00', 12, 2, 3)).toBe('BigSeller_StockIn_20261116-1430_b12_part2.xlsx');
    expect(exportFilename('out', '2026-11-16T09:05:00', null)).toBe('BigSeller_StockOut_20261116-0905.xlsx');
  });
});

describe('parseSkuSheet', () => {
  it('reads the SKU column and skips the header', () => {
    expect(parseSkuSheet([['Merchant SKU', 'จำนวน'], ['-MTP-1', 0], ['A-1'], ['a-1'], ['']]))
      .toEqual(['-MTP-1', 'A-1']);
  });
  it('falls back to column A without a header', () => {
    expect(parseSkuSheet([['A-1'], ['B-2']])).toEqual(['A-1', 'B-2']);
  });
});

describe('reconcileLines', () => {
  it('lists net stock_reconcile qty per product with its SKU', () => {
    const moves = [
      { product_id: 1, qty_delta: -2, reason: 'stock_reconcile' },
      { product_id: 1, qty_delta: 1, reason: 'stock_reconcile' },
      { product_id: 2, qty_delta: 3, reason: 'stock_reconcile' },
      { product_id: 2, qty_delta: -3, reason: 'stock_reconcile' },
      { product_id: 3, qty_delta: 5, reason: 'receive' },
    ];
    const lines = reconcileLines(moves, new Map([[1, { sku: 'W-1' }]]), new Map([[1, { name: 'W-1DR' }]]));
    expect(lines).toEqual([{ product_id: 1, name: 'W-1DR', sku: 'W-1', qty: -1 }]);
  });
});

describe('prefix match guard + retired products', () => {
  const skus = ['F-91WS-7', 'F-91WS-7A2', 'LTP-V002D-4B'];
  it('only lets a short letter tail follow the SKU', () => {
    expect(resolveMerchantSku({ name: 'F-91WS-7DF' }, [], skus)).toEqual({ sku: 'F-91WS-7', source: 'prefix' });
    expect(resolveMerchantSku({ name: 'F-91WS-7A2DF' }, [], skus)).toEqual({ sku: 'F-91WS-7A2', source: 'prefix' });
    expect(resolveMerchantSku({ name: 'F-91WS-7A3DF' }, [], skus).problem).toBe('none');
  });
  it('does not reuse an old prefix pick that the rule now rejects', () => {
    const r = resolveSkuMap([1], {
      productsById: new Map([[1, { name: 'F-91WS-7A3DF' }]]), tiktokByProduct: new Map(), merchantSkus: skus,
      savedMap: new Map([[1, { merchant_sku: 'F-91WS-7', source: 'prefix' }]]),
    });
    expect(r.resolved.size).toBe(0);
    expect(r.unresolved[0].problem).toBe('none');
  });
  it('skips products named ผิด / ไม่ใช้', () => {
    const r = resolveSkuMap([2], {
      productsById: new Map([[2, { name: 'LTP-V002D-4BUDF(ผิดไม่ใช้)' }]]), tiktokByProduct: new Map(), merchantSkus: skus, savedMap: new Map(),
    });
    expect(r.skipped).toEqual([{ product_id: 2, name: 'LTP-V002D-4BUDF(ผิดไม่ใช้)', retired: true }]);
    expect(r.resolved.size).toBe(0);
  });
});
