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
  formatReturnMirrorToast,
  formatReturnVoidMirrorToast,
  formatMirrorSkipToast,
  logMirrorBackgroundError,
  mappingNeedsProductId,
  mappingRowFromTiktokSku,
  normalizeSyncOperation,
  pickCatalogSkuForMapping,
  shouldPersistTiktokMatch,
  tiktokSkuImageUrl,
  voidMirrorToastDurationMs,
} from './tiktok-mirror-helpers.js';
import { filterTikTokSkusByTerm, posSkuSearchVariants } from './tiktok-receive-match.js';

export {
  buildSyncLine,
  isTikTokLineReady,
  countTikTokMirrorReady,
  formatMirrorToast,
  formatVoidMirrorProgressToast,
  formatVoidMirrorToast,
  formatSaleMirrorToast,
  formatSaleVoidMirrorToast,
  formatReturnMirrorToast,
  formatReturnVoidMirrorToast,
  formatMirrorSkipToast,
  formatTikTokApiError,
  logMirrorBackgroundError,
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

/** Load saved mappings by TikTok SKU id (confirm panel pre-fill). */
export async function fetchTikTokMappingsBySkuIds(tiktokSkuIds) {
  const ids = [...new Set((tiktokSkuIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  const { data, error } = await sb
    .from('tiktok_product_mappings')
    .select('tiktok_sku_id, product_id, seller_sku, tiktok_product_name, tiktok_product_id, warehouse_id')
    .in('tiktok_sku_id', ids);
  if (error) throw error;
  return data || [];
}

/** Persist mapping from TikTok confirm "ยืนยันการจับคู่" (keyed by tiktok_sku_id). */
export async function persistTiktokConfirmMapping(item, pick) {
  if (!item?.tiktok_sku_id || !pick?.id) return;
  const seller = (item.seller_sku || '').trim();
  const generic = !seller || ['DEFAULT', 'STANDARD', '—'].includes(seller.toUpperCase());
  await upsertTiktokInventoryMapping({
    productId: pick.id,
    tiktokMapping: {
      tiktok_sku_id: String(item.tiktok_sku_id),
      seller_sku: generic ? null : seller,
      tiktok_product_name: item.product_name || item.sku_name || null,
      image_url: item.sku_image_url || null,
    },
  });
}

function buildTiktokMappingPayload(productId, { tiktokSku, tiktokMapping } = {}) {
  const fromSku = tiktokSku ? mappingRowFromTiktokSku(tiktokSku, productId) : null;
  const m = { ...(fromSku || {}), ...(tiktokMapping || {}) };
  const imageUrl = tiktokSkuImageUrl(tiktokSku) || tiktokSkuImageUrl(tiktokMapping) || tiktokSkuImageUrl(fromSku);
  if (imageUrl) m.image_url = imageUrl;
  return m;
}

/** Persist POS product ↔ TikTok SKU mapping (receive match confirm). */
export async function upsertTiktokInventoryMapping({ productId, tiktokSku, tiktokMapping }) {
  if (productId == null) return;
  const m = buildTiktokMappingPayload(productId, { tiktokSku, tiktokMapping });
  if (!m?.tiktok_sku_id) return;
  const { error } = await sb.rpc('upsert_tiktok_inventory_mapping', {
    p_tiktok_sku_id: String(m.tiktok_sku_id),
    p_product_id: productId,
    p_tiktok_product_id: m.tiktok_product_id || null,
    p_seller_sku: m.seller_sku || null,
    p_tiktok_product_name: m.tiktok_product_name || null,
    p_warehouse_id: m.warehouse_id || null,
    p_image_url: tiktokSkuImageUrl(m),
  });
  if (error) throw error;
  return { hadImage: !!tiktokSkuImageUrl(m) };
}

/** Fetch product_images from TikTok Product Detail API (mapped SKUs missing photos). */
export async function syncTikTokProductImages({ productIds, limit = 50 } = {}) {
  const ids = [...new Set((productIds || []).filter(id => id != null))];
  if (!ids.length) return { synced: 0, no_image: 0, errors: 0, checked: 0 };
  const data = await invokeTikTokFunction('tiktok-product-image-backfill', {
    product_ids: ids,
    limit: Math.min(Math.max(limit, ids.length), 200),
  });
  if (!data?.ok) throw new Error(data?.error || 'TikTok catalog image sync failed');
  return data;
}

/** Persist mapping after user picks TikTok SKU (manual + bulk ×10). */
export async function persistTiktokMatchMapping(productId, patch, { onPersisted, syncImage = true } = {}) {
  if (!shouldPersistTiktokMatch(productId, patch)) return;
  const { hadImage } = await upsertTiktokInventoryMapping({
    productId,
    tiktokSku: patch.tiktok_sku,
    tiktokMapping: patch.tiktok_mapping,
  }) || {};
  if (syncImage && !hadImage) {
    syncTikTokProductImages({ productIds: [productId], limit: 5 }).catch((e) => {
      console.warn('[TikTok match] catalog image sync failed:', e?.message || e);
    });
  }
  await onPersisted?.(productId);
}

export async function searchTikTokCatalog(query, {
  variants = [], maxPages = 5, skipClientFilter = false,
} = {}) {
  const q = (query || '').trim();
  const data = await invokeTikTokFunction('tiktok-products-search', {
    query: q,
    query_variants: variants,
    page_size: 50,
    max_pages: maxPages,
  });
  const skus = data.skus || [];
  if (!q || skipClientFilter) return skus;
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
const MIRROR_BATCH_SIZE = 30;

export async function mirrorStockToTikTok(items) {
  const list = items || [];
  if (!list.length) return [];
  const allResults = [];
  for (let i = 0; i < list.length; i += MIRROR_BATCH_SIZE) {
    const chunk = list.slice(i, i + MIRROR_BATCH_SIZE);
    const data = await invokeTikTokFunction('tiktok-inventory-update', { items: chunk });
    allResults.push(...(data.results || []));
  }
  return allResults;
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
    return status?.connected === true && status?.token_expired !== true;
  } catch {
    return false;
  }
}

/** Mapped products with TikTok product id ready to mirror. */
function filterMirrorEligibleMappings(mappings) {
  return (mappings || []).filter(m => m?.product_id != null && m.tiktok_sku_id && m.tiktok_product_id);
}

/** Load full active TikTok catalog (paginated). TikTok's keyword/seller_sku search
 *  ignores filters and returns the same first page — match locally instead. */
export async function fetchFullTikTokCatalog(maxPages = 10) {
  return searchTikTokCatalog('', { maxPages, skipClientFilter: true });
}

function applyHealedMapping(m, match) {
  return {
    ...m,
    tiktok_product_id: match.tiktok_product_id,
    warehouse_id: m.warehouse_id || match.warehouse_id || null,
    seller_sku: m.seller_sku || match.seller_sku,
    tiktok_product_name: m.tiktok_product_name || match.product_name,
    ...(tiktokSkuImageUrl(match) ? { image_url: tiktokSkuImageUrl(match) } : {}),
  };
}

/** Search TikTok catalog and pick SKU row for an incomplete mapping. */
async function healMappingProductId(m, catalog = null) {
  const persistHealed = async (healed) => {
    const { hadImage } = await upsertTiktokInventoryMapping({
      productId: m.product_id,
      tiktokMapping: healed,
    }) || {};
    if (!hadImage) {
      syncTikTokProductImages({ productIds: [m.product_id], limit: 1 }).catch((e) => {
        console.warn('[TikTok heal] catalog image sync failed:', e?.message || e);
      });
    }
    return healed;
  };

  if (catalog?.length) {
    const match = pickCatalogSkuForMapping(m, catalog);
    if (match?.tiktok_product_id) {
      return persistHealed(applyHealedMapping(m, match));
    }
  }

  const baseVariants = [m.seller_sku, m.tiktok_sku_id].filter(Boolean);
  const queries = [
    ...baseVariants,
    ...posSkuSearchVariants({ barcode: m.seller_sku, name: m.tiktok_product_name }, 8),
  ].map(q => String(q || '').trim()).filter(q => q.length >= 2);
  const seenQ = new Set();
  const uniqueQueries = queries.filter(q => {
    if (seenQ.has(q)) return false;
    seenQ.add(q);
    return true;
  });
  if (!uniqueQueries.length) return m;

  for (const query of uniqueQueries) {
    const skus = await searchTikTokCatalog(query, {
      variants: uniqueQueries,
      maxPages: 10,
      skipClientFilter: !!m.tiktok_sku_id,
    });
    const match = pickCatalogSkuForMapping(m, skus);
    if (!match?.tiktok_product_id) continue;
    return persistHealed(applyHealedMapping(m, match));
  }
  return m;
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
  let catalog = null;
  try {
    catalog = await fetchFullTikTokCatalog(10);
  } catch { /* fall back to per-item search in healMappingProductId */ }

  const out = [];
  for (const m of list) {
    if (!mappingNeedsProductId(m)) {
      out.push(m);
      continue;
    }
    try {
      const fixed = await healMappingProductId(m, catalog);
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

/** Backfill product_images from order lines, then TikTok Product Detail API. */
export async function backfillTikTokProductImages({ limit = 150 } = {}) {
  const { data: fromOrders, error } = await sb.rpc('backfill_tiktok_product_images');
  if (error) throw error;
  const orderResult = fromOrders || { synced: 0, skipped: 0, no_image: 0 };

  const catalogData = await invokeTikTokFunction('tiktok-product-image-backfill', {
    limit: Math.min(Math.max(limit, 1), 200),
  });
  if (!catalogData?.ok) {
    throw new Error(catalogData?.error || 'TikTok catalog image backfill failed');
  }

  return {
    synced: (orderResult.synced || 0) + (catalogData.synced || 0),
    skipped: orderResult.skipped || 0,
    no_image: catalogData.no_image ?? orderResult.no_image ?? 0,
    from_orders: orderResult.synced || 0,
    from_catalog: catalogData.synced || 0,
    errors: catalogData.errors || 0,
    checked: catalogData.checked || 0,
  };
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

/** Bills with mapping ready but no successful sale mirror log (admin resync). */
export async function fetchBillsNeedingSaleMirrorResync(limit = 20) {
  const { data, error } = await sb.rpc('get_bills_needing_sale_mirror_resync', {
    p_limit: Math.min(Math.max(limit, 1), 50),
  });
  if (error) throw error;
  return data || [];
}

/** Re-sync all pending sale mirrors after mapping backfill. */
export async function resyncPendingSaleMirrors({ toast = null, limit = 20 } = {}) {
  const rows = await fetchBillsNeedingSaleMirrorResync(limit);
  if (!rows.length) return { synced: 0, bills: [] };

  const byBill = new Map();
  for (const row of rows) {
    if (!byBill.has(row.sale_order_id)) byBill.set(row.sale_order_id, []);
    byBill.get(row.sale_order_id).push(row.product_id);
  }

  let synced = 0;
  for (const [saleOrderId, productIds] of byBill) {
    const result = await runSaleMirrorWithFeedback({
      toast,
      saleOrderId,
      productIds: [...new Set(productIds)],
      syncOperation: 'sale',
    });
    if (!result.skipped && result.results?.some(r => r.status === 'success')) synced++;
  }
  return { synced, bills: [...byBill.keys()] };
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

function pushMirrorSkipToast(toast, result, { context = 'sale' } = {}) {
  const skip = formatMirrorSkipToast({ ...result, context });
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
  const rawTargets = preloadedTargets ?? await fetchSaleVoidMirrorTargets(saleOrderId, productIds);
  if (!rawTargets.length) {
    return { results: [], skipped: true, targetCount: 0, reason: 'void_no_target' };
  }

  if (!(await isTikTokMirrorAvailable())) {
    return { results: [], skipped: true, targetCount: 0, reason: 'not_connected' };
  }

  const { mappings: readyTargets } = await ensureMappingsReady(rawTargets);
  const targets = filterMirrorEligibleMappings(readyTargets);
  if (!targets.length) {
    return {
      results: [],
      skipped: true,
      targetCount: 0,
      reason: 'incomplete_mapping',
    };
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

/** Mirror POS stock after customer return (goods returned). */
export async function mirrorStockAfterGoodsReturn({
  returnOrderId, productIds,
}) {
  const ids = [...new Set((productIds || []).filter(id => id != null))];
  if (!returnOrderId || !ids.length) return { results: [], skipped: true, targetCount: 0 };

  if (!(await isTikTokMirrorAvailable())) {
    return { results: [], skipped: true, targetCount: 0, reason: 'not_connected' };
  }

  const rawMappings = await fetchTikTokMappings(ids);
  const { mappings: readyMappings } = await ensureMappingsReady(rawMappings);
  const mappings = filterMirrorEligibleMappings(readyMappings);
  if (!mappings.length) {
    return {
      results: [],
      skipped: true,
      targetCount: 0,
      reason: mirrorSkipReason(rawMappings, mappings, 0),
    };
  }

  const stocks = await fetchPosStocks(mappings.map(m => m.product_id));
  const mirrorPayload = mappings.map(m => buildSyncLine({
    receiveOrderId: returnOrderId,
    productId: m.product_id,
    posStockAfter: stocks[m.product_id]?.current_stock ?? 0,
    mapping: m,
    syncOperation: 'return',
  }));
  const results = await mirrorStockToTikTok(mirrorPayload);
  return { results, skipped: false, targetCount: mappings.length };
}

/** Products eligible for return void mirror (prior successful return sync). */
export async function fetchReturnVoidMirrorTargets(returnOrderId, productIds = null) {
  const { data, error } = await sb.rpc('get_tiktok_return_void_mirror_targets', {
    p_return_order_id: returnOrderId,
    p_product_ids: productIds?.length ? productIds : null,
  });
  if (error) throw error;
  return data || [];
}

/** Mirror after voiding a customer return — only SKUs previously return-mirrored. */
export async function mirrorStockAfterReturnVoid({
  returnOrderId, productIds = null, targets: preloadedTargets = null,
}) {
  const rawTargets = preloadedTargets ?? await fetchReturnVoidMirrorTargets(returnOrderId, productIds);
  if (!rawTargets.length) {
    return { results: [], skipped: true, targetCount: 0, reason: 'return_void_no_target' };
  }

  if (!(await isTikTokMirrorAvailable())) {
    return { results: [], skipped: true, targetCount: 0, reason: 'not_connected' };
  }

  const { mappings: readyTargets } = await ensureMappingsReady(rawTargets);
  const targets = filterMirrorEligibleMappings(readyTargets);
  if (!targets.length) {
    return {
      results: [],
      skipped: true,
      targetCount: 0,
      reason: 'incomplete_mapping',
    };
  }

  const stocks = await fetchPosStocks(targets.map(t => t.product_id));
  const mirrorPayload = targets.map(t => buildSyncLine({
    receiveOrderId: returnOrderId,
    productId: t.product_id,
    posStockAfter: stocks[t.product_id]?.current_stock ?? 0,
    mapping: t,
    syncOperation: 'return_void',
  }));
  const results = await mirrorStockToTikTok(mirrorPayload);
  return { results, skipped: false, targetCount: targets.length };
}

/** Customer return mirror with toast feedback. */
export async function runReturnMirrorWithFeedback({ toast, returnOrderId, productIds }) {
  const ids = [...new Set((productIds || []).filter(id => id != null))];
  if (!returnOrderId || !ids.length) return { results: [], skipped: true, targetCount: 0 };

  const count = ids.length;
  if (count >= 2 && toast) {
    toast.push(formatVoidMirrorProgressToast(count), 'info', {
      durationMs: voidMirrorToastDurationMs(count),
    });
  }

  try {
    const result = await mirrorStockAfterGoodsReturn({ returnOrderId, productIds: ids });
    const { results, skipped, targetCount, reason } = result;
    if (skipped && toast) {
      pushMirrorSkipToast(toast, result, { context: 'return' });
    } else if (!skipped && toast) {
      const { msg, isError } = formatReturnMirrorToast(results);
      toast.push(msg, isError ? 'error' : 'success', {
        durationMs: voidMirrorToastDurationMs(targetCount || count, { isError }),
      });
    }
    return { results, skipped, targetCount, reason };
  } catch (e) {
    if (toast) {
      toast.push('TikTok return mirror: ' + formatTikTokApiError(e?.message || e), 'error', {
        durationMs: 8000,
      });
    }
    return { results: [], skipped: true, targetCount: 0, error: e };
  }
}

/** Void customer return mirror with toast feedback. */
export async function runReturnVoidMirrorWithFeedback({ toast, returnOrderId, productIds = null }) {
  const targets = await fetchReturnVoidMirrorTargets(returnOrderId, productIds);
  if (!targets.length) {
    if (toast) pushMirrorSkipToast(toast, { reason: 'return_void_no_target' }, { context: 'return' });
    return { results: [], skipped: true, targetCount: 0, reason: 'return_void_no_target' };
  }

  const count = targets.length;
  if (count >= 2 && toast) {
    toast.push(formatVoidMirrorProgressToast(count), 'info', {
      durationMs: voidMirrorToastDurationMs(count),
    });
  }

  try {
    const { results, skipped, targetCount, reason } = await mirrorStockAfterReturnVoid({
      returnOrderId,
      productIds,
      targets,
    });
    if (skipped && toast) {
      pushMirrorSkipToast(toast, { reason: reason || 'return_void_no_target' }, { context: 'return' });
    } else if (!skipped && toast) {
      const { msg, isError } = formatReturnVoidMirrorToast(results);
      toast.push(msg, isError ? 'error' : 'success', {
        durationMs: voidMirrorToastDurationMs(targetCount || count, { isError }),
      });
    }
    return { results, skipped, targetCount: targetCount || count };
  } catch (e) {
    if (toast) {
      toast.push('TikTok return void mirror: ' + formatTikTokApiError(e?.message || e), 'error', {
        durationMs: 8000,
      });
    }
    return { results: [], skipped: true, targetCount: 0, error: e };
  }
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
  if (!targets.length) {
    if (toast) pushMirrorSkipToast(toast, { reason: 'void_no_target' });
    return { results: [], skipped: true, targetCount: 0, reason: 'void_no_target' };
  }

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
      pushMirrorSkipToast(toast, { reason: reason || 'void_no_target' });
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
