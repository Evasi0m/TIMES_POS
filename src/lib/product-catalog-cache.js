// Session cache for the POS product catalog — used by TikTok confirm matching.
// Avoids re-fetching 6k+ rows every time the cashier opens an order.

import { fetchAllFromTable } from './sb-paginate.js';
import { findSkuCandidates } from './fuzzy-match.js';

export const PRODUCT_CATALOG_SELECT = 'id, name, barcode, retail_price, current_stock';

/** ProductsView list/filter/editor — all columns needed without select('*'). */
export const PRODUCT_LIST_SELECT =
  'id, name, barcode, retail_price, cost_price, current_stock, brand_id, category_id, created_at';

let _cache = null;
let _loading = null;

/** Full catalog fetch (paginated). Cached for the browser session. */
export async function getProductCatalog(sb, { force = false } = {}) {
  if (!force && _cache) return { data: _cache, error: null };
  if (!force && _loading) return _loading;

  _loading = fetchAllFromTable(sb, 'products', {
    select: PRODUCT_CATALOG_SELECT,
    orderColumn: 'id',
    ascending: true,
  }).then((res) => {
    _loading = null;
    if (res.error) return res;
    _cache = res.data || [];
    return { data: _cache, error: null };
  });

  return _loading;
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

/** Clear cache (e.g. after bulk product import). */
export function invalidateProductCatalogCache() {
  _cache = null;
  _loading = null;
}
