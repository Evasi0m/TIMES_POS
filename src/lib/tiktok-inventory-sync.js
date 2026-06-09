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
  formatSaleMirrorToast,
  formatSaleVoidMirrorToast,
  formatMirrorSkipToast,
  mappingNeedsProductId,
  mappingRowFromTiktokSku,
  normalizeSyncOperation,
  pickCatalogSkuForMapping,
  shouldPersistTiktokMatch,
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
  formatSaleMirrorToast,
  formatSaleVoidMirrorToast,
  formatMirrorSkipToast,
  formatTikTokApiError,
  voidMirrorToastDurationMs,
  shouldPersistTiktokMatch,
  normalizeSyncOperation,
  mappingNeedsProductId,
  pickCatalogSkuForMapping,
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

/** Persist mapping after user picks TikTok SKU (manual + bulk ×10). */
export async function persistTiktokMatchMapping(productId, patch, { onPersisted } = {}) {
  if (!shouldPersistTiktokMatch(productId, patch)) return;
  await upsertTiktokInventoryMapping({
    productId,
    tiktokSku: patch.tiktok_sku,
    tiktokMapping: patch.tiktok_mapping,
  });
  await onPersisted?.(productId);
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

async function isTikTokMirrorAvailable() {
  try {
    const status = await getTikTokConnectionStatus();
    return status?.connected === true;
  } catch {
    return false;
  }
}

/** Mapped products with TikTok product id ready to mirror. */
function filterMirrorEligibleMappings(mappings) {
  return (mappings || []).filter(m => m?.product_id != null && m.tiktok_sku_id && m.tiktok_product_id);
}

/** Search TikTok catalog and pick SKU row for an incomplete mapping. */
async function healMappingProductId(m) {
  const query = (m.seller_sku || m.tiktok_product_name || '').trim();
  if (!query) return m;
  const skus = await searchTikTokCatalog(query, {
    variants: [m.seller_sku, m.tiktok_sku_id].filter(Boolean),
    maxPages: 3,
  });
  const match = pickCatalogSkuForMapping(m, skus);
  if (!match?.tiktok_product_id) return m;
  const healed = {
    ...m,
    tiktok_product_id: match.tiktok_product_id,
    warehouse_id: m.warehouse_id || match.warehouse_id || null,
    seller_sku: m.seller_sku || match.seller_sku,
    tiktok_product_name: m.tiktok_product_name || match.product_name,
  };
  await upsertTiktokInventoryMapping({ productId: m.product_id, tiktokMapping: healed });
  return healed;
}

/**
 * Auto-heal mappings missing tiktok_product_id before mirror.
 * @returns {{ mappings: object[], healed: number, failed: number }}
 */
export async function ensureMappingsReady(mappings) {
  const list = [...(mappings || [])];
  if (!list.length) return { mappings: [], healed: 0, failed: 0 };
  const needs = list.filter(mappingNeedsProductId);
  if (!needs.length) return { mappings: list, healed: 0, failed: 0 };

  let healed = 0;
  let failed = 0;
  const out = [];
  for (const m of list) {
    if (!mappingNeedsProductId(m)) {
      out.push(m);
      continue;
    }
    try {
      const fixed = await healMappingProductId(m);
      if (fixed.tiktok_product_id) {
        healed++;
        out.push(fixed);
      } else {
        failed++;
        out.push(m);
      }
    } catch {
      failed++;
      out.push(m);
    }
  }
  return { mappings: out, healed, failed };
}

/** Load mappings missing tiktok_product_id (admin backfill UI). */
export async function fetchIncompleteTikTokMappings(limit = 50) {
  const { data, error } = await sb.from('tiktok_product_mappings')
    .select('tiktok_sku_id, product_id, seller_sku, tiktok_product_name, tiktok_product_id, warehouse_id')
    .is('tiktok_product_id', null)
    .eq('sync_enabled', true)
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error) throw error;
  return data || [];
}

