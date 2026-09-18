import { classifyMatch, findProductByBarcode, normalizeCode } from './fuzzy-match.js';
import { validateCmgBill, ROW_TOLERANCE } from './cmg-bill-validate.js';
import { roundMoney } from './money.js';
import { SOFT_MATCH_FLOOR } from '../components/ai/bill-review-shared.js';

let _rowUidCounter = 0;
export function makeRowUid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  _rowUidCounter += 1;
  return `r${Date.now().toString(36)}${_rowUidCounter}`;
}

export function buildRowFromAi(it, catalog, opts = {}) {
  const {
    forceReview = false,
    validationIssues = [],
    validationDetail = null,
  } = opts;
  const barcode = String(it.barcode || '').trim();
  const byBarcode = findProductByBarcode(barcode, catalog || []);
  const match = byBarcode
    ? { status: 'auto', product: byBarcode, score: 1, candidates: [] }
    : classifyMatch(it.model_code, catalog || []);
  return {
    uid: makeRowUid(),
    model_code: it.model_code,
    barcode: barcode || null,
    quantity: Math.max(0, Math.round(Number(it.quantity) || 0)),
    unit_cost: Math.max(0, Number(it.unit_cost) || 0),
    line_amount: Math.max(0, Number(it.line_amount) || 0),
    needsReview: Boolean(it.needs_review) || forceReview,
    reviewConfirmed: false,
    validationIssues: Array.isArray(validationIssues) ? validationIssues : [],
    validationDetail: validationDetail || null,
    status: match.status,
    product: match.product || null,
    matchScore: typeof match.score === 'number' ? match.score : null,
    candidates: match.candidates || [],
    newProduct: null,
    tiktok_skip: false,
    tiktok_sku: null,
    tiktok_mapping: null,
  };
}

/** Merge AI duplicate lines (same model_code + same unit cost) into one row. */
export function mergeDuplicateModelRows(rows) {
  const out = [];
  const byCode = new Map();
  for (const row of rows || []) {
    const code = normalizeCode(row.model_code);
    if (!code) {
      out.push(row);
      continue;
    }
    const prev = byCode.get(code);
    if (!prev) {
      byCode.set(code, row);
      out.push(row);
      continue;
    }
    const sameCost = Math.abs(roundMoney(prev.unit_cost) - roundMoney(row.unit_cost)) <= ROW_TOLERANCE;
    if (!sameCost) {
      out.push(row);
      continue;
    }
    prev.quantity = Math.max(0, Math.round(Number(prev.quantity) || 0))
      + Math.max(0, Math.round(Number(row.quantity) || 0));
    prev.line_amount = roundMoney(Number(prev.line_amount) + Number(row.line_amount));
    prev.needsReview = Boolean(prev.needsReview || row.needsReview);
  }
  return out;
}

/** Apply arithmetic validation and build review rows from a parsed bill. */
export function materializeParsedBill(parsed, catalog) {
  const validation = validateCmgBill(parsed);
  const itemsRaw = Array.isArray(parsed?.items) ? parsed.items : [];
  const rows = mergeDuplicateModelRows(itemsRaw.map((it, j) => {
    const rowResult = validation.rows.find((r) => r.index === j);
    return buildRowFromAi(it, catalog, {
      forceReview: Boolean(validation.rowFlags[j]),
      validationIssues: rowResult?.issues || [],
      validationDetail: rowResult?.detail || null,
    });
  }));
  return {
    rows,
    validation,
    bill_subtotal: Number(parsed?.bill_subtotal) || 0,
    total_qty: Math.max(0, Math.round(Number(parsed?.total_qty) || 0)),
    vat_amount: Number(parsed?.vat_amount) || 0,
    grand_total: Number(parsed?.grand_total) || 0,
  };
}

/**
 * JSON import materialize  trust validated import rows when auto-matched strongly.
 * Sets footerConfirmed when footer validation is clean.
 */
export function materializeJsonBill(parsed, catalog) {
  const materialized = materializeParsedBill(parsed, catalog);
  const itemsRaw = Array.isArray(parsed?.items) ? parsed.items : [];

  const rows = materialized.rows.map((row, j) => {
    const src = itemsRaw[j];
    const importTrusted =
      !src?.needs_review &&
      row.status === 'auto' &&
      typeof row.matchScore === 'number' &&
      row.matchScore >= SOFT_MATCH_FLOOR &&
      !row.validationIssues?.length;

    if (importTrusted) {
      return { ...row, reviewConfirmed: true, needsReview: false };
    }
    return row;
  });

  const footerConfirmed = (materialized.validation?.bill?.warnings?.length || 0) === 0;

  return { ...materialized, rows, footerConfirmed };
}
