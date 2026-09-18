import { describe, it, expect } from 'vitest';
import { validateBillRowsForSubmit } from '../src/lib/receive-submit-preflight.js';

const BLOCK_DUP_MSG = '\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E0B\u0E49\u0E33\u0E44\u0E14\u0E49';
const UNMATCHED_MSG = '\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E08\u0E31\u0E1A\u0E04\u0E39\u0E2A\u0E34\u0E19\u0E04\u0E49\u0E32';

const baseBill = {
  supplier_invoice_no: '1312999999',
  has_vat: true,
  rows: [
    { status: 'auto', product: { id: 1, name: 'GA-100-1A1' }, quantity: 2, unit_cost: 1000 },
  ],
};

describe('validateBillRowsForSubmit', () => {
  it('returns null for a valid bill', () => {
    expect(validateBillRowsForSubmit(baseBill)).toBeNull();
  });

  it('blocks duplicate supplier invoice numbers', () => {
    const err = validateBillRowsForSubmit(baseBill, {
      dupInvoice: { id: 6005, date: '2026-01-15T00:00:00Z' },
    });
    expect(err).toContain('1312999999');
    expect(err).toContain('6005');
    expect(err).toContain(BLOCK_DUP_MSG);
  });

  it('blocks invalid invoice number format', () => {
    const err = validateBillRowsForSubmit({ ...baseBill, supplier_invoice_no: '12345' });
    expect(err).toBeTruthy();
    expect(err).toContain('12345');
  });

  it('ignores dupInvoice when invoice number is blank', () => {
    expect(validateBillRowsForSubmit(
      { ...baseBill, supplier_invoice_no: '  ' },
      { dupInvoice: { id: 1, date: '2026-01-01' } },
    )).toBeNull();
  });

  it('reports unresolved rows', () => {
    const err = validateBillRowsForSubmit({
      ...baseBill,
      rows: [{ status: 'none', quantity: 1, unit_cost: 100 }],
    });
    expect(err).toContain(UNMATCHED_MSG);
  });

  it('allows multiple distinct new products in one bill', () => {
    expect(validateBillRowsForSubmit({
      ...baseBill,
      rows: [
        { status: 'new', newProduct: { name: 'GR-B300H-5ADR' }, quantity: 2, unit_cost: 6074.77 },
        { status: 'new', newProduct: { name: 'GMA-P2110B-1ADR' }, quantity: 2, unit_cost: 2803.74 },
      ],
    })).toBeNull();
  });

  it('blocks duplicate new-product rows with different unit costs', () => {
    const err = validateBillRowsForSubmit({
      ...baseBill,
      rows: [
        { status: 'new', newProduct: { name: 'GR-B300H-5ADR' }, quantity: 2, unit_cost: 6074.77 },
        { status: 'new', newProduct: { name: 'GR-B300H-5ADR' }, quantity: 1, unit_cost: 6000 },
      ],
    });
    expect(err).toMatch(/GR-B300H-5ADR/);
    expect(err).toMatch(/แถว/);
  });
});
