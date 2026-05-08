import { describe, it, expect } from 'vitest';
import { reorderSuggestion } from '../../src/lib/analytics/forecast.js';

describe('reorderSuggestion', () => {
  it('computes targetStock = avgPerDay × targetWeeks × 7', () => {
    // 1/day × 6 wk × 7 = 42. Current = 10 → suggest 32.
    const r = reorderSuggestion({ avgPerDay: 1, currentStock: 10, targetWeeks: 6 });
    expect(r.targetStock).toBe(42);
    expect(r.suggestedReorder).toBe(32);
    expect(r.daysOfStockLeft).toBe(10);
  });

  it('returns 0 when velocity is zero (never suggest restocking dead stock)', () => {
    const r = reorderSuggestion({ avgPerDay: 0, currentStock: 20 });
    expect(r.suggestedReorder).toBe(0);
    expect(r.targetStock).toBe(0);
    expect(r.daysOfStockLeft).toBe(Infinity);
  });

  it('returns 0 when current stock already exceeds target', () => {
    // 0.5/day × 6wk × 7 = 21. Current = 50 → zero.
    const r = reorderSuggestion({ avgPerDay: 0.5, currentStock: 50, targetWeeks: 6 });
    expect(r.suggestedReorder).toBe(0);
  });

  it('applies a 15% buffer for fast movers (>2/day)', () => {
    // 3/day × 6wk × 7 = 126. +15% → 145 (ceil). Current 20 → suggest 125.
    const r = reorderSuggestion({ avgPerDay: 3, currentStock: 20, targetWeeks: 6 });
    expect(r.targetStock).toBe(Math.ceil(126 * 1.15));
    expect(r.suggestedReorder).toBe(r.targetStock - 20);
  });

  it('does NOT apply buffer for slow movers', () => {
    const r = reorderSuggestion({ avgPerDay: 1.5, currentStock: 10, targetWeeks: 6 });
    // 1.5 × 42 = 63, no buffer
    expect(r.targetStock).toBe(63);
  });

  it('coerces string numeric inputs', () => {
    const r = reorderSuggestion({ avgPerDay: '2', currentStock: '5', targetWeeks: 6 });
    expect(r.suggestedReorder).toBeGreaterThan(0);
  });

  it('negative inputs are floored to 0', () => {
    const r = reorderSuggestion({ avgPerDay: -3, currentStock: -10 });
    expect(r.avgPerDay).toBe(0);
    expect(r.suggestedReorder).toBe(0);
  });

  it('defaults to 6 weeks when targetWeeks is not provided', () => {
    const a = reorderSuggestion({ avgPerDay: 1, currentStock: 0 });
    const b = reorderSuggestion({ avgPerDay: 1, currentStock: 0, targetWeeks: 6 });
    expect(a.targetStock).toBe(b.targetStock);
  });
});
