import { describe, it, expect } from 'vitest';
import { footerComparison } from '../src/lib/cmg-bill-validate.js';
import {
  liveFooterWarnings,
  isFooterConfirmed,
  footerWarningsSig,
  computeBillStatus,
} from '../src/components/ai/bill-review-shared.js';

const row = (over = {}) => ({
  uid: Math.random().toString(36).slice(2),
  model_code: 'A',
  quantity: 5,
  unit_cost: 100,
  line_amount: 500,
  status: 'auto',
  product: { id: Math.floor(Math.random() * 1e9), name: 'A' },
  reviewConfirmed: true,
  needsReview: false,
  validationIssues: [],
  ...over,
});

// Footer: 2 lines × 5 pcs × 100 = 1,000 before VAT, 10 pcs.
const bill = (rows, over = {}) => ({
  is_cmg_bill: true,
  supplier_invoice_no: '',
  rows,
  validation: { bill: { warnings: [] }, rows: [] },
  bill_subtotal: 1000,
  total_qty: 10,
  vat_amount: 70,
  grand_total: 1070,
  footerConfirmed: true,
  ...over,
});

describe('liveFooterWarnings', () => {
  it('matching rows → no warnings', () => {
    expect(liveFooterWarnings(bill([row(), row()]))).toEqual([]);
  });

  it('deleting a row raises the footer check again', () => {
    const w = liveFooterWarnings(bill([row()]));
    expect(w).toContain('qty_total_mismatch');
    expect(w).toContain('sum_mismatch');
  });

  it('fixing a misread qty clears a parse-time warning', () => {
    const b = bill([row(), row()], {
      validation: { bill: { warnings: ['qty_total_mismatch'] }, rows: [] },
      footerConfirmed: false,
    });
    expect(liveFooterWarnings(b)).toEqual([]);
    expect(computeBillStatus(b)).toBe('ready');
  });

  it('an approved qty override counts at the billed qty', () => {
    const over = row({
      quantity: 2,
      qtyOverride: { quantity: 2, unit_cost: 100, billQty: 5, by: 'x', at: 'y' },
    });
    expect(liveFooterWarnings(bill([row(), over]))).toEqual([]);
  });
});

describe('isFooterConfirmed', () => {
  it('a confirm covers only the warnings it was given for', () => {
    const b = bill([row()], { footerConfirmed: false });
    const w = liveFooterWarnings(b);
    const confirmed = { ...b, footerConfirmed: true, footerConfirmedSig: footerWarningsSig(w) };
    expect(isFooterConfirmed(confirmed)).toBe(true);
    // Later edit changes the set of warnings → confirm no longer applies.
    // qty now matches the footer but the amount still doesn't → different set.
    const edited = { ...confirmed, rows: [row({ quantity: 10, unit_cost: 50, line_amount: 500 })] };
    expect(isFooterConfirmed(edited)).toBe(false);
  });
});

describe('footerComparison', () => {
  it('lists printed vs summed values and marks mismatches', () => {
    const cmp = footerComparison({
      items: [{ quantity: 5, unit_cost: 100, line_amount: 500 }],
      bill_subtotal: 1000, total_qty: 10, vat_amount: 70, grand_total: 1070,
    });
    const qty = cmp.find((c) => c.key === 'qty');
    expect(qty).toMatchObject({ bill: 10, rows: 5, ok: false });
    expect(cmp.find((c) => c.key === 'subtotal')).toMatchObject({ bill: 1000, rows: 500, ok: false });
    expect(cmp.find((c) => c.key === 'vat').ok).toBe(true);
  });
  it('skips lines the footer did not print', () => {
    expect(footerComparison({ items: [], bill_subtotal: 0, total_qty: 0 })).toEqual([]);
  });
});
