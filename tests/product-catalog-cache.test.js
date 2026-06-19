import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/sb-paginate.js', () => ({
  fetchAllFromTable: vi.fn(),
}));

vi.mock('../src/lib/receive-cost.js', () => ({
  fetchLatestReceiveCostMap: vi.fn(),
}));

import { fetchAllFromTable } from '../src/lib/sb-paginate.js';
import { fetchLatestReceiveCostMap } from '../src/lib/receive-cost.js';
import {
  getProductListBundle,
  getProductCatalog,
  invalidateProductCatalogCache,
  patchProductStockInCache,
  refreshLatestCostsInCache,
  _resetProductCatalogCacheForTests,
} from '../src/lib/product-catalog-cache.js';

function makeSb() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: undefined,
  };
  chain.then = (resolve) => resolve({ data: [], error: null });
  return {
    from: vi.fn(() => chain),
  };
}

function stubNetwork(products = [{ id: 1, name: 'A' }], imgs = [], costMap = { 1: { unit_price: 10 } }) {
  fetchAllFromTable.mockResolvedValue({ data: products, error: null });
  fetchLatestReceiveCostMap.mockResolvedValue({ map: costMap, error: null });
  const sb = makeSb();
  sb.from.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: imgs, error: null }),
    }),
  });
  return sb;
}

describe('product-catalog-cache', () => {
  beforeEach(() => {
    _resetProductCatalogCacheForTests();
    vi.clearAllMocks();
  });

  it('cache miss fetches once; cache hit skips network', async () => {
    const sb = stubNetwork([{ id: 1, name: 'A' }]);

    const first = await getProductListBundle(sb);
    expect(first.fromCache).toBe(false);
    expect(first.bundle?.products).toHaveLength(1);
    expect(fetchAllFromTable).toHaveBeenCalledTimes(1);
    expect(fetchLatestReceiveCostMap).toHaveBeenCalledTimes(1);

    const second = await getProductListBundle(sb);
    expect(second.fromCache).toBe(true);
    expect(second.bundle?.products).toHaveLength(1);
    expect(fetchAllFromTable).toHaveBeenCalledTimes(1);
    expect(fetchLatestReceiveCostMap).toHaveBeenCalledTimes(1);
  });

  it('concurrent loads share one in-flight promise', async () => {
    const sb = stubNetwork([{ id: 2, name: 'B' }]);

    const [a, b] = await Promise.all([
      getProductListBundle(sb),
      getProductListBundle(sb),
    ]);

    expect(a.bundle?.products[0].id).toBe(2);
    expect(b.fromCache).toBe(false);
    expect(fetchAllFromTable).toHaveBeenCalledTimes(1);
  });

  it('invalidate clears cache so next load refetches', async () => {
    const sb = stubNetwork([{ id: 3, name: 'C' }]);

    await getProductListBundle(sb);
    invalidateProductCatalogCache();
    await getProductListBundle(sb);

    expect(fetchAllFromTable).toHaveBeenCalledTimes(2);
  });

  it('force: true refetches even when cache is warm', async () => {
    const sb = stubNetwork([{ id: 4, name: 'D' }]);

    await getProductListBundle(sb);
    await getProductListBundle(sb, { force: true });

    expect(fetchAllFromTable).toHaveBeenCalledTimes(2);
  });

  it('getProductCatalog returns products from the shared bundle', async () => {
    const sb = stubNetwork([{ id: 5, name: 'E', cost_price: 99 }]);

    const { data, error } = await getProductCatalog(sb);
    expect(error).toBeNull();
    expect(data[0].cost_price).toBe(99);
  });

  it('patchProductStockInCache updates cached row', async () => {
    const sb = stubNetwork([{ id: 7, name: 'G', current_stock: 3 }]);
    await getProductListBundle(sb);

    patchProductStockInCache(7, 10);
    const { bundle } = await getProductListBundle(sb);
    expect(bundle?.products[0].current_stock).toBe(10);
    expect(fetchAllFromTable).toHaveBeenCalledTimes(1);
  });

  it('refreshLatestCostsInCache updates map without refetching products', async () => {
    const sb = stubNetwork([{ id: 8, name: 'H' }], [], { 8: { unit_price: 1 } });
    await getProductListBundle(sb);

    fetchLatestReceiveCostMap.mockResolvedValue({
      map: { 8: { unit_price: 55, receive_date: '2026-01-01' } },
      error: null,
    });

    const { map, error } = await refreshLatestCostsInCache(sb);
    expect(error).toBeNull();
    expect(map[8].unit_price).toBe(55);
    expect(fetchAllFromTable).toHaveBeenCalledTimes(1);
    expect(fetchLatestReceiveCostMap).toHaveBeenCalledTimes(2);
  });
});
