// Server-side product search for ProductsView (search-first / Tier B).
// POS uses inline queries; this module shares select shape + image mapping.

import { PRODUCT_LIST_SELECT } from './product-catalog-cache.js';

export const PRODUCT_SEARCH_LIMIT = 50;

const SEARCH_SELECT =
  `${PRODUCT_LIST_SELECT}, product_images(image_url, status, updated_at)`;

/** Strip join payload; pick first found image row for enrichProduct. */
export function normalizeSearchRow(row) {
  if (!row) return row;
  const imgs = row.product_images;
  let imageRow = null;
  if (Array.isArray(imgs)) {
    imageRow = imgs.find((i) => i?.status === 'found' && i?.image_url) || null;
  } else if (imgs?.status === 'found' && imgs?.image_url) {
    imageRow = imgs;
  }
  const { product_images: _pi, ...rest } = row;
  return { ...rest, _imageRow: imageRow };
}

/**
 * Search by barcode (exact) or product name (ilike). Returns up to `limit` rows.
 * @returns {Promise<{ data: object[], error: Error | null }>}
 */
export async function searchProducts(sb, query, { limit = PRODUCT_SEARCH_LIMIT } = {}) {
  const q = (query || '').trim();
  if (!q) return { data: [], error: null };

  if (/^\d{8,}$/.test(q)) {
    const { data, error } = await sb
      .from('products')
      .select(SEARCH_SELECT)
      .eq('barcode', q)
      .limit(1);
    return { data: (data || []).map(normalizeSearchRow), error };
  }

  const { data, error } = await sb
    .from('products')
    .select(SEARCH_SELECT)
    .ilike('name', `%${q}%`)
    .order('current_stock', { ascending: false })
    .limit(limit);

  return { data: (data || []).map(normalizeSearchRow), error };
}

/** True when chip / advanced filters need the full in-memory catalog. */
export function needsBrowseCatalog(filter) {
  if (!filter) return false;
  return (
    filter.brand !== 'all'
    || !!filter.series
    || !!filter.subType
    || !!filter.material
    || !!filter.color
    || filter.minPrice > 0
    || filter.maxPrice > 0
  );
}
