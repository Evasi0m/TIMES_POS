// CMG bill JSON import � parse + validate files from Gemini Gem before
// entering BulkReceiveView review (no AI / edge function).

import { roundMoney } from './money.js';
import { stripCmgModelPrefix, ROW_TOLERANCE } from './cmg-bill-validate.js';

export const MAX_IMPORT_BILLS = 10;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const BILL_FIELDS = [
  'is_cmg_bill',
  'supplier_invoice_no',
  'bill_subtotal',
  'total_qty',
  'vat_amount',
  'grand_total',
  'items',
];

const ITEM_FIELDS = [
  'model_code',
  'quantity',
  'unit_cost',
  'line_amount',
  'needs_review',
];

function near(a, b, tolerance) {
  return Math.abs(roundMoney(a) - roundMoney(b)) <= tolerance;
}

function billLabel(bill, index) {
  const inv = String(bill?.supplier_invoice_no || '').trim();
  return inv ? `\u0e1a\u0e34\u0e25 ${inv}` : `\u0e1a\u0e34\u0e25\u0e17\u0e35\u0e48 ${index + 1}`;
}

function coerceNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeItem(raw, billCtx, itemIndex, errors) {
  const billIndex = billCtx._index;
  if (!raw || typeof raw !== 'object') {
    errors.push(`${billLabel(billCtx, billIndex)} \u0e41\u0e16\u0e27 ${itemIndex + 1}: \u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e41\u0e16\u0e27\u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e15\u0e49\u0e2d\u0e07`);
    return null;
  }

  for (const key of ITEM_FIELDS) {
    if (!(key in raw)) {
      errors.push(`${billLabel(billCtx, billIndex)} \u0e41\u0e16\u0e27 ${itemIndex + 1}: \u0e02\u0e32\u0e14 field "${key}"`);
      return null;
    }
  }

  const model_code = stripCmgModelPrefix(String(raw.model_code || '').trim());
  if (!model_code) {
    errors.push(`${billLabel(billCtx, billIndex)} \u0e41\u0e16\u0e27 ${itemIndex + 1}: model_code \u0e27\u0e48\u0e32\u0e07`);
    return null;
  }

  const quantity = Math.max(0, Math.round(coerceNumber(raw.quantity)));
  const unit_cost = Math.max(0, coerceNumber(raw.unit_cost));
  const line_amount = coerceNumber(raw.line_amount);

  if (!Number.isFinite(unit_cost) || !Number.isFinite(line_amount)) {
    errors.push(`${billLabel(billCtx, billIndex)} \u0e41\u0e16\u0e27 ${itemIndex + 1}: \u0e23\u0e32\u0e04\u0e32\u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e15\u0e49\u0e2d\u0e07`);
    return null;
  }

  if (quantity <= 0) {
    errors.push(`${billLabel(billCtx, billIndex)} \u0e41\u0e16\u0e27 ${itemIndex + 1}: \u0e08\u0e33\u0e19\u0e27\u0e19\u0e15\u0e49\u0e2d\u0e07\u0e21\u0e32\u0e01\u0e01\u0e27\u0e48\u0e32 0`);
    return null;
  }

  const expectedLine = roundMoney(quantity * unit_cost);
  if (!near(expectedLine, line_amount, ROW_TOLERANCE)) {
    errors.push(
      `${billLabel(billCtx, billIndex)} \u0e41\u0e16\u0e27 ${itemIndex + 1} (${model_code}): ` +
      `qty\u00d7\u0e23\u0e32\u0e04\u0e32 = ${expectedLine} \u0e44\u0e21\u0e48\u0e15\u0e23\u0e07 line_amount ${roundMoney(line_amount)}`,
    );
    return null;
  }

  return {
    model_code,
    quantity,
    unit_cost: roundMoney(unit_cost),
    line_amount: roundMoney(line_amount),
    needs_review: Boolean(raw.needs_review),
  };
}

export function isLikelyJsonFile(file) {
  if (!file) return false;
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.json')) return true;
  const type = String(file.type || '').toLowerCase();
  return type === 'application/json' || type === 'text/json' || type === '';
}

function checkDuplicateInvoices(bills, errors) {
  const seen = new Map();
  bills.forEach((bill, i) => {
    const inv = String(bill.supplier_invoice_no || '').trim();
    if (!inv) return;
    if (seen.has(inv)) {
      errors.push(
        `?????? ${inv} ????????? (?????? ${seen.get(inv) + 1} ??? ${i + 1})`,
      );
    } else {
      seen.set(inv, i);
    }
  });
}

