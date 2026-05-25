import { describe, it, expect } from 'vitest';
import { weeklyBuckets, momCompare } from '../../src/lib/analytics/trend.js';

const DAY = 86400000;

describe('weeklyBuckets', () => {
  // Fix now to a Wednesday midday so the "this week" bucket contains this sale
  const now = new Date('2025-05-28T12:00:00Z').getTime(); // Wed 19:00 BKK

  it('creates the requested number of weekly buckets in order', () => {
    const b = weeklyBuckets([], { weeks: 4, now });
    expect(b.length).toBe(4);
    // weekStart is ascending
    const ts = b.map(x => new Date(x.weekStart).getTime());
    expect(ts).toEqual([...ts].sort((a, z) => a - z));
  });

  it('attributes a sale to the current week bucket', () => {
    const rows = [
      { sale_date: new Date(now - 1 * DAY).toISOString(), revenue: 1000, cost: 400 },
    ];
    const b = weeklyBuckets(rows, { weeks: 4, now });
    const last = b[b.length - 1];
    expect(last.revenue).toBe(1000);
    expect(last.profit).toBe(600);
    expect(last.count).toBe(1);
  });

  it('attributes older sales to prior buckets', () => {
    const rows = [
      { sale_date: new Date(now - 8 * DAY).toISOString(),  revenue: 500, cost: 200 },
      { sale_date: new Date(now - 15 * DAY).toISOString(), revenue: 700, cost: 300 },
    ];
    const b = weeklyBuckets(rows, { weeks: 4, now });
    // Only 2 weeks have data; weeks without data have revenue 0
    const withData = b.filter(x => x.revenue > 0);
    expect(withData.length).toBe(2);
    expect(withData.reduce((s, x) => s + x.revenue, 0)).toBe(1200);
  });

  it('drops sales older than the oldest bucket', () => {
    const rows = [
      { sale_date: new Date(now - 90 * DAY).toISOString(), revenue: 9999 },
    ];
    const b = weeklyBuckets(rows, { weeks: 4, now });
    expect(b.reduce((s, x) => s + x.revenue, 0)).toBe(0);
  });

  it('does not leak internal timestamps in the output shape', () => {
    const b = weeklyBuckets([], { weeks: 2, now });
    expect(b[0]).not.toHaveProperty('_startTs');
    expect(b[0]).not.toHaveProperty('_endTs');
    expect(b[0]).toHaveProperty('weekStart');
    expect(b[0]).toHaveProperty('weekEnd');
  });
});

describe('momCompare', () => {
  it('computes deltas and %Δ against the previous month', () => {
    const r = momCompare(
      { revenue: 120000, cost: 70000, count: 40 },
      { revenue: 100000, cost: 60000, count: 30 },
    );
    expect(r.delta.revenue).toBe(20000);
    expect(r.delta.profit).toBe(10000);   // (120-70) - (100-60)
    expect(r.delta.count).toBe(10);
    expect(r.pct.revenue).toBeCloseTo(20, 5);
    expect(r.pct.count).toBeCloseTo(33.333, 2);
  });

  it('computes AOV and margin for both periods', () => {
    const r = momCompare(
      { revenue: 10000, cost: 4000, count: 5 },
      { revenue: 6000,  cost: 3000, count: 3 },
    );
    expect(r.aov.current).toBe(2000);
    expect(r.aov.previous).toBe(2000);
    expect(r.margin.current).toBeCloseTo(0.6);
    expect(r.margin.previous).toBeCloseTo(0.5);
  });

  it('returns null %Δ when previous was 0 (no divide by zero)', () => {
    const r = momCompare(
      { revenue: 10000, cost: 4000, count: 5 },
      { revenue: 0, cost: 0, count: 0 },
    );
    expect(r.pct.revenue).toBeNull();
    expect(r.pct.profit).toBeNull();
    expect(r.pct.count).toBeNull();
  });

  it('handles missing / null inputs as zeroes', () => {
    const r = momCompare(null, undefined);
    expect(r.current.revenue).toBe(0);
    expect(r.previous.count).toBe(0);
    expect(r.delta.profit).toBe(0);
  });
});
