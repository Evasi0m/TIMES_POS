import { describe, it, expect } from 'vitest';
import { normalizePlatformOrderNo, matchesPlatformOrderNo, findDuplicatePlatformOrder } from '../src/lib/platform-order.js';
import { platformFeeSummary } from '../src/lib/platform-fees.js';

function fakeSb(rows, calls = []) {
  const q = {
    select() { return q; },
    eq(k, v) { calls.push(['eq', k, v]); return q; },
    ilike(k, v) { calls.push(['ilike', k, v]); return q; },
    neq(k, v) { calls.push(['neq', k, v]); return q; },
    limit() { return q; },
    then(res) { return Promise.resolve({ data: rows, error: null }).then(res); },
  };
  return { from: () => q };
}

describe('platform order no', () => {
  it('normalizes whitespace and empty', () => {
    expect(normalizePlatformOrderNo('  26 1118 0001 ')).toBe('2611180001');
    expect(normalizePlatformOrderNo('   ')).toBeNull();
    expect(normalizePlatformOrderNo(null)).toBeNull();
  });
  it('matches search', () => {
    expect(matchesPlatformOrderNo({ platform_order_no: 'TM-ABC123' }, 'abc1')).toBe(true);
    expect(matchesPlatformOrderNo({ platform_order_no: null }, 'abc')).toBe(false);
  });
  it('finds duplicate on same channel, excluding voided and self', async () => {
    const calls = [];
    const dup = await findDuplicatePlatformOrder(fakeSb([{ id: 9 }], calls), 'thaimart', ' X_1 ', 5);
    expect(dup).toEqual({ id: 9 });
    expect(calls).toContainEqual(['eq', 'channel', 'thaimart']);
    expect(calls).toContainEqual(['ilike', 'platform_order_no', 'X\\_1']);
    expect(calls).toContainEqual(['neq', 'status', 'voided']);
    expect(calls).toContainEqual(['neq', 'id', 5]);
  });
  it('skips lookup when empty', async () => {
    expect(await findDuplicatePlatformOrder(fakeSb([{ id: 1 }]), 'shopee', '')).toBeNull();
  });
});

describe('platformFeeSummary', () => {
  it('sums fees per e-commerce channel, ignores store, counts missing net', () => {
    const out = platformFeeSummary([
      { channel: 'thaimart', grand_total: 1000, net_received: 900 },
      { channel: 'thaimart', grand_total: 500, net_received: null },
      { channel: 'shopee', grand_total: 2000, net_received: 1700 },
      { channel: 'store', grand_total: 9999, net_received: null },
    ]);
    expect(out.map((r) => r.channel)).toEqual(['shopee', 'thaimart']);
    const tm = out.find((r) => r.channel === 'thaimart');
    expect(tm).toMatchObject({ orders: 2, withNet: 1, missingNet: 1, gross: 1000, net: 900, fee: 100 });
    expect(tm.feePct).toBeCloseTo(10);
    expect(out[0].feePct).toBeCloseTo(15);
  });
});
