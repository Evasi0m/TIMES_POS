import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/sb-paginate.js', () => ({
  fetchAll: vi.fn(),
}));

vi.mock('../src/lib/receive-cost.js', () => ({
  fetchReceiveCostTimeline: vi.fn(),
}));

vi.mock('../src/lib/sale-void-stock-status.js', () => ({
  fetchVoidStockStatusMap: vi.fn(),
}));

vi.mock('../src/lib/ecommerce-channels.js', () => ({
  ECOMMERCE_CHANNELS: new Set(['tiktok', 'shopee', 'lazada']),
  excludePendingTikTok: vi.fn((q) => q),
}));

import { fetchAll } from '../src/lib/sb-paginate.js';
import { fetchReceiveCostTimeline } from '../src/lib/receive-cost.js';
import { fetchVoidStockStatusMap } from '../src/lib/sale-void-stock-status.js';
import {
  buildOrderSummary,
  buildSalesFilterKey,
  getSalesHistoryBundle,
  getCachedSalesHistoryBundle,
  patchOrderInCache,
  invalidateSalesHistoryCache,
  _resetSalesHistoryCacheForTests,
} from '../src/lib/sales-history-cache.js';

function makeSb() {
  return { from: vi.fn() };
}

function stubNetwork(orders = [{ id: 1, sale_date: '2026-06-19T10:00:00Z', status: 'active', channel: 'store', grand_total: 100 }], items = [{ id: 10, sale_order_id: 1, product_id: 5, product_name: 'Watch', quantity: 1, unit_price: 100, cost_price: 50 }]) {
  let callCount = 0;
  fetchAll.mockImplementation(async () => {
    callCount += 1;
    if (callCount === 1) return { data: orders, error: null };
    if (callCount === 2) return { data: items, error: null };
    return { data: [{ id: 5, cost_price: 40 }], error: null };
  });
  fetchReceiveCostTimeline.mockResolvedValue({ map: {}, error: null });
  fetchVoidStockStatusMap.mockResolvedValue({});
  return makeSb();
}

describe('sales-history-cache', () => {
  beforeEach(() => {
    _resetSalesHistoryCacheForTests();
    vi.clearAllMocks();
  });

  it('buildSalesFilterKey encodes filter dimensions', () => {
    expect(buildSalesFilterKey({
      from: '2026-06-01',
      to: '2026-06-19',
      channel: 'tiktok',
      excludeVoided: true,
    })).toBe('2026-06-01_2026-06-19_tiktok_true');
  });

  it('cache miss fetches once; cache hit skips network', async () => {
    const sb = stubNetwork();
    const opts = { from: '2026-06-19', to: '2026-06-19', channel: '', excludeVoided: true };

    const first = await getSalesHistoryBundle(sb, opts);
    expect(first.fromCache).toBe(false);
    expect(first.bundle?.orders).toHaveLength(1);
    expect(fetchAll).toHaveBeenCalled();

    const callsAfterFirst = fetchAll.mock.calls.length;
    const second = await getSalesHistoryBundle(sb, opts);
    expect(second.fromCache).toBe(true);
    expect(second.bundle?.orders[0].id).toBe(1);
    expect(fetchAll.mock.calls.length).toBe(callsAfterFirst);
  });

  it('concurrent loads share one in-flight promise per filterKey', async () => {
    const sb = stubNetwork([{ id: 2, sale_date: '2026-06-19T10:00:00Z', status: 'active', channel: 'store', grand_total: 200 }]);
    const opts = { from: '2026-06-19', to: '2026-06-19', channel: '', excludeVoided: false };

    const [a, b] = await Promise.all([
      getSalesHistoryBundle(sb, opts),
      getSalesHistoryBundle(sb, opts),
    ]);

    expect(a.bundle?.orders[0].id).toBe(2);
    expect(b.fromCache).toBe(false);
    expect(fetchAll.mock.calls.length).toBeGreaterThan(0);
  });

  it('filterKey change is a cache miss and refetches', async () => {
    const sb = stubNetwork();
    await getSalesHistoryBundle(sb, { from: '2026-06-19', to: '2026-06-19', channel: '', excludeVoided: true });
    const callsAfterFirst = fetchAll.mock.calls.length;

    await getSalesHistoryBundle(sb, { from: '2026-06-18', to: '2026-06-19', channel: '', excludeVoided: true });
    expect(fetchAll.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('invalidate clears cache so next load refetches', async () => {
    const sb = stubNetwork();
    const opts = { from: '2026-06-19', to: '2026-06-19', channel: '', excludeVoided: true };

    await getSalesHistoryBundle(sb, opts);
    const callsAfterFirst = fetchAll.mock.calls.length;
    invalidateSalesHistoryCache();
    await getSalesHistoryBundle(sb, opts);
    expect(fetchAll.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('force: true refetches even when cache is warm', async () => {
    const sb = stubNetwork();
    const opts = { from: '2026-06-19', to: '2026-06-19', channel: '', excludeVoided: true };

    await getSalesHistoryBundle(sb, opts);
    const callsAfterFirst = fetchAll.mock.calls.length;
    await getSalesHistoryBundle(sb, { ...opts, force: true });
    expect(fetchAll.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('getCachedSalesHistoryBundle returns warm entry without fetch', async () => {
    const sb = stubNetwork();
    const key = buildSalesFilterKey({ from: '2026-06-19', to: '2026-06-19', channel: '', excludeVoided: true });
    expect(getCachedSalesHistoryBundle(key)).toBeNull();

    await getSalesHistoryBundle(sb, { from: '2026-06-19', to: '2026-06-19', channel: '', excludeVoided: true });
    expect(getCachedSalesHistoryBundle(key)?.orders[0].id).toBe(1);
  });

  it('patchOrderInCache updates order and recomputes summary profit', async () => {
    const sb = stubNetwork(
      [{ id: 3, sale_date: '2026-06-19T10:00:00Z', status: 'active', channel: 'shopee', grand_total: 1000, net_received: 900 }],
      [{ id: 30, sale_order_id: 3, product_id: 7, product_name: 'X', quantity: 1, unit_price: 1000, cost_price: 400 }],
    );
    const opts = { from: '2026-06-19', to: '2026-06-19', channel: '', excludeVoided: true };
    await getSalesHistoryBundle(sb, opts);

    const before = getCachedSalesHistoryBundle(buildSalesFilterKey(opts)).orderSummary[3].profit;
    patchOrderInCache(3, { net_received: 950 }, { filterKey: buildSalesFilterKey(opts) });
    const after = getCachedSalesHistoryBundle(buildSalesFilterKey(opts)).orderSummary[3].profit;
    expect(after).toBeGreaterThan(before);
    expect(getCachedSalesHistoryBundle(buildSalesFilterKey(opts)).orders[0].net_received).toBe(950);
  });

  it('buildOrderSummary marks voided bills as zero profit', () => {
    const orders = [{ id: 9, sale_date: '2026-06-19T10:00:00Z', status: 'voided', channel: 'store', grand_total: 500 }];
    const itemsByOrder = {
      9: [{ id: 90, sale_order_id: 9, product_id: 1, product_name: 'A', quantity: 1, unit_price: 500, cost_price: 100 }],
    };
    const summary = buildOrderSummary(orders, itemsByOrder, {}, {});
    expect(summary[9].profit).toBe(0);
  });
});
