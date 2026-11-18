// Marketplace order numbers on manually keyed e-commerce bills
// (sale_orders.platform_order_no, migration 091).

/** Trim + collapse whitespace; '' → null. Case is kept (some platforms mix). */
export function normalizePlatformOrderNo(raw) {
  const s = String(raw ?? '').replace(/\s+/g, '').trim();
  return s ? s : null;
}

/** Sales History free-text search hit. `q` is already lower-cased. */
export function matchesPlatformOrderNo(order, q) {
  if (!q || !order?.platform_order_no) return false;
  return String(order.platform_order_no).toLowerCase().includes(q);
}

/**
 * First non-voided bill on the same channel holding this order number,
 * or null. `excludeId` skips the bill being edited.
 */
export async function findDuplicatePlatformOrder(sb, channel, orderNo, excludeId = null) {
  const no = normalizePlatformOrderNo(orderNo);
  if (!no || !channel) return null;
  let q = sb.from('sale_orders')
    .select('id')
    .eq('channel', channel)
    .ilike('platform_order_no', no.replace(/[%_\\]/g, (c) => '\\' + c))
    .neq('status', 'voided')
    .limit(1);
  if (excludeId != null) q = q.neq('id', excludeId);
  const { data, error } = await q;
  if (error) return null; // never block a sale on a failed pre-check; DB index is the backstop
  return data?.[0] || null;
}
