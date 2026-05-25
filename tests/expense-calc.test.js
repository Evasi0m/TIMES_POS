import { describe, it, expect } from 'vitest';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CAT_MAP,
  staffComputed,
  monthExpenseTotal,
  realNetProfit,
} from '../src/lib/expense-calc.js';

describe('staffComputed', () => {
  it('returns base salary when commission% is 0', () => {
    expect(staffComputed({ base_salary: 12000, commission_pct: 0 }, 500000)).toBe(12000);
  });

  it('adds commission proportional to month sales', () => {
    // 12,000 + 2% × 500,000 = 12,000 + 10,000 = 22,000
    expect(staffComputed({ base_salary: 12000, commission_pct: 2 }, 500000)).toBe(22000);
  });

  it('handles fractional commission percentages', () => {
    // 0% base, 0.5% × 200,000 = 1,000
    expect(staffComputed({ base_salary: 0, commission_pct: 0.5 }, 200000)).toBe(1000);
  });

  it('returns 0 for null/undefined draft', () => {
    expect(staffComputed(null, 500000)).toBe(0);
    expect(staffComputed(undefined, 500000)).toBe(0);
    expect(staffComputed({}, 500000)).toBe(0);
  });

  it('coerces string numeric input', () => {
    expect(staffComputed({ base_salary: '10000', commission_pct: '1' }, '100000')).toBe(11000);
  });

  it('treats NaN/missing month sales as zero', () => {
    expect(staffComputed({ base_salary: 12000, commission_pct: 5 }, NaN)).toBe(12000);
    expect(staffComputed({ base_salary: 12000, commission_pct: 5 }, undefined)).toBe(12000);
  });

  it('does NOT round — caller decides rounding for display', () => {
    // 1.5% × 333,333 = 4,999.995 — must be returned exactly so the
    // P&L card and the CSV export agree to the cent.
    expect(staffComputed({ base_salary: 0, commission_pct: 1.5 }, 333333)).toBeCloseTo(4999.995, 5);
  });
});

describe('monthExpenseTotal', () => {
  const monthSales = 500000;

  it('returns 0 for an empty draft', () => {
    expect(monthExpenseTotal({}, monthSales)).toBe(0);
    expect(monthExpenseTotal(null, monthSales)).toBe(0);
  });

  it('sums fixed categories', () => {
    const draft = {
      electricity: { amount: 3500 },
      rent:        { amount: 25000 },
      tape:        { amount: 200 },
    };
    expect(monthExpenseTotal(draft, monthSales)).toBe(28700);
  });

  it('sums staff base + commission via staffComputed', () => {
    const draft = {
      staff_1: { base_salary: 12000, commission_pct: 2 },
      staff_2: { base_salary: 10000, commission_pct: 1 },
    };
    // 12k + 2%×500k + 10k + 1%×500k = 22,000 + 15,000 = 37,000
    expect(monthExpenseTotal(draft, monthSales)).toBe(37000);
  });

  it('mixes fixed + staff + free-form "other:" rows', () => {
    const draft = {
      electricity: { amount: 3500 },
      staff_1:     { base_salary: 12000, commission_pct: 2 },
      'other:น้ำมัน': { amount: 800 },
      'other:ค่าน้ำ': { amount: 450 },
    };
    // 3500 + 22000 + 800 + 450 = 26,750
    expect(monthExpenseTotal(draft, monthSales)).toBe(26750);
  });

  it('skips categories whose draft entry is null/undefined', () => {
    const draft = { electricity: null, rent: { amount: 25000 } };
    expect(monthExpenseTotal(draft, monthSales)).toBe(25000);
  });

  it('treats missing/non-numeric amounts as 0', () => {
    const draft = {
      electricity: { amount: 'abc' },
      rent:        { amount: null },
      tape:        { amount: '200' },
    };
    expect(monthExpenseTotal(draft, monthSales)).toBe(200);
  });
});

describe('realNetProfit', () => {
  it('subtracts shop expenses from gross profit', () => {
    expect(realNetProfit(100000, 30000)).toBe(70000);
  });

  it('returns negative when expenses exceed profit (a real shop month)', () => {
    expect(realNetProfit(20000, 30000)).toBe(-10000);
  });

  it('treats missing/non-numeric inputs as 0', () => {
    expect(realNetProfit(undefined, 30000)).toBe(-30000);
    expect(realNetProfit(100000, undefined)).toBe(100000);
    expect(realNetProfit(null, null)).toBe(0);
    expect(realNetProfit('abc', 'xyz')).toBe(0);
  });
});

describe('EXPENSE_CATEGORIES schema', () => {
  it('every entry has key + label + icon', () => {
    EXPENSE_CATEGORIES.forEach((c) => {
      expect(typeof c.key).toBe('string');
      expect(typeof c.label).toBe('string');
      expect(typeof c.icon).toBe('string');
    });
  });

  it('staff entries are explicitly flagged so the UI can branch on them', () => {
    const staffKeys = EXPENSE_CATEGORIES.filter((c) => c.staff).map((c) => c.key);
    expect(staffKeys).toEqual(['staff_1', 'staff_2']);
  });

  it('keys are unique', () => {
    const keys = EXPENSE_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('EXPENSE_CAT_MAP exposes the same set keyed by .key', () => {
    expect(Object.keys(EXPENSE_CAT_MAP).sort()).toEqual(
      EXPENSE_CATEGORIES.map((c) => c.key).sort()
    );
    EXPENSE_CATEGORIES.forEach((c) => {
      expect(EXPENSE_CAT_MAP[c.key]).toBe(c);
    });
  });
});
