// CMG bill arithmetic validation — deterministic checks after AI parse.
// Compares qty × unit_cost vs line_amount and optional footer totals.

import { roundMoney } from './money.js';

export const ROW_TOLERANCE = 0.02;
export const BILL_TOLERANCE = 0.05;
export const VAT_RATE = 0.07;

/** Strip CMG distributor prefixes from model description text. */
export function stripCmgModelPrefix(code) {
  return String(code || '')
    .trim()
    .replace(/^(CE|CB)\s+/i, '');
}

function near(a, b, tolerance) {
  return Math.abs(roundMoney(a) - roundMoney(b)) <= tolerance;
}

function positiveNumber(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0;
}

/**
 * @param {object} parsed
 * @param {Array<{ model_code?, quantity?, unit_cost?, line_amount?, needs_review? }>} parsed.items
 * @param {number} [parsed.bill_subtotal]
 * @param {number} [parsed.total_qty]
 * @param {number} [parsed.vat_amount]
 * @param {number} [parsed.grand_total]
 * @returns {{
 *   rows: Array<{ index: number, issues: string[], detail?: string }>,
 *   bill: { issues: string[], warnings: string[] },
 *   rowFlags: boolean[],
 * }}
 */
export function validateCmgBill(parsed) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const rows = [];
  const rowFlags = items.map(() => false);
  const bill = { issues: [], warnings: [] };

  let sumLineAmount = 0;
  let sumQty = 0;
  let hasLineAmounts = false;

  items.forEach((it, index) => {
    const qty = Math.max(0, Math.round(Number(it?.quantity) || 0));
    const unitCost = Math.max(0, Number(it?.unit_cost) || 0);
    const lineAmount = Number(it?.line_amount) || 0;
    const issues = [];

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

/** Human-readable summary for parse activity log. */
export function formatValidationSummary(validation) {
  if (!validation) return null;
  const rowCount = validation.rows?.length || 0;
  const billCount = validation.bill?.warnings?.length || 0;
  if (rowCount === 0 && billCount === 0) return '???????: ??????????';
  const parts = [];
  if (rowCount > 0) parts.push(`${rowCount} ????????????`);
  if (billCount > 0) parts.push(`${billCount} ??? footer ??????`);
  return `???????: ${parts.join(', ')}`;
}
