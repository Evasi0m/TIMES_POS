import { describe, it, expect } from 'vitest';
import {
  computeBillStatus,
  rowNeedsAttention,
  isSoftMatch,
  hasRowMathMismatch,
} from '../src/components/ai/bill-review-shared.js';

const baseBill = (overrides = {}) => ({
  is_cmg_bill: true,
  saveState: 'pending',
  rows: [
    {
      status: 'auto',
      product: { id: 1 },
      quantity: 2,
      unit_cost: 100,
      needsReview: false,
      matchScore: 95,
      validationIssues: [],
    },
  ],
  ...overrides,
});

describe('computeBillStatus', () => {
  it('returns ready for a fully resolved bill', () => {
    expect(computeBillStatus(baseBill())).toBe('ready');
  });

  it('returns needs_review when row has needsReview flag', () => {
    const bill = baseBill({
      rows: [{ ...baseBill().rows[0], needsReview: true }],
    });
    expect(computeBillStatus(bill)).toBe('needs_review');
  });

  it('returns needs_review for soft match below floor', () => {
    const row = { ...baseBill().rows[0], matchScore: 0.5 };
    expect(isSoftMatch(row)).toBe(true);
    expect(computeBillStatus(baseBill({ rows: [row] }))).toBe('needs_review');
  });

  it('returns needs_review for row math mismatch', () => {
    const row = {
      ...baseBill().rows[0],
      validationIssues: ['row_math_mismatch'],
    };
    expect(hasRowMathMismatch(row)).toBe(true);
    expect(computeBillStatus(baseBill({ rows: [row] }))).toBe('needs_review');
  });

  it('aligns needs_review with rowNeedsAttention for resolved rows', () => {
    const row = { ...baseBill().rows[0], needsReview: true };
    expect(rowNeedsAttention(row, false)).toBe(true);
    expect(computeBillStatus(baseBill({ rows: [row] }))).toBe('needs_review');
  });
});
