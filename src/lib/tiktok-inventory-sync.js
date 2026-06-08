// Client helpers — mirror POS stock → TikTok after receive.

import { sb } from './supabase-client.js';
import {
  buildSyncLine,
  formatTikTokApiError,
  isTikTokLineReady,
  countTikTokMirrorReady,
  formatMirrorToast,
  formatVoidMirrorProgressToast,
  formatVoidMirrorToast,
  mappingRowFromTiktokSku,
  voidMirrorToastDurationMs,
} from './tiktok-mirror-helpers.js';
import { filterTikTokSkusByTerm } from './tiktok-receive-match.js';

export {
  buildSyncLine,
  isTikTokLineReady,
  countTikTokMirrorReady,
  formatMirrorToast,
  formatVoidMirrorProgressToast,
  formatVoidMirrorToast,
  formatTikTokApiError,
  voidMirrorToastDurationMs,
};

/** Pull `{ error }` from supabase-js FunctionsHttpError (non-2xx body). */
export async function parseFunctionsInvokeError(error, fallback = 'เรียก Edge Function ไม่สำเร็จ') {
  let msg = error?.message || fallback;
  try {
    const ctx = await error?.context?.json?.();
    if (ctx?.error) msg = String(ctx.error);
  } catch { /* ignore */ }
  return formatTikTokApiError(msg);
}

async function invokeTikTokFunction(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) throw new Error(await parseFunctionsInvokeError(error));
  if (data?.ok === false) throw new Error(formatTikTokApiError(data.error || 'TikTok API failed'));
  return data;
}

export async function getTikTokConnectionStatus() {
  const { data, error } = await sb.rpc('get_tiktok_connection_status');
  if (error) throw error;
  return data || { connected: false };
}

export async function fetchTikTokMappings(productIds) {
  if (!productIds?.length) return [];
  const { data, error } = await sb.rpc('get_tiktok_mappings_for_products', {
    p_product_ids: productIds,
  });
  if (error) throw error;
  return data || [];
}

/** Persist POS product ↔ TikTok SKU mapping (receive match confirm). */
export async function upsertTiktokInventoryMapping({ productId, tiktokSku, tiktokMapping }) {
  if (productId == null) return;
  const m = tiktokMapping || (tiktokSku ? mappingRowFromTiktokSku(tiktokSku, productId) : null);
  if (!m?.tiktok_sku_id) return;
  const { error } = await sb.rpc('upsert_tiktok_inventory_mapping', {
    p_tiktok_sku_id: String(m.tiktok_sku_id),
    p_product_id: productId,
    p_tiktok_product_id: m.tiktok_product_id || null,
    p_seller_sku: m.seller_sku || null,
    p_tiktok_product_name: m.tiktok_product_name || null,
    p_warehouse_id: m.warehouse_id || null,
  });
  if (error) throw error;
}

export async function searchTikTokCatalog(query, { variants = [], maxPages = 5 } = {}) {
  const q = (query || '').trim();
  const data = await invokeTikTokFunction('tiktok-products-search', {
    query: q,
    query_variants: variants,
    page_size: 50,
    max_pages: maxPages,
  });
  const skus = data.skus || [];
  if (!q) return skus;
  return filterTikTokSkusByTerm(q, skus, { minScore: 0.55, limit: 50 });
}

export async function fetchPosStocks(productIds) {
  if (!productIds?.length) return {};
  const { data, error } = await sb.from('products')
    .select('id, name, barcode, current_stock')
    .in('id', productIds);
  if (error) throw error;
  const map = {};
  for (const p of data || []) map[p.id] = p;
  return map;
}

/**
 * Mirror POS stock to TikTok for receive lines.
 * @param {Array<{ receive_order_id, product_id, tiktok_product_id, tiktok_sku_id, warehouse_id, pos_stock_after, seller_sku, tiktok_product_name, skip }>} items
 */
export async function mirrorStockToTikTok(items) {
  const data = await invokeTikTokFunction('tiktok-inventory-update', { items });
  return data.results || [];
}

/** Products eligible for void mirror on a receive bill. */
export async function fetchVoidMirrorTargets(receiveOrderId, productIds = null) {
  const { data, error } = await sb.rpc('get_tiktok_void_mirror_targets', {
    p_receive_order_id: receiveOrderId,
    p_product_ids: productIds?.length ? productIds : null,
  });
  if (error) throw error;
  return data || [];
}

/**
 * Mirror POS stock to TikTok after voiding a receive bill or deleting a line.
 * Only products with a prior successful receive mirror are synced.
 */
export async function mirrorStockAfterReceiveVoid({
  receiveOrderId, productIds = null, targets: preloadedTargets = null,
}) {
  const targets = preloadedTargets ?? await fetchVoidMirrorTargets(receiveOrderId, productIds);
  if (!targets.length) return { results: [], skipped: true, targetCount: 0 };

  const stocks = await fetchPosStocks(targets.map(t => t.product_id));
  const mirrorPayload = targets.map(t => buildSyncLine({
    receiveOrderId,
    productId: t.product_id,
    posStockAfter: stocks[t.product_id]?.current_stock ?? 0,
    mapping: t,
    syncOperation: 'void',
  }));
  const results = await mirrorStockToTikTok(mirrorPayload);
  return { results, skipped: false, targetCount: targets.length };
}

/**
 * Void mirror with progress + summary toasts (multi-SKU UX).
 * @param {{ push: (msg: string, type?: string, opts?: { durationMs?: number }) => void }} toast
 */
export async function runVoidMirrorWithFeedback({ toast, receiveOrderId, productIds = null }) {
  const targets = await fetchVoidMirrorTargets(receiveOrderId, productIds);
  if (!targets.length) return { results: [], skipped: true, targetCount: 0 };

  const count = targets.length;
  if (count >= 2) {
    toast?.push(formatVoidMirrorProgressToast(count), 'info', {
      durationMs: voidMirrorToastDurationMs(count),
    });
  }

  const { results, skipped, targetCount } = await mirrorStockAfterReceiveVoid({
    receiveOrderId,
    productIds,
    targets,
  });

  if (!skipped) {
    const { msg, isError } = formatVoidMirrorToast(results);
    toast?.push(msg, isError ? 'error' : 'success', {
      durationMs: voidMirrorToastDurationMs(targetCount || count, { isError }),
    });
  }

  return { results, skipped, targetCount: targetCount || count };
}
