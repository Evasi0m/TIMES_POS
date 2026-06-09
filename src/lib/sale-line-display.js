// Display helpers for sale_order_items rows — separates TikTok seller_sku
// (what cashiers scan for) from the long cart title in product_name.

/** Primary SKU label — seller_sku first, then product_name for in-store sales. */
export function saleLineSku(item) {
  const sku = (item?.seller_sku || '').trim();
  if (sku) return sku;
  return (item?.product_name || '').trim() || '—';
}

/** TikTok cart title — shown as caption when it differs from the SKU line. */
export function saleLineCartCaption(item) {
  const sku = (item?.seller_sku || '').trim();
  const cart = (item?.product_name || '').trim();
  if (sku && cart && cart !== sku) return cart;
  return '';
}

/** Lowercase search blob — seller_sku + sku_name + product_name. */
export function saleLineSearchText(item) {
  return [item?.seller_sku, item?.sku_name, item?.product_name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
