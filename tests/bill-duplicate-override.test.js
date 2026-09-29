import { describe, it, expect } from 'vitest';
import { flagDuplicateModelRows } from '../src/lib/bill-materialize.js';
import { findDuplicateProductRows, formatDuplicateProductError } from '../src/lib/ai-receive.js';
import { validateBillRowsForSubmit } from '../src/lib/receive-submit-preflight.js';
import {
  computeBillStatus,
  hasRowMathMismatch,
  isQtyOverrideValid,
} from '../src/components/ai/bill-review-shared.js';

const base = (over = {}) => ({
  uid: Math.random().toString(36).slice(2),
  model_code: 'W-218H-1AVDF',
  quantity: 20,
  unit_cost: 500,
  line_amount: 10000,
  status: 'auto',
  product: { id: 1, name: 'W-218H-1AVDF' },
  reviewConfirmed: true,
  needsReview: false,
  validationIssues: [],
  ...over,
});

describe('flagDuplicateModelRows', () => {
  it('keeps both rows when the AI reads the same model twice', () => {
    const rows = flagDuplicateModelRows([base(), base()]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.dupModel && r.needsReview)).toBe(true);
  });
  it('leaves unique rows untouched', () => {
    const r = base();
    const out = flagDuplicateModelRows([r, base({ model_code: 'AE-1200WH-1A' })]);
    expect(out[0]).toBe(r);
    expect(out[1].dupModel).toBeUndefined();
  });
});

describe('findDuplicateProductRows', () => {
  it('groups rows resolved to the same product', () => {
    const dups = findDuplicateProductRows([base(), base({ model_code: 'X' }), base({ product: { id: 2, name: 'B' } })]);
    expect(dups).toHaveLength(1);
    expect(dups[0].indices).toEqual([0, 1]);
    expect(formatDuplicateProductError(dups)).toMatch(/แถว 1 และ 2/);
  });
  it('catches two new products with the same name', () => {
    const np = { status: 'new', product: null, newProduct: { name: 'abc-1' } };
    const dups = findDuplicateProductRows([base(np), base({ ...np, newProduct: { name: 'ABC-1' } })]);
    expect(dups).toHaveLength(1);
  });
});

describe('duplicate product blocks save', () => {
  it('preflight names the rows', () => {
    const bill = { is_cmg_bill: true, supplier_invoice_no: '', has_vat: true, rows: [base(), base()] };
    expect(validateBillRowsForSubmit(bill)).toMatch(/แถว 1 และ 2/);
  });
  it('bill status is needs_review', () => {
    const bill = { is_cmg_bill: true, supplier_invoice_no: '', rows: [base(), base()] };
    expect(computeBillStatus(bill)).toBe('needs_review');
  });
});

describe('qty override (differs from printed bill)', () => {
  const edited = base({ quantity: 5 }); // bill says 20 × 500 = 10,000

  it('an edited qty is a row-math mismatch without approval', () => {
    expect(hasRowMathMismatch(edited)).toBe(true);
    const bill = { is_cmg_bill: true, supplier_invoice_no: '', rows: [edited] };
    expect(computeBillStatus(bill)).toBe('needs_review');
  });

  it('an approved override clears the mismatch and the bill becomes ready', () => {
    const row = { ...edited, qtyOverride: { quantity: 5, unit_cost: 500, billQty: 20, by: 'admin', at: 'x' } };
    expect(isQtyOverrideValid(row)).toBe(true);
    expect(hasRowMathMismatch(row)).toBe(false);
    const bill = { is_cmg_bill: true, supplier_invoice_no: '', rows: [row] };
    expect(computeBillStatus(bill)).toBe('ready');
  });

  it('editing the qty again invalidates the approval', () => {
    const row = { ...edited, quantity: 6, qtyOverride: { quantity: 5, unit_cost: 500, billQty: 20, by: 'admin', at: 'x' } };
    expect(isQtyOverrideValid(row)).toBe(false);
    expect(hasRowMathMismatch(row)).toBe(true);
  });
});
