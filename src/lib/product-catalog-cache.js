// Session cache for the POS product catalog — ProductsView, TikTok matching,
// Bulk Receive. One bundle fetch per browser session unless invalidated.

import { fetchAllFromTable } from './sb-paginate.js';
import { findSkuCandidates } from './fuzzy-match.js';

export const PRODUCT_CATALOG_SELECT = 'id, name, barcode, retail_price, current_stock';

/** ProductsView list/filter/editor — all columns needed without select('*'). */
export const PRODUCT_LIST_SELECT =
  'id, name, barcode, retail_price, cost_price, current_stock, brand_id, category_id, created_at';

/** @typedef {{ products: object[], imageByProductId: Map<number, object> }} ProductListBundle */

/** @type {ProductListBundle | null} */
let _bundle = null;
/** @type {Promise<{ bundle: ProductListBundle | null, error: Error | null }> | null} */
let _loading = null;

function buildImageMap(imgs) {
  const map = new Map();
  for (const r of imgs || []) {
    if (r?.product_id && r.image_url) map.set(r.product_id, r);
  }
  return map;
}

async function fetchProductImages(sb) {
  const { data, error } = await sb
    .from('product_images')
    .select('product_id, image_url, status, updated_at')
    .eq('status', 'found');
  if (error) throw error;
  return data || [];
}

async function loadBundleFromNetwork(sb) {
  const [productsRes, imgs] = await Promise.all([
    fetchAllFromTable(sb, 'products', {
      select: PRODUCT_LIST_SELECT,
      orderColumn: 'id',
      ascending: true,
    }),
    fetchProductImages(sb).catch(() => []),
  ]);

  if (productsRes.error) {
    return { bundle: null, error: productsRes.error };
  }

  const bundle = {
    products: productsRes.data || [],
    imageByProductId: buildImageMap(imgs),
  };
  return { bundle, error: null };
}

/**
 * Full catalog bundle (products + images).
 * Cached for the browser session; dedupes concurrent in-flight loads.
 *
 * @returns {Promise<{ bundle: ProductListBundle | null, error: Error | null, fromCache: boolean }>}
 */
export async function getProductListBundle(sb, { force = false } = {}) {
  if (!force && _bundle) {
    return { bundle: _bundle, error: null, fromCache: true };
  }
  if (!force && _loading) {
    const res = await _loading;
    return { ...res, fromCache: false };
  }

  _loading = loadBundleFromNetwork(sb).then((res) => {
    _loading = null;
    if (res.error) return res;
    _bundle = res.bundle;
    return res;
  });

  const res = await _loading;
  return { ...res, fromCache: false };
}

/** Narrow catalog for TikTok SKU matching — shares the list bundle. */
export async function getProductCatalog(sb, { force = false } = {}) {
  const { bundle, error } = await getProductListBundle(sb, { force });
  if (error) return { data: bundle?.products || [], error };
  return { data: bundle?.products || [], error: null };
}

/** Narrow server search when full catalog is unavailable — enough for SKU matching. */
export async function fetchSkuPrefilter(sb, skuKey) {
  const key = (skuKey || '').trim();
  if (!key || key.length < 3) return [];

  const parts = key.split('-').filter(Boolean);
  const core = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : parts[0];

  const { data, error } = await sb.from('products')
    .select(PRODUCT_CATALOG_SELECT)
    .ilike('name', `%${core}%`)
    .limit(40);

  if (error || !data?.length) return [];
  return findSkuCandidates(key, data, { limit: 8, minScore: 0.5 });
}

/** Realtime stock-only patch — keeps cache aligned without a full refetch. */
export function patchProductStockInCache(productId, currentStock) {
  if (!_bundle || productId == null) return;
  const row = _bundle.products.find((p) => p.id === productId);
  if (row) row.current_stock = currentStock;
}

/** Clear cache (e.g. after bulk product import or catalog edit). */
export function invalidateProductCatalogCache() {
  _bundle = null;
  _loading = null;
}

/** @internal Test-only reset */
export function _resetProductCatalogCacheForTests() {
  invalidateProductCatalogCache();
}
