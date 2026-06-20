import { describe, it, expect } from 'vitest';
import {
  pickNextRowAfterComplete,
  pickFirstAttentionRow,
  isRowComplete,
} from '../src/components/ai/mobile-review-step-logic.js';

const baseRow = (overrides = {}) => ({
  uid: 'r1',
  status: 'auto',
  product: { id: 1, name: 'Test' },
  quantity: 2,
  unit_cost: 100,
  needsReview: false,
  tiktok_skip: true,
  ...overrides,
});

describe('mobile-review-step-logic', () => {
  it('pickFirstAttentionRow returns first unresolved row', () => {
    const rows = [
      baseRow({ uid: 'r1', status: 'auto' }),
      baseRow({ uid: 'r2', status: 'none', product: null }),
    ];
    const row = pickFirstAttentionRow(rows, false);
    expect(row?.uid).toBe('r2');
  });

  it('pickNextRowAfterComplete advances to next attention row', () => {
    const rows = [
      baseRow({ uid: 'r1' }),
      baseRow({ uid: 'r2', status: 'none', product: null }),
      baseRow({ uid: 'r3', quantity: 0 }),
    ];
    const next = pickNextRowAfterComplete(rows, 0, false);
    expect(next?.uid).toBe('r2');
  });

  it('pickNextRowAfterComplete returns null when all complete', () => {
    const rows = [
      baseRow({ uid: 'r1' }),
      baseRow({ uid: 'r2' }),
    ];
    expect(pickNextRowAfterComplete(rows, 0, false)).toBeNull();
  });

  it('isRowComplete is true for fully matched row', () => {
    const row = baseRow();
    expect(isRowComplete(row, false)).toBe(true);
  });

  it('isRowComplete is false when qty missing', () => {
    const row = baseRow({ quantity: 0 });
    expect(isRowComplete(row, false)).toBe(false);
  });
});
