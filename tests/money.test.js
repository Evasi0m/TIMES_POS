import { describe, it, expect } from 'vitest';
import {
  roundMoney,
  fmtTHB,
  vatBreakdown,
  applyDiscounts,
  addVat,
  stripVat,
  VAT_RATE_DEFAULT,
} from '../src/lib/money.js';

describe('addVat / stripVat', () => {
  it('addVat adds 7% by default and rounds to satang', () => {
    expect(addVat(1000)).toBe(1070);
    expect(addVat(1138.32)).toBe(1218); // 1138.32 * 1.07 = 1218.0024
  });
  it('stripVat is the inverse of addVat (modulo satang)', () => {
    expect(stripVat(1070)).toBe(1000);
    expect(roundMoney(stripVat(addVat(2499)))).toBe(2499);
  });
  it('rate 0 is a no-op (just rounds)', () => {
    expect(addVat(1234.5, 0)).toBe(1234.5);
    expect(stripVat(1234.5, 0)).toBe(1234.5);
  });
  it('coerces junk input to 0', () => {
    expect(addVat(null)).toBe(0);
    expect(stripVat(undefined)).toBe(0);
    expect(addVat('abc')).toBe(0);
  });
});

describe('roundMoney', () => {
  it('handles classic float drift cases', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(99.99 * 3)).toBe(299.97);
  });
  it('coerces non-numbers to 0', () => {
    expect(roundMoney(null)).toBe(0);
    expect(roundMoney(undefined)).toBe(0);
    expect(roundMoney('not a number')).toBe(0);
    expect(roundMoney('')).toBe(0);
  });
  it('rounds half away from zero (banker-safe via EPSILON)', () => {
    expect(roundMoney(2.005)).toBe(2.01); // classic 2.005 → 2 bug guarded
    expect(roundMoney(1.005)).toBe(1.01);
  });
});

describe('fmtTHB', () => {
  it('uses ฿ symbol and Thai locale grouping', () => {
    expect(fmtTHB(1234)).toBe('฿1,234');
    expect(fmtTHB(1234.5)).toBe('฿1,234.5');
    expect(fmtTHB(1234567.89)).toBe('฿1,234,567.89');
  });
  it('drops trailing zero satang', () => {
    expect(fmtTHB(100)).toBe('฿100');
    expect(fmtTHB(100.0)).toBe('฿100');
  });
});

describe('vatBreakdown', () => {
  it('splits 7% VAT-inclusive total', () => {
    const { vat, exVat } = vatBreakdown(107, 7);
    expect(exVat).toBe(100);
    expect(vat).toBe(7);
    expect(roundMoney(vat + exVat)).toBe(107);
  });
  it('handles 0% VAT (returns full as exVat)', () => {
    expect(vatBreakdown(500, 0)).toEqual({ vat: 0, exVat: 500 });
  });
  it('uses 7% as default rate', () => {
    const a = vatBreakdown(107);
    const b = vatBreakdown(107, VAT_RATE_DEFAULT);
    expect(a).toEqual(b);
  });
  it('keeps vat + exVat == grand even on awkward totals', () => {
    for (const grand of [1, 9, 99, 1234, 99999.99, 0.5]) {
      const { vat, exVat } = vatBreakdown(grand, 7);
      expect(roundMoney(vat + exVat)).toBe(roundMoney(grand));
    }
  });
});

describe('applyDiscounts', () => {
  it('returns unitPrice × qty when no discounts', () => {
    expect(applyDiscounts(100, 3, 0, null, 0, null)).toBe(300);
  });
  it('applies a single percent discount', () => {
    expect(applyDiscounts(100, 1, 10, 'percent', 0, null)).toBe(90);
  });
  it('applies a single baht discount', () => {
    expect(applyDiscounts(100, 1, 25, 'baht', 0, null)).toBe(75);
  });
  it('cascades two discounts (percent then percent)', () => {
    // 100 → 90 → 81
    expect(applyDiscounts(100, 1, 10, 'percent', 10, 'percent')).toBe(81);
  });
  it('cascades percent then baht', () => {
    // 200 → 180 → 150
    expect(applyDiscounts(200, 1, 10, 'percent', 30, 'baht')).toBe(150);
  });
  it('clamps negative line totals to 0', () => {
    expect(applyDiscounts(50, 1, 100, 'baht', 0, null)).toBe(0);
  });
  it('handles fractional drift safely', () => {
    // 0.1 × 3 = 0.3 (not 0.30000000000000004)
    expect(applyDiscounts(0.1, 3, 0, null, 0, null)).toBe(0.3);
    // 99.99 × 33% off, qty 3:
    //   step 1: 99.99 × 0.67 = 66.9933 → 66.99
    //   step 2: × 3 = 200.97
    expect(applyDiscounts(99.99, 3, 33, 'percent', 0, null)).toBe(200.97);
  });
  it('coerces invalid qty / discount values to 0', () => {
    expect(applyDiscounts(100, 'x', 0, null, 0, null)).toBe(0);
    expect(applyDiscounts(100, 1, 'x', 'percent', 0, null)).toBe(100);
  });
});
