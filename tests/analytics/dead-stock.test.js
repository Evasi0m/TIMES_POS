import { describe, it, expect } from 'vitest';
import { deadStockReport } from '../../src/lib/analytics/dead-stock.js';

const DAY = 86400000;
const now = new Date('2025-05-30T00:00:00Z').getTime();

describe('deadStockReport', () => {
  const products = [
    { id: 1, name: 'Slow mover',  current_stock: 3, cost_price: 2000 },
    { id: 2, name: 'Never sold',  current_stock: 5, cost_price: 1000 },
    { id: 3, name: 'Recent sell', current_stock: 2, cost_price: 500  },
    { id: 4, name: 'Out of stock',current_stock: 0, cost_price: 1500 },
    { id: 5, name: 'Big SKU',     current_stock: 10,cost_price: 3000 },
  ];

  const lastSold = new Map([
    [1, new Date(now - 70 * DAY).toISOString()],
    [3, new Date(now - 10 * DAY).toISOString()],
    [5, new Date(now - 90 * DAY).toISOString()],
    // 2 never sold, 4 out of stock
  ]);

  it('returns products that have not sold within the threshold and still have stock', () => {
    const r = deadStockReport(products, lastSold, { thresholdDays: 60, now });
    // Sorted by locked_value desc: Big SKU (30k), Never sold (5k), Slow mover (6k)
    // Actually Slow=6000, Never=5000, Big=30000 → order: Big, Slow, Never
    expect(r.map(x => x.id)).toEqual([5, 1, 2]);
  });

  it('respects threshold: at 90 days, only the Big SKU + Never-sold appear', () => {
    const r = deadStockReport(products, lastSold, { thresholdDays: 90, now });
    // Big SKU sold exactly 90 days ago → days_since_sold = 90, NOT < 90, included
    expect(r.map(x => x.id).sort()).toEqual([2, 5]);
  });

  it('excludes products that are out of stock', () => {
    const r = deadStockReport(products, lastSold, { thresholdDays: 60, now });
    expect(r.find(x => x.id === 4)).toBeUndefined();
  });

  it('excludes products sold within the threshold', () => {
    const r = deadStockReport(products, lastSold, { thresholdDays: 60, now });
    expect(r.find(x => x.id === 3)).toBeUndefined();
  });

  it('treats never-sold products as Infinity days', () => {
    const r = deadStockReport(products, lastSold, { thresholdDays: 60, now });
    const neverSold = r.find(x => x.id === 2);
    expect(neverSold.days_since_sold).toBe(Infinity);
    expect(neverSold.last_sold_at).toBeNull();
  });

  it('computes locked_value = cost_price × current_stock', () => {
    const r = deadStockReport(products, lastSold, { thresholdDays: 60, now });
    const big = r.find(x => x.id === 5);
    expect(big.locked_value).toBe(30000);
  });

  it('sorts biggest opportunity cost first', () => {
    const r = deadStockReport(products, lastSold, { thresholdDays: 60, now });
    for (let i = 1; i < r.length; i++) {
      expect(r[i - 1].locked_value).toBeGreaterThanOrEqual(r[i].locked_value);
    }
  });

  it('handles empty / null inputs gracefully', () => {
    expect(deadStockReport([], new Map())).toEqual([]);
    expect(deadStockReport(null, null)).toEqual([]);
  });
});
