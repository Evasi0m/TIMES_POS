// TikTok stock resolution — manual return card helpers.

export const TIKTOK_RETURN_CHANGED_EVENT = 'tiktok-return-changed';

/** Go-live for manual stock resolution queue (mirrors DB constant in 080). */
export const TIKTOK_STOCK_RESOLUTION_GO_LIVE = '2026-07-12T20:26:00+07:00';

export const RESOLUTION_KIND = {
  CANCEL_PRE_SHIP: 'cancel_pre_ship',
  RETURN_POST_SHIP: 'return_post_ship',
  RETURN_REFUND: 'return_refund',
  REFUND_ONLY: 'refund_only',
};

export const STOCK_RESOLUTION = {
  AWAITING: 'awaiting',
  RESTOCKED: 'restocked',
  LOST: 'lost',
  NA: 'n_a',
};

const SHIPPED_STATUSES = new Set([
  'AWAITING_COLLECTION',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
  'PARTIALLY_SHIPPING',
]);

/** Client mirror of tiktok_order_was_shipped — for labels / tests only. */
export function tiktokOrderWasShipped(order) {
  if (!order) return false;
  const st = String(order.tiktok_order_status || '').toUpperCase();
  if (SHIPPED_STATUSES.has(st)) return true;
  if (String(order.tracking_number || '').trim()) return true;
  const pkgs = order.tiktok_package_ids;
  if (Array.isArray(pkgs) && pkgs.length > 0) return true;
  if (pkgs && typeof pkgs === 'object' && Object.keys(pkgs).length > 0) return true;
  return false;
}

/** Thai label for resolution kind badge in return card list. */
export function resolutionKindLabel(kind) {
  switch (kind) {
    case RESOLUTION_KIND.CANCEL_PRE_SHIP:
      return 'ยกเลิกก่อนส่ง';
    case RESOLUTION_KIND.RETURN_POST_SHIP:
      return 'ตีกลับหลังส่ง';
    case RESOLUTION_KIND.RETURN_REFUND:
      return 'คืนสินค้า/คืนเงิน TikTok';
    case RESOLUTION_KIND.REFUND_ONLY:
      return 'คืนเงินอย่างเดียว';
    default:
      return kind ? String(kind).replace(/_/g, ' ') : 'รอตีกลับ';
  }
}

/** Default goods-returned radio — null = user must choose explicitly. */
export function defaultGoodsReturnedForKind(kind) {
  switch (kind) {
    case RESOLUTION_KIND.CANCEL_PRE_SHIP:
      return true;
    case RESOLUTION_KIND.REFUND_ONLY:
      return false;
    default:
      return null;
  }
}

export function notifyTikTokReturnChanged() {
  window.dispatchEvent(new Event(TIKTOK_RETURN_CHANGED_EVENT));
}

export async function fetchPendingTikTokStockResolutions(sb, limit = 200) {
  const { data, error } = await sb.rpc('get_pending_tiktok_stock_resolutions', {
    p_limit: limit,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function confirmTikTokStockResolution(sb, saleOrderId, goodsReturned, notes = null) {
  const { data, error } = await sb.rpc('confirm_tiktok_stock_resolution', {
    p_sale_order_id: saleOrderId,
    p_goods_returned: goodsReturned,
    p_notes: notes,
  });
  if (error) throw error;
  return data;
}

/** Resolved stock badge for voided TikTok orders in history / e-commerce. */
export function resolvedStockLabel(stockResolution) {
  switch (stockResolution) {
    case STOCK_RESOLUTION.AWAITING:
      return { label: 'รอตีกลับ', tone: 'amber', title: 'รอยืนยันว่าได้รับสินค้าคืนหรือของหาย' };
    case STOCK_RESOLUTION.RESTOCKED:
      return { label: 'ได้ของคืนแล้ว', tone: 'ok', title: 'บันทึกรับคืนและบวกสต็อกแล้ว' };
    case STOCK_RESOLUTION.LOST:
      return { label: 'ตีกลับ (ของหาย)', tone: 'warn', title: 'บันทึกเงินคืนโดยไม่บวกสต็อก' };
  }
  return null;
}
