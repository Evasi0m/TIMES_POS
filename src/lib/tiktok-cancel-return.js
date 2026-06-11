// TikTok order cancelled before ship — return from voided POS bill helpers.

export const TIKTOK_CANCEL_RETURN_EVENT = 'times-pos:tiktok-return-sale';
export const TIKTOK_CANCEL_RETURN_PREFILL_KEY = 'times-pos:tiktok-return-prefill';

/** Voided TikTok sale eligible for cancel-return flow. */
export function isTikTokCancelledVoid(sale) {
  if (!sale || sale.status !== 'voided' || sale.channel !== 'tiktok') return false;
  const reason = String(sale.void_reason || '').toLowerCase();
  return reason.includes('tiktok') && reason.includes('cancel');
}

/** Open customer return form with bill pre-filled (from TikTok panel). */
export function navigateToTikTokCancelledReturn(saleOrderId, setView) {
  sessionStorage.setItem(TIKTOK_CANCEL_RETURN_PREFILL_KEY, String(saleOrderId));
  setView?.('return');
  window.dispatchEvent(new CustomEvent(TIKTOK_CANCEL_RETURN_EVENT, {
    detail: { saleOrderId: Number(saleOrderId) },
  }));
}

/** Server meta: stock already restored via sale_void, recommended goods_returned. */
export async function fetchTikTokCancelReturnMeta(sb, saleOrderId) {
  const { data, error } = await sb.rpc('get_tiktok_cancel_return_meta', {
    p_sale_order_id: saleOrderId,
  });
  if (error) throw error;
  return data;
}

export function recommendedGoodsReturned(meta) {
  if (!meta) return true;
  if (meta.recommended_goods_returned != null) return !!meta.recommended_goods_returned;
  return !meta.pos_stock_restored;
}

/** Cross-tab order search in TikTok panel (POS id or TikTok order id). */
export function saleMatchesOrderSearch(order, query) {
  const q = String(query || '').trim().toLowerCase().replace(/^#/, '');
  if (!q) return true;
  if (String(order.id).includes(q)) return true;
  if (String(order.tiktok_order_id || '').toLowerCase().includes(q)) return true;
  return false;
}

/** Build sale row shape for return bill lookup (active + voided TikTok cancel). */
export function normalizeReturnLookupSale(row) {
  if (!row) return null;
  return {
    ...row,
    isTikTokCancelledVoid: isTikTokCancelledVoid(row),
  };
}
