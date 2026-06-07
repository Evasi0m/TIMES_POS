// Pure VAT helpers for ภ.พ.30 reporting (VatView) and unit tests.
// Mirrors the inline logic that lived in main.jsx VatView — extracted so
// filing math is testable without mounting the full React app.

import { roundMoney, VAT_RATE_DEFAULT } from './money.js';

/**
 * Output VAT from a sale bill (grand_total is VAT-inclusive).
 * Uses stored vat_amount when present; otherwise extracts rate/107.
 */
export function vatFromGross(gross, vatAmount, vatRate = VAT_RATE_DEFAULT) {
  const g = Number(gross) || 0;
  const v = Number(vatAmount);
  if (Number.isFinite(v) && v > 0) return v;
  const rate = Number(vatRate);
  if (Number.isFinite(rate) && rate <= 0) return 0;
  const r = Number.isFinite(rate) && rate > 0 ? rate : VAT_RATE_DEFAULT;
  return g * r / (100 + r);
}

/**
 * Input VAT from a receive/claim bill.
 * total_value is always gross-inclusive in this codebase; vat_rate on the
 * header may be 0 (legacy toggle) so we default to 7/107 unless
 * vat_amount > 0 is stored explicitly (e.g. AI scan).
 */
export function inputVatFromGross(gross, vatAmount) {
  const v = Number(vatAmount);
  if (Number.isFinite(v) && v > 0) return v;
  const g = Number(gross) || 0;
  // Always 7/107 — header vat_rate may be 0 on legacy receives (see VatView).
  return g * VAT_RATE_DEFAULT / (100 + VAT_RATE_DEFAULT);
}

/** VAT portion of a customer return (return_orders has no vat columns). */
export function returnVatFromGross(gross) {
  const g = Number(gross) || 0;
  return g * VAT_RATE_DEFAULT / (100 + VAT_RATE_DEFAULT);
}

/** COGS VAT: cost_price snapshots are gross (VAT-inclusive). */
export function cogsVatFromGross(gross) {
  return (Number(gross) || 0) * VAT_RATE_DEFAULT / (100 + VAT_RATE_DEFAULT);
}

/**
 * Aggregate ภ.พ.30 figures from loaded row sets.
 * Row shapes match VatView's Supabase selects.
 */
export function computeVatAggregates({
  salesRows = [],
  recvRows = [],
  returnRows = [],
  claimRows = [],
  cogsRows = [],
}) {
  let outputTotalGross = 0;
  let outputTotalVat = 0;
  const outputByChannel = {};

  salesRows.forEach((r) => {
    const g = Number(r.grand_total) || 0;
    const vAmt = vatFromGross(g, r.vat_amount, r.vat_rate);
    outputTotalGross += g;
    outputTotalVat += vAmt;
    const k = r.channel || 'store';
    if (!outputByChannel[k]) outputByChannel[k] = { channel: k, gross: 0, vat: 0, count: 0 };
    outputByChannel[k].gross += g;
    outputByChannel[k].vat += vAmt;
    outputByChannel[k].count += 1;
  });

  let inputTotalGross = 0;
  let inputTotalVat = 0;
  const inputBySupplier = {};

  recvRows.forEach((r) => {
    const g = Number(r.total_value) || 0;
    const vAmt = inputVatFromGross(g, r.vat_amount);
    inputTotalGross += g;
    inputTotalVat += vAmt;
    const k = r.supplier_name || '— ไม่ระบุ —';
    if (!inputBySupplier[k]) inputBySupplier[k] = { supplier: k, gross: 0, vat: 0, count: 0 };
    inputBySupplier[k].gross += g;
    inputBySupplier[k].vat += vAmt;
    inputBySupplier[k].count += 1;
  });

  let cogsTotalGross = 0;
  cogsRows.forEach((it) => {
    const cost = Number(it.cost_price) || 0;
    const qty = Number(it.quantity) || 0;
    cogsTotalGross += cost * qty;
  });
  const cogsTotalVat = cogsVatFromGross(cogsTotalGross);

  let returnTotalGross = 0;
  let returnTotalVat = 0;
  returnRows.forEach((r) => {
    const g = Number(r.total_value) || 0;
    returnTotalGross += g;
    returnTotalVat += returnVatFromGross(g);
  });

  let claimTotalGross = 0;
  let claimTotalVat = 0;
  claimRows.forEach((r) => {
    const g = Number(r.total_value) || 0;
    claimTotalGross += g;
    claimTotalVat += inputVatFromGross(g, r.vat_amount);
  });

  const outputTotalVatNet = outputTotalVat - returnTotalVat;
  const outputTotalGrossNet = outputTotalGross - returnTotalGross;
  const inputTotalVatNet = inputTotalVat - claimTotalVat;
  const inputTotalGrossNet = inputTotalGross - claimTotalGross;

  const vatPayable = outputTotalVatNet - inputTotalVatNet;
  const vatPayableCogs = outputTotalVatNet - cogsTotalVat;
  const grossProfit = outputTotalGrossNet - cogsTotalGross;
  const netProfitAfterVat = grossProfit / 1.07;

  return {
    outputTotalGross,
    outputTotalVat,
    outputTotalGrossNet,
    outputTotalVatNet,
    outputByChannel: Object.values(outputByChannel).sort((a, b) => b.gross - a.gross),
    inputTotalGross,
    inputTotalVat,
    inputTotalGrossNet,
    inputTotalVatNet,
    inputBySupplier: Object.values(inputBySupplier).sort((a, b) => b.gross - a.gross),
    cogsTotalGross,
    cogsTotalVat,
    returnTotalGross,
    returnTotalVat,
    claimTotalGross,
    claimTotalVat,
    vatPayable,
    vatPayableCogs,
    grossProfit,
    netProfitAfterVat,
  };
}

/** Bills that count in totals but cannot be filed on ภ.พ.30 as-is. */
export function computeCompliance(salesRows = [], recvRows = []) {
  const salesNoTaxInvoice = salesRows.filter((r) => !r.tax_invoice_no);
  const recvNoSupplierTaxId = recvRows.filter((r) => !r.supplier_tax_id);
  const recvNoInvoiceNo = recvRows.filter((r) => !r.supplier_invoice_no);

  const sumVatSale = (rs) =>
    rs.reduce((s, r) => s + vatFromGross(Number(r.grand_total) || 0, r.vat_amount, r.vat_rate), 0);
  const sumVatRecv = (rs) =>
    rs.reduce((s, r) => s + inputVatFromGross(Number(r.total_value) || 0, r.vat_amount), 0);

  return {
    salesNoTaxInvoice: {
      count: salesNoTaxInvoice.length,
      gross: salesNoTaxInvoice.reduce((s, r) => s + (Number(r.grand_total) || 0), 0),
      vat: sumVatSale(salesNoTaxInvoice),
    },
    recvNoSupplierTaxId: {
      count: recvNoSupplierTaxId.length,
      gross: recvNoSupplierTaxId.reduce((s, r) => s + (Number(r.total_value) || 0), 0),
      vat: sumVatRecv(recvNoSupplierTaxId),
    },
    recvNoInvoiceNo: {
      count: recvNoInvoiceNo.length,
      gross: recvNoInvoiceNo.reduce((s, r) => s + (Number(r.total_value) || 0), 0),
      vat: sumVatRecv(recvNoInvoiceNo),
    },
  };
}

/** Label for a return row in the sales VAT CSV (credit note column). */
export function salesCreditNoteLabel(returnRow) {
  if (returnRow?.credit_note_no) return returnRow.credit_note_no;
  return `(ใบลดหนี้) RT#${returnRow?.id ?? '?'}`;
}
