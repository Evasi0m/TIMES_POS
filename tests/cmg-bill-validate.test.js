import { describe, it, expect } from 'vitest';
import {
  stripCmgModelPrefix,
  validateCmgBill,
  applyValidationToParsedBill,
  formatValidationSummary,
  validateRowMath,
  isValidCmgInvoiceNo,
  ROW_TOLERANCE,
} from '../src/lib/cmg-bill-validate.js';

describe('stripCmgModelPrefix', () => {
  it('strips CE prefix', () => {
    expect(stripCmgModelPrefix('CE LTP-1302DS-4AVDF')).toBe('LTP-1302DS-4AVDF');
  });

  it('strips CB prefix', () => {
    expect(stripCmgModelPrefix('CB W-738H-1BVDF')).toBe('W-738H-1BVDF');
  });

  it('leaves bare model unchanged', () => {
    expect(stripCmgModelPrefix('GA-2100-1A1')).toBe('GA-2100-1A1');
  });
});

describe('validateCmgBill', () => {
  it('passes when row math matches', () => {
    const result = validateCmgBill({
      items: [{
        model_code: 'W-218HC-4A2VDF',
        quantity: 5,
        unit_cost: 471.03,
        line_amount: 2355.15,
      }],
      bill_subtotal: 2355.15,
      total_qty: 5,
      vat_amount: 164.86,
      grand_total: 2520.01,
    });
    expect(result.rows).toHaveLength(0);
    expect(result.rowFlags).toEqual([false]);
    expect(result.bill.warnings).toHaveLength(0);
  });

  it('flags row when qty � unit_cost ? line_amount', () => {
    const result = validateCmgBill({
      items: [{
        model_code: 'W-218HC-4A2VDF',
        quantity: 3,
        unit_cost: 471.03,
        line_amount: 2355.15,
      }],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].issues).toContain('row_math_mismatch');
    expect(result.rowFlags).toEqual([true]);
  });

  it('skips row math when line_amount is missing', () => {
    const result = validateCmgBill({
      items: [{ model_code: 'X', quantity: 5, unit_cost: 100, line_amount: 0 }],
    });
    expect(result.rows).toHaveLength(0);
    expect(result.rowFlags).toEqual([false]);
  });

  it('warns on footer sum mismatch without flagging rows', () => {
    const result = validateCmgBill({
      items: [
        { quantity: 5, unit_cost: 471.03, line_amount: 2355.15 },
      ],
      bill_subtotal: 9999,
    });
    expect(result.rows).toHaveLength(0);
    expect(result.bill.warnings).toContain('sum_mismatch');
  });

  it('warns when sum qty ? total_qty', () => {
    const result = validateCmgBill({
      items: [
        { quantity: 5, unit_cost: 100, line_amount: 500 },
        { quantity: 3, unit_cost: 100, line_amount: 300 },
      ],
      total_qty: 10,
    });
    expect(result.bill.warnings).toContain('qty_total_mismatch');
  });

  it('warns footer_unverified when line amounts exist but footer is empty', () => {
    const result = validateCmgBill({
      items: [{ quantity: 1, unit_cost: 100, line_amount: 100 }],
    });
    expect(result.bill.warnings).toContain('footer_unverified');
  });

  it('flags invalid invoice number format', () => {
    const result = validateCmgBill({
      is_cmg_bill: true,
      supplier_invoice_no: '12345',
      items: [{ quantity: 1, unit_cost: 100, line_amount: 100 }],
    });
    expect(result.bill.warnings).toContain('invoice_format_invalid');
  });

  it('applyValidationToParsedBill sets needs_review on bad row math', () => {
    const enriched = applyValidationToParsedBill({
      items: [{
        model_code: 'X',
        quantity: 3,
        unit_cost: 100,
        line_amount: 500,
        needs_review: false,
      }],
    });
    expect(enriched.items[0].needs_review).toBe(true);
    expect(enriched.validation.rowFlags[0]).toBe(true);
  });

  it('respects ROW_TOLERANCE for rounding', () => {
    const expected = 5 * 471.03;
    const result = validateCmgBill({
      items: [{
        quantity: 5,
        unit_cost: 471.03,
        line_amount: expected + ROW_TOLERANCE * 0.5,
      }],
    });
    expect(result.rows).toHaveLength(0);
  });
});

describe('isValidCmgInvoiceNo', () => {
  it('accepts 10-digit invoice numbers', () => {
    expect(isValidCmgInvoiceNo('1312257064')).toBe(true);
  });

  it('rejects short or non-numeric invoice numbers', () => {
    expect(isValidCmgInvoiceNo('12345')).toBe(false);
    expect(isValidCmgInvoiceNo('13122570641')).toBe(false);
    expect(isValidCmgInvoiceNo('')).toBe(false);
  });
});

describe('formatValidationSummary', () => {
  it('returns pass message when clean', () => {
    expect(formatValidationSummary({ rows: [], bill: { warnings: [] } }))
      .toBe('ตรวจเลขผ่าน');
  });

  it('summarizes row and bill issues', () => {
    const msg = formatValidationSummary({
      rows: [{ index: 0 }],
      bill: { warnings: ['sum_mismatch'] },
    });
    expect(msg).toContain('1 แถวเลขไม่ตรง');
    expect(msg).toContain('footer 1 จุด');
  });
});

describe('validateRowMath', () => {
  it('detects mismatch from live row fields', () => {
    const result = validateRowMath({
      quantity: 3,
      unit_cost: 100,
      line_amount: 500,
    });
    expect(result.mismatch).toBe(true);
    expect(result.detail).toBeTruthy();
  });

  it('passes when qty � cost matches line_amount', () => {
    const result = validateRowMath({
      quantity: 5,
      unit_cost: 471.03,
      line_amount: 2355.15,
    });
    expect(result.mismatch).toBe(false);
  });
});
