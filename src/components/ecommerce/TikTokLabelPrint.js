// TikTok shipping label fetch + PDF merge for bulk print.
import { PDFDocument } from 'pdf-lib';
import { sb } from '../../lib/supabase-client.js';

/**
 * Fetch official TikTok document URLs for sale orders.
 * documentType: SHIPPING_LABEL | PACKING_SLIP | SHIPPING_LABEL_AND_PACKING_SLIP
 */
export async function fetchShippingLabels(saleOrderIds, documentType = 'SHIPPING_LABEL', documentSize = 'A6') {
  const { data, error } = await sb.functions.invoke('tiktok-shipping-label', {
    body: { sale_order_ids: saleOrderIds, document_type: documentType, document_size: documentSize },
  });
  if (error) {
    let msg = error.message || 'label fetch failed';
    try {
      const ctx = await error.context?.json?.();
      if (ctx?.error) msg = ctx.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (data?.ok === false) throw new Error(data.error || 'label fetch failed');
  return data?.labels || [];
}

/** Open a single label PDF in a new tab for printing. */
export function printLabelUrl(docUrl) {
  const w = window.open(docUrl, '_blank');
  if (w) {
    w.addEventListener('load', () => {
      try { w.print(); } catch { /* cross-origin */ }
    });
  }
}

/** Merge multiple PDF URLs into one blob URL for bulk print. */
export async function mergeLabelPdfs(docUrls) {
  const merged = await PDFDocument.create();
  for (const url of docUrls) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`โหลด PDF ไม่ได้: ${url.slice(0, 60)}…`);
    const bytes = await res.arrayBuffer();
    const src = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }
  const out = await merged.save();
  const blob = new Blob([out], { type: 'application/pdf' });
  return URL.createObjectURL(blob);
}

/** Merge and open merged PDF for print. */
export async function printMergedLabels(docUrls) {
  if (!docUrls.length) throw new Error('ไม่มี label ที่พิมพ์ได้');
  const blobUrl = await mergeLabelPdfs(docUrls);
  const w = window.open(blobUrl, '_blank');
  if (w) {
    w.addEventListener('load', () => {
      try { w.print(); } catch { /* ignore */ }
    });
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 120_000);
}