/**
 * Backfill tiktok_product_id for incomplete mappings via tiktok-products-search.
 * Works from the browser — no local Supabase CLI required.
 */
export async function backfillMissingTikTokProductIds({ limit = 50 } = {}) {
  const rows = await fetchIncompleteTikTokMappings(limit);
  return ensureMappingsReady(rows);
}

/** Re-sync sale mirror for a bill after mapping backfill (e.g. bill #127254). */
export async function resyncSaleMirrorBill({ saleOrderId, productIds, toast = null }) {
  return runSaleMirrorWithFeedback({
    toast,
    saleOrderId,
    productIds,
    syncOperation: 'sale',
  });
}

/** Resolve TikTok product/warehouse ids for manual link (TikTok matching UI). */
export async function resolveTikTokCatalogMatch({ sellerSku, tiktokSkuId }) {
  const query = (sellerSku || '').trim();
  if (!query && !tiktokSkuId) return null;
  const skus = await searchTikTokCatalog(query || String(tiktokSkuId), {
    variants: [sellerSku, tiktokSkuId].filter(Boolean),
    maxPages: 3,
  });
  return pickCatalogSkuForMapping({ tiktok_sku_id: tiktokSkuId, seller_sku: sellerSku }, skus);
}

function mirrorSkipReason(rawMappings, eligibleMappings, failedHeal) {
  if (!rawMappings.length) return 'no_mapping';
  if (!eligibleMappings.length) return 'incomplete_mapping';
  return null;
}

function pushMirrorSkipToast(toast, result) {
  const skip = formatMirrorSkipToast(result);
  if (skip && toast) {
    toast.push(skip.msg, skip.type, { durationMs: skip.type === 'error' ? 8000 : 6000 });
  }
}

/**
 * Mirror POS stock to TikTok after a sale (any channel).
 * Uses sale_order_id as receive_order_id ref in sync log.
 */
export async function mirrorStockAfterSale({
  saleOrderId,
  productIds,
  syncOperation = 'sale',
  mappings: preloadedMappings = null,
}) {
  const ids = [...new Set((productIds || []).filter(id => id != null))];
  if (!saleOrderId || !ids.length) return { results: [], skipped: true, targetCount: 0 };

  if (!(await isTikTokMirrorAvailable())) {
    return { results: [], skipped: true, targetCount: 0, reason: 'not_connected' };
  }

  const rawMappings = preloadedMappings ?? await fetchTikTokMappings(ids);
  const { mappings: readyMappings, healed, failed } = await ensureMappingsReady(rawMappings);
  const mappings = filterMirrorEligibleMappings(readyMappings);
  if (!mappings.length) {
    const stillIncomplete = readyMappings.filter(mappingNeedsProductId).length + failed;
    return {
      results: [],
      skipped: true,
      targetCount: 0,
      reason: mirrorSkipReason(rawMappings, mappings, failed),
      incompleteCount: stillIncomplete,
      healed,
    };
  }

  const stocks = await fetchPosStocks(mappings.map(m => m.product_id));
  const mirrorPayload = mappings.map(m => buildSyncLine({
    saleOrderId,
    productId: m.product_id,
    posStockAfter: stocks[m.product_id]?.current_stock ?? 0,
    mapping: m,
    syncOperation,
  }));
  const results = await mirrorStockToTikTok(mirrorPayload);
  return { results, skipped: false, targetCount: mappings.length };
}

/** Products eligible for sale void mirror (prior successful sale sync). */
export async function fetchSaleVoidMirrorTargets(saleOrderId, productIds = null) {
  const { data, error } = await sb.rpc('get_tiktok_sale_mirror_targets', {
    p_sale_order_id: saleOrderId,
    p_product_ids: productIds?.length ? productIds : null,
  });
  if (error) throw error;
  return data || [];
}

