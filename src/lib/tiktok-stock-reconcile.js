// TikTok ↔ POS stock reconciliation — scan & apply (API layer).

import { sb } from './supabase-client.js';
import { formatTikTokApiError } from './tiktok-mirror-helpers.js';

export {
  FILTER_TABS,
  partitionRows,
  filterRows,
  isRowApplicable,
  defaultSelectedIds,
  rowToApplyItem,
  buildApplyPreview,
  diffChipClass,
  formatDiff,
  sourceLabel,
  sourceHint,
  formatApplyToast,
} from './tiktok-stock-reconcile-helpers.js';

const APPLY_BATCH_SIZE = 10;

async function parseFunctionsInvokeError(error, fallback = 'เรียก Edge Function ไม่สำเร็จ') {
  let msg = error?.message || fallback;
  try {
    const ctx = await error?.context?.json?.();
    if (ctx?.error) msg = String(ctx.error);
  } catch { /* ignore */ }
  return formatTikTokApiError(msg);
}

async function invokeEdge(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) throw new Error(await parseFunctionsInvokeError(error));
  if (data?.ok === false) throw new Error(formatTikTokApiError(data.error || 'TikTok API failed'));
  return data;
}

/** Scan all mapped SKUs — compare POS vs TikTok live qty. */
export async function scanStockDiff() {
  return invokeEdge('tiktok-stock-compare', {});
}

/** Apply reconciliation for selected rows (batched). */
export async function applyStockReconcile({ source, items, batchId, onProgress }) {
  const bid = batchId || Date.now();
  const chunks = [];
  for (let i = 0; i < items.length; i += APPLY_BATCH_SIZE) {
    chunks.push(items.slice(i, i + APPLY_BATCH_SIZE));
  }

  const allResults = [];
  let done = 0;

  for (const chunk of chunks) {
    const data = await invokeEdge('tiktok-stock-reconcile-apply', {
      source,
      batch_id: bid,
      items: chunk,
    });
    allResults.push(...(data.results || []));
    done += chunk.length;
    onProgress?.({ done, total: items.length, batch: data });
  }

  const summary = {
    success: allResults.filter(r => r.status === 'success').length,
    skipped: allResults.filter(r => r.status === 'skipped').length,
    failed: allResults.filter(r => r.status === 'failed').length,
    total: allResults.length,
  };

  return { batchId: bid, results: allResults, summary };
}
