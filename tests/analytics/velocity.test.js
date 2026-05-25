import { describe, it, expect } from 'vitest';
import { velocityByProduct, daysOfStockLeft } from '../../src/lib/analytics/velocity.js';

const DAY = 86400000;

describe('velocityByProduct', () => {
  const now = Date.UTC(2025, 4, 30); // 2025-05-30

  it('sums quantities within the window', () => {
    const rows = [
      { product_id: 1, quantity: 2, sale_date: new Date(now - 5 * DAY).toISOString() },
      { product_id: 1, quantity: 3, sale_date: new Date(now - 10 * DAY).toISOString() },
      { product_id: 2, quantity: 1, sale_date: new Date(now - 1 * DAY).toISOString() },
    ];
    const v = velocityByProduct(rows, { now, windowDays: 30 });
    expect(v.get(1).totalQty).toBe(5);
    expect(v.get(2).totalQty).toBe(1);
  });

  it('excludes rows older than the window', () => {
    const rows = [
      { product_id: 1, quantity: 100, sale_date: new Date(now - 45 * DAY).toISOString() },
      { product_id: 1, quantity: 2,   sale_date: new Date(now - 5  * DAY).toISOString() },
    ];
    const v = velocityByProduct(rows, { now, windowDays: 30 });
    expect(v.get(1).totalQty).toBe(2);
  });

  it('treats brand-new products fairly (daysCovered = age, not full window)', () => {
    // First (and only) sale was 4 days ago → daysCovered = 4, not 30
    const rows = [
      { product_id: 1, quantity: 4, sale_date: new Date(now - 4 * DAY).toISOString() },
    ];
    const v = velocityByProduct(rows, { now, windowDays: 30 });
    expect(v.get(1).daysCovered).toBe(4);
    expect(v.get(1).avgPerDay).toBe(1);
  });

  it('falls back to windowDays when the product sold on every day covered', () => {
    const rows = [];
    for (let i = 1; i <= 30; i++) {
      rows.push({ product_id: 1, quantity: 1, sale_date: new Date(now - i * DAY).toISOString() });
    }
    const v = velocityByProduct(rows, { now, windowDays: 30 });
    expect(v.get(1).daysCovered).toBe(30);
    expect(v.get(1).avgPerDay).toBe(1);
  });

  it('skips rows without product_id or with invalid dates', () => {
    const rows = [
      { product_id: null, quantity: 5, sale_date: new Date(now).toISOString() },
      { product_id: 1, quantity: 2, sale_date: 'bad' },
      { product_id: 1, quantity: 3, sale_date: new Date(now - 1 * DAY).toISOString() },
    ];
    const v = velocityByProduct(rows, { now, windowDays: 30 });
    expect(v.size).toBe(1);
    expect(v.get(1).totalQty).toBe(3);
  });

  it('returns an empty map for empty input', () => {
    expect(velocityByProduct([]).size).toBe(0);
    expect(velocityByProduct(null).size).toBe(0);
  });
});

describe('daysOfStockLeft', () => {
  it('returns stock / velocity', () => {
    expect(daysOfStockLeft(10, 2)).toBe(5);
    expect(daysOfStockLeft(7, 0.5)).toBe(14);
  });

  it('returns Infinity when velocity is zero/negative/missing', () => {
    expect(daysOfStockLeft(10, 0)).toBe(Infinity);
    expect(daysOfStockLeft(10, -1)).toBe(Infinity);
    expect(daysOfStockLeft(10, null)).toBe(Infinity);
  });

  it('handles missing stock as 0', () => {
    expect(daysOfStockLeft(null, 2)).toBe(0);
    expect(daysOfStockLeft(undefined, 2)).toBe(0);
  });
});
