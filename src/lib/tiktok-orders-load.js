// TikTok Shop orders panel — bounded, index-friendly load helpers.
// Avoids the old sale_order_items ⨝ sale_orders scan that hit statement_timeout.

import { fetchAll } from './sb-paginate.js';
import { versionedImageUrl } from './product-classify.js';

/** Most recent N TikTok orders to load into the panel (UI paginates locally). */
export const TIKTOK_ORDERS_LOAD_CAP = 3000;

/** Columns used by TikTokPanel / invoices / order cards — not select('*'). */
export const TIKTOK_ORDER_SELECT =
  'id, sale_date, status, channel, grand_total, net_received, net_received_pending, payment_method, ' +
  'tiktok_order_id, tiktok_order_status, tiktok_shipping_type, tracking_number, ' +
  'buyer_name, buyer_address, buyer_tax_id, buyer_branch, ' +
  'shipping_recipient_name, shipping_address, tax_invoice_no, vat_amount, void_reason';

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
    .select(TIKTOK_ORDER_SELECT)
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
      .select('product_id, image_url, updated_at')
      .in('product_id', chunk)
      .not('image_url', 'is', null);
    if (error) throw error;
    for (const r of imgs || []) {
      if (r.image_url) imgMap[r.product_id] = versionedImageUrl(r.image_url, r.updated_at);
    }
  }
  return imgMap;
}