/** Mirror after voiding a sale bill — only SKUs previously sale-mirrored. */
export async function mirrorStockAfterSaleVoid({
  saleOrderId, productIds = null, targets: preloadedTargets = null,
}) {
  const targets = preloadedTargets ?? await fetchSaleVoidMirrorTargets(saleOrderId, productIds);
  if (!targets.length) return { results: [], skipped: true, targetCount: 0 };

  if (!(await isTikTokMirrorAvailable())) {
    return { results: [], skipped: true, targetCount: 0, reason: 'not_connected' };
  }

  const stocks = await fetchPosStocks(targets.map(t => t.product_id));
  const mirrorPayload = targets.map(t => buildSyncLine({
    saleOrderId,
    productId: t.product_id,
    posStockAfter: stocks[t.product_id]?.current_stock ?? 0,
    mapping: t,
    syncOperation: 'sale_void',
  }));
  const results = await mirrorStockToTikTok(mirrorPayload);
  return { results, skipped: false, targetCount: targets.length };
}

/**
 * Sale mirror with optional toast feedback (non-blocking for checkout).
 */
export async function runSaleMirrorWithFeedback({
  toast,
  saleOrderId,
  productIds,
  syncOperation = 'sale',
  labelFormatter = formatSaleMirrorToast,
}) {
  const ids = [...new Set((productIds || []).filter(id => id != null))];
  if (!saleOrderId || !ids.length) return { results: [], skipped: true, targetCount: 0 };

  const count = ids.length;
  if (count >= 2 && toast) {
    toast.push(formatVoidMirrorProgressToast(count), 'info', {
      durationMs: voidMirrorToastDurationMs(count),
    });
  }

  try {
    const result = await mirrorStockAfterSale({
      saleOrderId,
      productIds: ids,
      syncOperation,
    });
    const { results, skipped, targetCount, reason } = result;
    if (skipped && toast) {
      pushMirrorSkipToast(toast, result);
    } else if (!skipped && toast) {
      const { msg, isError } = labelFormatter(results);
      toast.push(msg, isError ? 'error' : 'success', {
        durationMs: voidMirrorToastDurationMs(targetCount || count, { isError }),
      });
    }
    return { results, skipped, targetCount, reason };
  } catch (e) {
    if (toast) {
      toast.push('TikTok sale mirror: ' + formatTikTokApiError(e?.message || e), 'error', {
        durationMs: 8000,
      });
    }
    return { results: [], skipped: true, targetCount: 0, error: e };
  }
}

/** Void sale mirror with toast feedback. */
export async function runSaleVoidMirrorWithFeedback({ toast, saleOrderId, productIds = null }) {
  const targets = await fetchSaleVoidMirrorTargets(saleOrderId, productIds);
  if (!targets.length) return { results: [], skipped: true, targetCount: 0 };

  const count = targets.length;
  if (count >= 2 && toast) {
    toast.push(formatVoidMirrorProgressToast(count), 'info', {
      durationMs: voidMirrorToastDurationMs(count),
    });
  }

  try {
    const { results, skipped, targetCount, reason } = await mirrorStockAfterSaleVoid({
      saleOrderId,
      productIds,
      targets,
    });
    if (skipped && toast) {
      if (reason === 'not_connected') {
        pushMirrorSkipToast(toast, { reason: 'not_connected' });
      }
    } else if (!skipped && toast) {
      const { msg, isError } = formatSaleVoidMirrorToast(results);
      toast.push(msg, isError ? 'error' : 'success', {
        durationMs: voidMirrorToastDurationMs(targetCount || count, { isError }),
      });
    }
    return { results, skipped, targetCount: targetCount || count };
  } catch (e) {
    if (toast) {
      toast.push('TikTok sale void mirror: ' + formatTikTokApiError(e?.message || e), 'error', {
        durationMs: 8000,
      });
    }
    return { results: [], skipped: true, targetCount: 0, error: e };
  }
}
