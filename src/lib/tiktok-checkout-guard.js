// Guard against double-entry: manual POS checkout for the same products
// as a pending TikTok API order (stock + revenue would be counted twice).
//
// Used in POSView.submit() when channel is an e-commerce marketplace.

/** @typedef {{ id: number, tiktok_order_id: string, items?: Array<{ product_id?: number|null }> }} PendingOrder */

/**
 * Find pending TikTok API orders whose line items overlap cart product IDs.
 * @param {PendingOrder[]} pendingOrders — from get_pending_tiktok_orders RPC
 * @param {Array<{ product_id: number }>} cartLines
 * @returns {PendingOrder[]}
 */
export function findPendingTikTokOverlap(pendingOrders, cartLines) {
  if (!pendingOrders?.length || !cartLines?.length) return [];
  const cartProductIds = new Set(
    cartLines.map(l => l.product_id).filter(Boolean),
  );
  if (!cartProductIds.size) return [];

  return pendingOrders.filter(order => {
    const items = order.items || [];
    return items.some(item => item.product_id && cartProductIds.has(item.product_id));
  });
}

/**
 * Human-readable summary for the overlap warning modal.
 * @param {PendingOrder[]} overlaps
 * @returns {string}
 */
export function formatOverlapWarning(overlaps) {
  const ids = overlaps
    .map(o => o.tiktok_order_id || `#${o.id}`)
    .slice(0, 5);
  const extra = overlaps.length > 5 ? ` +${overlaps.length - 5}` : '';
  return `มีออเดอร์ TikTok API รอยืนยัน ${overlaps.length} รายการ (${ids.join(', ')}${extra}) ที่มีสินค้าตรงกับตะกร้า`;
}
