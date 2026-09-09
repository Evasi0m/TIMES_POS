// Keep in sync with src/lib/cmg-bill-validate.js (server-side copy for edge functions).

export const ROW_TOLERANCE = 0.02;
export const BILL_TOLERANCE = 0.05;
export const VAT_RATE = 0.07;
export const CMG_INVOICE_RE = /^\d{10}$/;

export function roundMoney(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function stripCmgModelPrefix(code: string): string {
  return String(code || '').trim().replace(/^(CE|CB)\s+/i, '');
}

export function isValidCmgInvoiceNo(invoiceNo: string): boolean {
  return CMG_INVOICE_RE.test(String(invoiceNo || '').trim());
}

function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(roundMoney(a) - roundMoney(b)) <= tolerance;
}

function positiveNumber(n: unknown): boolean {
  const v = Number(n);
  return Number.isFinite(v) && v > 0;
}

export interface ParsedBillItem {
  model_code?: string;
  barcode?: string;
  quantity?: number;
  unit_cost?: number;
  line_amount?: number;
  needs_review?: boolean;
}

export interface ParsedBill {
  is_cmg_bill?: boolean;
  supplier_invoice_no?: string;
  bill_subtotal?: number | null;
  total_qty?: number;
  vat_amount?: number | null;
  grand_total?: number | null;
  items?: ParsedBillItem[];
  validation?: ValidationResult;
}

export interface ValidationResult {
  rows: Array<{ index: number; issues: string[]; detail?: string }>;
  bill: { issues: string[]; warnings: string[] };
  rowFlags: boolean[];
}

export function validateCmgBill(parsed: ParsedBill | null | undefined): ValidationResult {
  const items = Array.isArray(parsed?.items) ? parsed!.items! : [];
  const rows: ValidationResult['rows'] = [];
  const rowFlags = items.map(() => false);
  const bill = { issues: [] as string[], warnings: [] as string[] };

  let sumLineAmount = 0;
  let sumQty = 0;
  let hasLineAmounts = false;

  items.forEach((it, index) => {
    const qty = Math.max(0, Math.round(Number(it?.quantity) || 0));
    const unitCost = Math.max(0, Number(it?.unit_cost) || 0);
    const lineAmount = Number(it?.line_amount) || 0;
    const issues: string[] = [];

    if (positiveNumber(lineAmount)) {
      hasLineAmounts = true;
      sumLineAmount = roundMoney(sumLineAmount + lineAmount);
    }
    if (qty > 0) sumQty += qty;

    if (positiveNumber(lineAmount) && qty > 0 && unitCost > 0) {
      const expected = roundMoney(qty * unitCost);
      if (!near(expected, lineAmount, ROW_TOLERANCE)) {
        issues.push('row_math_mismatch');
        rowFlags[index] = true;
        rows.push({
          index,
          issues,
          detail: `${qty} × ${unitCost} ? ${lineAmount} (expected ${expected})`,
        });
      }
    }
  });

  const billSubtotal = Number(parsed?.bill_subtotal) || 0;
  const totalQty = Number(parsed?.total_qty) || 0;
  const vatAmount = Number(parsed?.vat_amount) || 0;
  const grandTotal = Number(parsed?.grand_total) || 0;

  const inv = String(parsed?.supplier_invoice_no || '').trim();
  if (parsed?.is_cmg_bill && inv && !isValidCmgInvoiceNo(inv)) {
    bill.warnings.push('invoice_format_invalid');
  }

  if (hasLineAmounts && !positiveNumber(billSubtotal) && !positiveNumber(grandTotal)) {
    bill.warnings.push('footer_unverified');
  }

  if (hasLineAmounts && positiveNumber(billSubtotal)) {
    if (!near(sumLineAmount, billSubtotal, BILL_TOLERANCE)) {
      bill.warnings.push('sum_mismatch');
    }
  }

  if (sumQty > 0 && positiveNumber(totalQty)) {
    if (sumQty !== Math.round(totalQty)) {
      bill.warnings.push('qty_total_mismatch');
    }
  }

  if (positiveNumber(billSubtotal) && positiveNumber(vatAmount)) {
    const expectedVat = roundMoney(billSubtotal * VAT_RATE);
    if (!near(expectedVat, vatAmount, BILL_TOLERANCE)) {
      bill.warnings.push('vat_mismatch');
    }
  }

  if (positiveNumber(billSubtotal) && positiveNumber(grandTotal)) {
    const expectedGrand = positiveNumber(vatAmount)
      ? roundMoney(billSubtotal + vatAmount)
      : roundMoney(billSubtotal * (1 + VAT_RATE));
    if (!near(expectedGrand, grandTotal, BILL_TOLERANCE)) {
      bill.warnings.push('grand_total_mismatch');
    }
  }

  return { rows, bill, rowFlags };
}

/** Apply validation flags onto parsed items (server-side enrichment). */
export function applyValidationToParsedBill(parsed: ParsedBill): ParsedBill {
  const validation = validateCmgBill(parsed);
  const items = (parsed.items || []).map((it, i) => ({
    ...it,
    needs_review: Boolean(it.needs_review) || validation.rowFlags[i],
  }));
  return { ...parsed, items, validation };
}
