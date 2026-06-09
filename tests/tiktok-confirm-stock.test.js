import { describe, it, expect } from 'vitest';
import {
  resolvePickStock,
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
});
