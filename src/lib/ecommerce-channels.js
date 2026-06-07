// Marketplace channels — manual POS checkout vs API-imported orders.
//
// TikTok API imports exist in two generations:
//   • Legacy (before POS confirm go-live): imported as `active` immediately,
//     no `confirmed_at`. Cashiers often re-keyed the same sale manually at
//     POS — these must stay OUT of Sales History / Dashboard / P&L.
//   • Go-live (pending → confirm at POS): `status='pending'` until the
//     cashier matches SKUs + net_received; `confirm_tiktok_sale_order` sets
//     `confirmed_at` and flips to `active` — only then do they enter reports.
//
// Go-live cutoff (Bangkok): 2026-06-07 13:00 — enforced in DB (import + queue).
// Only orders with sale_date >= cutoff enter pending confirmation; older API
// imports are voided as legacy duplicates (migrations 042/044).

/** Go-live instant — 13:00 07/06/2026 Asia/Bangkok (for migrations/docs). */
export const TIKTOK_POS_GOLIVE = '2026-06-07T06:00:00.000Z';

/** Channels where the cashier may ring up a sale manually at POS. */
export const ECOMMERCE_CHANNELS = new Set(['tiktok', 'shopee', 'lazada']);

/** True when the row is a TikTok API sync (any generation). */
export function isTikTokApiOrder(row) {
  if (!row) return false;
  return Boolean(row.tiktok_order_id);
}

/**
 * True for Sales History badge — only orders the cashier confirmed at POS
 * (post go-live workflow). Legacy API imports without `confirmed_at` are
 * hidden from reports and must not show the badge.
 */
export function isApiImportedOrder(row) {
  return isTikTokApiOrder(row) && Boolean(row.confirmed_at);
}

/**
 * Supabase filter for Sales History, Dashboard, P&L, VAT, Insights, etc.
 *   • hide `status='pending'` (awaiting cashier confirm)
 *   • hide legacy TikTok API rows (`tiktok_order_id` set but no `confirmed_at`)
 * Manual POS sales (`tiktok_order_id` null) always pass through.
 */
export function excludePendingTikTok(q) {
  return q
    .neq('status', 'pending')
    .or('tiktok_order_id.is.null,confirmed_at.not.is.null');
}

/**
 * @deprecated Alias — kept so older imports keep working.
 */
export function excludeApiImports(q) {
  return excludePendingTikTok(q);
}
