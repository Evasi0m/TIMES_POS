import { describe, it, expect } from 'vitest';
import {
  resolvePickStock,
  buildProductNeedMap,
  stockShortfall,
  orderHasStockIssue,
} from '../src/components/pos/tiktok-confirm/helpers.js';

const catalog = [
  { id: 1, name: 'GA-2100-1A1DR', current_stock: 0 },
  { id: 2, name: 'GA-2100-1ADR', current_stock: 4 },
];

describe('resolvePickStock', () => {
  it('prefers live catalog stock over cached pick', () => {
    expect(resolvePickStock({ id: 1, current_stock: 5 }, catalog)).toBe(0);
  });

  it('falls back to pick.current_stock when not in catalog', () => {
    expect(resolvePickStock({ id: 99, current_stock: 3 }, catalog)).toBe(3);
  });

  it('returns null when unknown', () => {
    expect(resolvePickStock({ id: 99 }, catalog)).toBe(null);
  });
});

describe('stockShortfall', () => {
  it('returns null when stock is sufficient', () => {
    expect(stockShortfall({ quantity: 1 }, { id: 2 }, catalog)).toBe(null);
  });

  it('returns shortfall when stock is zero', () => {
    expect(stockShortfall({ quantity: 1 }, { id: 1 }, catalog)).toEqual({ stock: 0, need: 1 });
  });

  it('returns shortfall when need exceeds stock', () => {
    expect(stockShortfall({ quantity: 5 }, { id: 2 }, catalog)).toEqual({ stock: 4, need: 5 });
  });

  it('fail-open when stock unknown', () => {
    expect(stockShortfall({ quantity: 1 }, { id: 99 }, catalog)).toBe(null);
  });
});

describe('orderHasStockIssue', () => {
  it('detects any line with insufficient stock', () => {
    const items = [{ id: 10, quantity: 1 }, { id: 11, quantity: 1 }];
    const picks = { 10: { id: 1 }, 11: { id: 2 } };
    expect(orderHasStockIssue(items, picks, catalog)).toBe(true);
  });

  it('returns false when all lines have enough stock', () => {
    const items = [{ id: 10, quantity: 1 }];
    const picks = { 10: { id: 2 } };
    expect(orderHasStockIssue(items, picks, catalog)).toBe(false);
  });

  it('aggregates qty across lines sharing the same product', () => {
    const items = [
      { id: 10, quantity: 1 },
      { id: 11, quantity: 1 },
      { id: 12, quantity: 1 },
    ];
    const picks = { 10: { id: 2 }, 11: { id: 2 }, 12: { id: 2 } };
    expect(orderHasStockIssue(items, picks, catalog)).toBe(false);
  });

  it('blocks when aggregate need exceeds stock (duplicate TikTok lines)', () => {
    const items = Array.from({ length: 14 }, (_, i) => ({ id: 100 + i, quantity: 1 }));
    const picks = Object.fromEntries(items.map(it => [it.id, { id: 2 }]));
    expect(orderHasStockIssue(items, picks, catalog)).toBe(true);
    const orderCtx = { items, picks };
    expect(stockShortfall(items[0], picks[items[0].id], catalog, orderCtx)).toEqual({
      stock: 4,
      need: 14,
    });
  });

  it('checks each product independently in mixed orders', () => {
    const items = [
      { id: 10, quantity: 2 },
      { id: 11, quantity: 1 },
    ];
    const picks = { 10: { id: 1 }, 11: { id: 2 } };
    expect(orderHasStockIssue(items, picks, catalog)).toBe(true);
    expect(buildProductNeedMap(items, picks).get(1)).toBe(2);
    expect(buildProductNeedMap(items, picks).get(2)).toBe(1);
  });
});
