import { describe, it, expect } from 'vitest';
import {
  buildReceiveItems,
  receiveTotals,
  grossUnitCost,
  suggestedRetail,
} from '../src/lib/ai-receive.js';

const row = (over = {}) => ({
  product: { id: 1, name: 'GA-100-1A1' },
  quantity: 2,
  unit_cost: 1000,
  ...over,
});

describe('buildReceiveItems', () => {
  it('adds VAT to the per-unit cost by default (gross unit_price)', () => {
    const items = buildReceiveItems([row()], true);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      product_id: 1,
      product_name: 'GA-100-1A1',
      quantity: 2,
      unit: 'เรือน',
      unit_price: 1070, // 1000 + 7%
    });
  });

  it('skips VAT when hasVat is false', () => {
    const items = buildReceiveItems([row()], false);
    expect(items[0].unit_price).toBe(1000);
  });

  it('drops rows whose product is unresolved', () => {
    const items = buildReceiveItems([row(), row({ product: null })], true);
    expect(items).toHaveLength(1);
  });

  it('throws on a 0-cost or 0-qty row (never persist a bad line)', () => {
    expect(() => buildReceiveItems([row({ unit_cost: 0 })], true)).toThrow();
    expect(() => buildReceiveItems([row({ quantity: 0 })], true)).toThrow();
  });

  it('floors negative qty/cost so the guard fires (no inventing stock)', () => {
    expect(() => buildReceiveItems([row({ quantity: -3 })], true)).toThrow();
  });
});

describe('receiveTotals', () => {
  it('sums gross line totals and breaks out the VAT portion', () => {
    const items = buildReceiveItems([row(), row({ unit_cost: 500, quantity: 1 })], true);
    // lines: 1070*2 + 535*1 = 2140 + 535 = 2675
    const { total, vat } = receiveTotals(items, true);
    expect(total).toBe(2675);
    // VAT portion of a 2675 VAT-inclusive total at 7%
    expect(vat).toBeCloseTo(2675 - 2675 / 1.07, 2);
  });
  it('reports 0 VAT when hasVat is false', () => {
    const items = buildReceiveItems([row()], false);
    expect(receiveTotals(items, false).vat).toBe(0);
  });
});

describe('grossUnitCost', () => {
  it('matches the unit_price math used in items', () => {
    expect(grossUnitCost(1000, true)).toBe(1070);
    expect(grossUnitCost(1000, false)).toBe(1000);
  });
});

describe('suggestedRetail', () => {
  it('marks up the gross cost and rounds to a tidy 10 baht', () => {
    // gross 1070 * 2 = 2140 → 2140
    expect(suggestedRetail(1000, true, 2)).toBe(2140);
    // gross 1070 * 1.5 = 1605 → round/10 → 1600 (1605→160.5→161→1610? check)
    expect(suggestedRetail(1000, true, 1.5)).toBe(1610);
  });
  it('never returns negative', () => {
    expect(suggestedRetail(0, true, 2)).toBe(0);
  });
});
