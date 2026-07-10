import { describe, it, expect } from 'vitest';
import {
  parseCmgBillImportFile,
  normalizeImportText,
  MAX_IMPORT_BILLS,
  isLikelyJsonFile,
} from '../src/lib/cmg-bill-import.js';

const validOneBill = {
  bills: [{
    is_cmg_bill: true,
    supplier_invoice_no: '1312257064',
    bill_subtotal: 2355.15,
    total_qty: 5,
    vat_amount: 164.86,
    grand_total: 2520.01,
    items: [{
      model_code: 'CE W-218HC-4A2VDF',
      quantity: 5,
      unit_cost: 471.03,
      line_amount: 2355.15,
      needs_review: false,
    }],
  }],
};

describe('parseCmgBillImportFile', () => {
  it('accepts a valid single-bill file and strips CE prefix', () => {
    const result = parseCmgBillImportFile(JSON.stringify(validOneBill));
    expect(result.ok).toBe(true);
    expect(result.bills).toHaveLength(1);
    expect(result.bills[0].items[0].model_code).toBe('W-218HC-4A2VDF');
    expect(result.bills[0].supplier_invoice_no).toBe('1312257064');
  });

  it('accepts JSON with UTF-8 BOM prefix', () => {
    const result = parseCmgBillImportFile('\uFEFF' + JSON.stringify(validOneBill));
    expect(result.ok).toBe(true);
    expect(result.bills).toHaveLength(1);
  });

  it('rejects invalid JSON', () => {
    const result = parseCmgBillImportFile('{not json');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/JSON/);
  });

  it('rejects missing bills array', () => {
    const result = parseCmgBillImportFile(JSON.stringify({ foo: 1 }));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/bills/);
  });

  it('rejects empty bills array', () => {
    const result = parseCmgBillImportFile(JSON.stringify({ bills: [] }));
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects more than MAX_IMPORT_BILLS', () => {
    const bills = Array.from({ length: MAX_IMPORT_BILLS + 1 }, (_, i) => ({
      ...validOneBill.bills[0],
      supplier_invoice_no: String(1000 + i),
    }));
    const result = parseCmgBillImportFile(JSON.stringify({ bills }));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(String(MAX_IMPORT_BILLS));
  });

  it('rejects bill with empty items', () => {
    const bad = {
      bills: [{ ...validOneBill.bills[0], items: [] }],
    };
    const result = parseCmgBillImportFile(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/1312257064/);
  });

  it('rejects row math mismatch', () => {
    const bad = {
      bills: [{
        ...validOneBill.bills[0],
        items: [{
          model_code: 'W-218HC-4A2VDF',
          quantity: 5,
          unit_cost: 471.03,
          line_amount: 9999,
          needs_review: false,
        }],
      }],
    };
    const result = parseCmgBillImportFile(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/line_amount/);
  });

  it('rejects missing item field', () => {
    const bad = {
      bills: [{
        ...validOneBill.bills[0],
        items: [{ model_code: 'X', quantity: 1, unit_cost: 10 }],
      }],
    };
    const result = parseCmgBillImportFile(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/line_amount/);
  });

  it('rejects duplicate supplier_invoice_no within file', () => {
    const dup = {
      bills: [
        validOneBill.bills[0],
        { ...validOneBill.bills[0], items: [...validOneBill.bills[0].items] },
      ],
    };
    const result = parseCmgBillImportFile(JSON.stringify(dup));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/1312257064/);
    expect(result.errors[0]).toMatch(/ซ้ำในไฟล์/);
    expect(result.errors.length).toBe(1);
  });

  it('rejects is_cmg_bill false', () => {
    const bad = {
      bills: [{ ...validOneBill.bills[0], is_cmg_bill: false }],
    };
    const result = parseCmgBillImportFile(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/is_cmg_bill/);
  });
});

describe('normalizeImportText', () => {
  it('trims whitespace and strips UTF-8 BOM', () => {
    const json = JSON.stringify(validOneBill);
    expect(normalizeImportText('\uFEFF  ' + json + '  ')).toBe(json);
  });

  it('strips markdown json fences', () => {
    const json = JSON.stringify(validOneBill);
    expect(normalizeImportText('```json\n' + json + '\n```')).toBe(json);
  });

  it('accepts fenced JSON via parseCmgBillImportFile', () => {
    const json = JSON.stringify(validOneBill);
    const result = parseCmgBillImportFile('```json\n' + json + '\n```');
    expect(result.ok).toBe(true);
    expect(result.bills).toHaveLength(1);
  });
});

describe('isLikelyJsonFile', () => {
  it('accepts .json extension', () => {
    expect(isLikelyJsonFile({ name: 'bills.json', type: '' })).toBe(true);
  });

  it('accepts application/json mime', () => {
    expect(isLikelyJsonFile({ name: 'data', type: 'application/json' })).toBe(true);
  });

  it('rejects non-json files', () => {
    expect(isLikelyJsonFile({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(false);
  });
});