function normalizeBill(raw, index, errors) {
  if (!raw || typeof raw !== 'object') {
    errors.push(`\u0e1a\u0e34\u0e25\u0e17\u0e35\u0e48 ${index + 1}: \u0e02\u0e49\u0e2d\u0e21\u0e39\u0e25\u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e15\u0e49\u0e2d\u0e07`);
    return null;
  }

  for (const key of BILL_FIELDS) {
    if (!(key in raw)) {
      errors.push(`${billLabel(raw, index)}: \u0e02\u0e32\u0e14 field "${key}"`);
      return null;
    }
  }

  if (!raw.is_cmg_bill) {
    errors.push(`${billLabel(raw, index)}: \u0e44\u0e21\u0e48\u0e43\u0e08\u0e1a\u0e34\u0e25 CMG (is_cmg_bill \u0e15\u0e49\u0e2d\u0e07\u0e40\u0e1b\u0e47\u0e19 true)`);
    return null;
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    errors.push(`${billLabel(raw, index)}: \u0e44\u0e21\u0e48\u0e21\u0e35\u0e23\u0e32\u0e22\u0e01\u0e32\u0e23\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32`);
    return null;
  }

  const bill_subtotal = coerceNumber(raw.bill_subtotal);
  const total_qty = Math.max(0, Math.round(coerceNumber(raw.total_qty)));
  const vat_amount = coerceNumber(raw.vat_amount);
  const grand_total = coerceNumber(raw.grand_total);

  if (
    !Number.isFinite(bill_subtotal) ||
    !Number.isFinite(vat_amount) ||
    !Number.isFinite(grand_total)
  ) {
    errors.push(`${billLabel(raw, index)}: \u0e22\u0e2d\u0e14\u0e23\u0e27\u0e21/VAT \u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e15\u0e49\u0e2d\u0e07`);
    return null;
  }

  const billCtx = { ...raw, _index: index };
  const items = raw.items
    .map((it, j) => normalizeItem(it, billCtx, j, errors))
    .filter(Boolean);

  if (items.length !== raw.items.length) {
    return null;
  }

  return {
    is_cmg_bill: Boolean(raw.is_cmg_bill),
    supplier_invoice_no: String(raw.supplier_invoice_no ?? '').trim(),
    bill_subtotal: roundMoney(bill_subtotal),
    total_qty,
    vat_amount: roundMoney(vat_amount),
    grand_total: roundMoney(grand_total),
    items,
  };
}

/** Strip BOM and optional Gemini ```json fences from pasted text. */
export function normalizeImportText(text) {
  let s = String(text || '').replace(/^\uFEFF/, '').trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced) s = fenced[1].trim();
  return s;
}

/**
 * Parse and validate a CMG bill import JSON string.
 *
 * @param {string} text Raw file contents
 * @param {{ maxBytes?: number }} [opts]
 * @returns {{ ok: true, bills: object[] } | { ok: false, errors: string[] }}
 */
export function parseCmgBillImportFile(text, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_IMPORT_BYTES;
  const errors = [];

  const cleaned = normalizeImportText(text);
  if (typeof cleaned !== 'string' || !cleaned.trim()) {
    return { ok: false, errors: ['\u0e44\u0e1f\u0e25\u0e4c\u0e27\u0e48\u0e32\u0e07'] };
  }

  if (cleaned.length > maxBytes) {
    return {
      ok: false,
      errors: [`\u0e44\u0e1f\u0e25\u0e4c\u0e43\u0e2b\u0e0d\u0e48\u0e40\u0e01\u0e34\u0e19\u0e44\u0e1b \u2014 \u0e2a\u0e39\u0e07\u0e2a\u0e38\u0e14 ${Math.round(maxBytes / 1024)} KB`],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, errors: [`JSON \u0e44\u0e21\u0e48\u0e16\u0e39\u0e01\u0e15\u0e49\u0e2d\u0e07: ${e?.message || String(e)}`] };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['\u0e15\u0e49\u0e2d\u0e07\u0e40\u0e1b\u0e47\u0e19 JSON object \u0e17\u0e35\u0e48\u0e21\u0e35 "bills"'] };
  }

  if (!Array.isArray(parsed.bills)) {
    return { ok: false, errors: ['\u0e15\u0e49\u0e2d\u0e07\u0e21\u0e35 "bills" \u0e40\u0e1b\u0e47\u0e19 array'] };
  }

  if (parsed.bills.length === 0) {
    return { ok: false, errors: ['\u0e44\u0e21\u0e48\u0e21\u0e35\u0e1a\u0e34\u0e25\u0e43\u0e19\u0e44\u0e1f\u0e25\u0e4c'] };
  }

  if (parsed.bills.length > MAX_IMPORT_BILLS) {
    return {
      ok: false,
      errors: [`\u0e21\u0e35\u0e1a\u0e34\u0e25 ${parsed.bills.length} \u0e43\u0e1a \u2014 \u0e2a\u0e39\u0e07\u0e2a\u0e38\u0e14 ${MAX_IMPORT_BILLS} \u0e43\u0e1a/\u0e44\u0e1f\u0e25\u0e4c`],
    };
  }

  const bills = [];
  parsed.bills.forEach((raw, i) => {
    const bill = normalizeBill(raw, i, errors);
    if (bill) bills.push(bill);
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  checkDuplicateInvoices(bills, errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, bills };
}

/** Read a File/Blob as text and parse. */
export async function parseCmgBillImportBlob(file, opts) {
  if (!file) {
    return { ok: false, errors: ['\u0e44\u0e21\u0e48\u0e21\u0e35\u0e44\u0e1f\u0e25\u0e4c'] };
  }
  const size = Number(file.size) || 0;
  const maxBytes = opts?.maxBytes ?? MAX_IMPORT_BYTES;
  if (size > maxBytes) {
    return {
      ok: false,
      errors: [`\u0e44\u0e1f\u0e25\u0e4c\u0e43\u0e2b\u0e0d\u0e48\u0e40\u0e01\u0e34\u0e19\u0e44\u0e1b \u2014 \u0e2a\u0e39\u0e07\u0e2a\u0e38\u0e14 ${Math.round(maxBytes / 1024)} KB`],
    };
  }
  try {
    const text = await file.text();
    return parseCmgBillImportFile(text, opts);
  } catch (e) {
    return { ok: false, errors: [`\u0e2d\u0e48\u0e32\u0e19\u0e44\u0e1f\u0e25\u0e4c\u0e44\u0e21\u0e48\u0e44\u0e14\u0e49: ${e?.message || String(e)}`] };
  }
}
