// Guard against double-entry: manual POS checkout overlapping a pending Web Shop order.

/**
 * @param {Array<{ id: number, web_order_number?: string, items?: Array<{ product_id?: number|null }> }>} pendingOrders
 * @param {Array<{ product_id: number }>} cartLines
 */
export function findPendingWebOverlap(pendingOrders, cartLines) {
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

export function formatWebOverlapWarning(overlaps) {
  const ids = overlaps
    .map(o => o.web_order_number || `#${o.id}`)
    .slice(0, 5);
  const extra = overlaps.length > 5 ? ` +${overlaps.length - 5}` : '';
  return `มีออเดอร์ Web Shop รอยืนยัน ${overlaps.length} รายการ (${ids.join(', ')}${extra}) ที่มีสินค้าตรงกับตะกร้า`;
}
