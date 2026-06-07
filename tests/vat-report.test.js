import { describe, it, expect } from 'vitest';
import {
  vatFromGross,
  inputVatFromGross,
  returnVatFromGross,
  cogsVatFromGross,
  computeVatAggregates,
  computeCompliance,
  salesCreditNoteLabel,
} from '../src/lib/vat-report.js';
import { roundMoney } from '../src/lib/money.js';

describe('vatFromGross (output / sales)', () => {
  it('uses stored vat_amount when > 0', () => {
    expect(vatFromGross(1070, 70, 7)).toBe(70);
  });
  it('extracts 7/107 when vat_amount missing', () => {
    expect(vatFromGross(107, null, 7)).toBeCloseTo(7, 2);
    expect(vatFromGross(1070, 0, 7)).toBeCloseTo(70, 1);
  });
  it('returns 0 when rate is 0 and no stored vat', () => {
    expect(vatFromGross(500, 0, 0)).toBe(0);
  });
});

describe('inputVatFromGross (receive / claim)', () => {
  it('uses stored vat_amount when > 0', () => {
    expect(inputVatFromGross(2675, 175)).toBe(175);
  });
  it('defaults to 7/107 when vat_amount is 0 (ignores header vat_rate)', () => {
    expect(inputVatFromGross(107, 0)).toBeCloseTo(7, 2);
  });
});

describe('returnVatFromGross', () => {
  it('extracts 7/107 from return total_value', () => {
    expect(returnVatFromGross(107)).toBeCloseTo(7, 2);
  });
});

describe('cogsVatFromGross', () => {
  it('matches cost × qty × 7/107 pattern', () => {
    expect(cogsVatFromGross(1070)).toBeCloseTo(70, 1);
  });
});

describe('computeVatAggregates', () => {
  it('computes net VAT payable after credit notes', () => {
    const agg = computeVatAggregates({
      salesRows: [{ grand_total: 1070, vat_amount: 70, vat_rate: 7, channel: 'store' }],
      recvRows: [{ total_value: 1070, vat_amount: 70, supplier_name: 'CMG' }],
      returnRows: [{ total_value: 107 }],
      claimRows: [{ total_value: 107, vat_amount: null }],
      cogsRows: [{ cost_price: 500, quantity: 2 }],
    });
    expect(agg.outputTotalVat).toBe(70);
    expect(agg.inputTotalVat).toBe(70);
    expect(agg.returnTotalVat).toBeCloseTo(7, 2);
    expect(agg.claimTotalVat).toBeCloseTo(7, 2);
    expect(roundMoney(agg.vatPayable)).toBe(roundMoney(70 - 7 - (70 - 7)));
    expect(agg.cogsTotalGross).toBe(1000);
  });
});

describe('computeCompliance', () => {
  it('flags missing tax invoice and supplier fields', () => {
    const c = computeCompliance(
      [{ grand_total: 100, vat_amount: 7, vat_rate: 7 }],
      [{ total_value: 200, vat_amount: 14 }],
    );
    expect(c.salesNoTaxInvoice.count).toBe(1);
    expect(c.recvNoSupplierTaxId.count).toBe(1);
    expect(c.recvNoInvoiceNo.count).toBe(1);
  });
});

describe('salesCreditNoteLabel', () => {
  it('prefers credit_note_no when issued', () => {
    expect(salesCreditNoteLabel({ id: 5, credit_note_no: 'CN6900003' })).toBe('CN6900003');
  });
  it('falls back to RT# placeholder', () => {
    expect(salesCreditNoteLabel({ id: 5 })).toBe('(ใบลดหนี้) RT#5');
  });
});
