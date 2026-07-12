import { describe, it, expect } from 'vitest';
import { buildReceiveCostTimeline } from '../src/lib/receive-cost.js';

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
