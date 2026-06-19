import { describe, it, expect } from 'vitest';
import {
  buildLatestCostMap,
  buildReceiveCostTimeline,
} from '../src/lib/receive-cost.js';

describe('buildLatestCostMap', () => {
  it('maps product_id to unit_price + receive_date', () => {
    const map = buildLatestCostMap([
      { product_id: 1, unit_price: '1200.5', receive_date: '2026-01-15T10:00:00Z' },
      { product_id: 2, unit_price: 800, receive_date: '2026-02-01T00:00:00Z' },
    ]);
    expect(map[1].unit_price).toBe(1200.5);
    expect(map[1].receive_date).toBe('2026-01-15T10:00:00Z');
    expect(map[2].unit_price).toBe(800);
  });

  it('returns empty object for null/empty input', () => {
    expect(buildLatestCostMap(null)).toEqual({});
    expect(buildLatestCostMap([])).toEqual({});
  });
});

describe('buildReceiveCostTimeline', () => {
  it('groups and sorts receives desc by date per product', () => {
    const map = buildReceiveCostTimeline([
      { product_id: 10, receive_date: '2026-01-01T00:00:00Z', unit_price: 100 },
      { product_id: 10, receive_date: '2026-03-01T00:00:00Z', unit_price: 110 },
      { product_id: 11, receive_date: '2026-02-01T00:00:00Z', unit_price: 90 },
    ]);
    expect(map[10]).toHaveLength(2);
    expect(map[10][0].unit_price).toBe(110);
    expect(map[10][1].unit_price).toBe(100);
    expect(map[11]).toHaveLength(1);
  });
});
