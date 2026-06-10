// TikTok Shop orders panel — bounded, index-friendly load helpers.
// Avoids the old sale_order_items ⨝ sale_orders scan that hit statement_timeout.

import { fetchAll } from './sb-paginate.js';

/** Most recent N TikTok orders to load into the panel (UI paginates locally). */
export const TIKTOK_ORDERS_LOAD_CAP = 3000;

const ORDER_ID_CHUNK = 150;

/**
 * Fetch line items only for the given sale_order ids (chunked .in() queries).
 * @returns {Record<number, object[]>}
 */
export async function fetchItemsByOrderIds(sb, orderIds) {
  const map = {};
  if (!orderIds?.length) return map;

  for (let i = 0; i < orderIds.length; i += ORDER_ID_CHUNK) {
    const chunk = orderIds.slice(i, i + ORDER_ID_CHUNK);
    const { data, error } = await fetchAll((fromIdx, toIdx) =>
      sb.from('sale_order_items')
        .select('*')
        .in('sale_order_id', chunk)
        .order('id', { ascending: true })
        .range(fromIdx, toIdx),
    );
    if (error) throw error;
    for (const it of data || []) {
      (map[it.sale_order_id] ||= []).push(it);
    }
  }
  return map;
}

/**
 * Load recent TikTok sale_orders (single indexed query, capped).
 */
export async function fetchRecentTikTokOrders(sb, { limit = TIKTOK_ORDERS_LOAD_CAP } = {}) {
  return sb
    .from('sale_orders')
    .select('*')
    .eq('channel', 'tiktok')
    .not('tiktok_order_id', 'is', null)
    .order('sale_date', { ascending: false })
    .limit(limit);
}

/**
 * Product image URLs for a set of product ids (chunked).
 * @returns {Record<number, string>}
 */
export async function fetchProductImageMap(sb, productIds) {
  const imgMap = {};
  if (!productIds?.length) return imgMap;

  for (let i = 0; i < productIds.length; i += 500) {
    const chunk = productIds.slice(i, i + 500);
    const { data: imgs, error } = await sb.from('product_images')
      .select('product_id, image_url')
      .in('product_id', chunk)
      .not('image_url', 'is', null);
    if (error) throw error;
    for (const r of imgs || []) {
      if (r.image_url) imgMap[r.product_id] = r.image_url;
    }
  }
  return imgMap;
}
