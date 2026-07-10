import { describe, it, expect } from 'vitest';
import { parseCmgBillImportFile } from '../src/lib/cmg-bill-import.js';
import { materializeJsonBill } from '../src/lib/bill-materialize.js';
import { computeBillStatus } from '../src/components/ai/bill-review-shared.js';
import { buildReceiveItems } from '../src/lib/ai-receive.js';
import { validateBillRowsForSubmit } from '../src/lib/receive-submit-preflight.js';
import { formatValidationSummary } from '../src/lib/cmg-bill-validate.js';

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

const mockCatalog = [
  { id: 101, name: 'W-218HC-4A2VDF', barcode: 'BC101', current_stock: 0 },
];

describe('JSON import submit pipeline', () => {
  it('parse ? materializeJsonBill ? ready status with footerConfirmed', () => {
    const parsed = parseCmgBillImportFile(JSON.stringify(validOneBill));
    expect(parsed.ok).toBe(true);

    const bill = parsed.bills[0];
    const materialized = materializeJsonBill(bill, mockCatalog);

    expect(materialized.rows).toHaveLength(1);
    expect(materialized.rows[0].status).toBe('auto');
    expect(materialized.rows[0].product?.id).toBe(101);
    expect(materialized.rows[0].reviewConfirmed).toBe(true);
    expect(materialized.footerConfirmed).toBe(true);

    const reviewBill = {
      is_cmg_bill: true,
      saveState: 'pending',
      rows: materialized.rows,
      validation: materialized.validation,
      footerConfirmed: materialized.footerConfirmed,
      has_vat: true,
    };
    expect(computeBillStatus(reviewBill)).toBe('ready');
  });

  it('buildReceiveItems produces RPC-ready payload', () => {
    const parsed = parseCmgBillImportFile(JSON.stringify(validOneBill));
    const materialized = materializeJsonBill(parsed.bills[0], mockCatalog);
    const items = buildReceiveItems(materialized.rows, true);

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].product_id).toBe(101);
    expect(items[0].quantity).toBe(5);
    expect(items[0].unit_price).toBeGreaterThan(0);
  });

  it('validateBillRowsForSubmit passes for a resolved JSON bill', () => {
    const parsed = parseCmgBillImportFile(JSON.stringify(validOneBill));
    const materialized = materializeJsonBill(parsed.bills[0], mockCatalog);
    const err = validateBillRowsForSubmit({
      rows: materialized.rows,
      has_vat: true,
    });
    expect(err).toBeNull();
  });

  it('validateBillRowsForSubmit catches auto row without product.id', () => {
    const err = validateBillRowsForSubmit({
      has_vat: true,
      rows: [{
        status: 'auto',
        model_code: 'GA-100',
        product: { name: 'GA-100' },
        quantity: 1,
        unit_cost: 100,
      }],
    });
    expect(err).toContain('จับคูไม่สมบูรณ์');
  });

  it('validateBillRowsForSubmit catches new row without newProduct', () => {
    const err = validateBillRowsForSubmit({
      has_vat: true,
      rows: [{
        status: 'new',
        model_code: 'NEW-SKU',
        newProduct: null,
        quantity: 1,
        unit_cost: 100,
      }],
    });
    expect(err).toContain('ยังไม่ได้สร้างสินค้าใหม่');
  });

  it('materializeJsonBill does not auto-confirm rows flagged needs_review', () => {
    const bill = {
      ...validOneBill.bills[0],
      items: [{ ...validOneBill.bills[0].items[0], needs_review: true }],
    };
    const materialized = materializeJsonBill(bill, mockCatalog);
    expect(materialized.rows[0].reviewConfirmed).toBe(false);
    expect(materialized.rows[0].needsReview).toBe(true);
  });

  it('formatValidationSummary uses readable Thai', () => {
    expect(formatValidationSummary({ rows: [], bill: { warnings: [] } })).toBe('ตรวจเลขผ่าน');
    expect(formatValidationSummary({
      rows: [{ index: 0, issues: ['row_math_mismatch'] }],
      bill: { warnings: ['sum_mismatch'] },
    })).toContain('แถวเลขไม่ตรง');
    expect(formatValidationSummary({
      rows: [{ index: 0, issues: ['row_math_mismatch'] }],
      bill: { warnings: ['sum_mismatch'] },
    })).not.toMatch(/\?{3,}/);
  });
});
