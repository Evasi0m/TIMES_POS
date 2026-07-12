// Narrow PostgREST selects for sale_orders / sale_order_items — avoids select('*') egress.

/** List rows + detail modal header (order header comes from list, not refetched). */
export const SALE_ORDER_LIST_SELECT =
  'id, sale_date, status, channel, payment_method, grand_total, subtotal, ' +
  'net_received, net_received_pending, discount_type, discount_value, total_after_discount, ' +
  'vat_rate, vat_amount, void_reason, voided_at, has_substitution, has_edits, ' +
  'tiktok_order_id, tiktok_resolution_kind, stock_resolution, ' +
  'created_by_email, notes, tax_invoice_no, buyer_name, buyer_tax_id, buyer_address, buyer_branch';

/** Profit / SKU summary in SalesView load and P&L report. */
export const SALE_ORDER_ITEM_SUMMARY_SELECT =
  'id, sale_order_id, product_id, product_name, seller_sku, sku_name, quantity, unit_price, cost_price, ' +
  'discount1_value, discount1_type, discount2_value, discount2_type, is_sku_substitution, substitution_note';

/** Detail modal, edit bill, print, TikTok panel / invoices. */
export const SALE_ORDER_ITEM_DETAIL_SELECT =
  `${SALE_ORDER_ITEM_SUMMARY_SELECT}, display_unit_price, sku_image_url`;

/** TikTok orders panel — same columns as detail (invoice + line cards). */
export const TIKTOK_ITEM_SELECT = SALE_ORDER_ITEM_DETAIL_SELECT;
