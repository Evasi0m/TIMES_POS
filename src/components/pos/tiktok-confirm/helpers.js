export const SORT_OLDEST = 'oldest';
export const SORT_NEWEST = 'newest';

export const TIER_LABEL = {
  exact: 'ตรงกัน',
  suffix: 'suffix ตรงรุ่น',
  prefix: 'prefix ใกล้เคียง',
  fuzzy: 'คล้ายกัน',
};

const SKU_CODE_RE = /[A-Z]{1,4}(?:-[A-Z0-9]{1,6}){1,4}/i;

export const fmtTHB = (n) =>
  '฿' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return ''; }
};

export function extractTikTokSkuKey(item) {
  const seller = (item?.seller_sku || '').trim();
  if (seller) return seller.toUpperCase();
  const text = [item?.sku_name, item?.product_name].filter(Boolean).join(' ');
  const m = text.match(SKU_CODE_RE);
  return m ? m[0].toUpperCase() : text.trim();
}

export function orderListMeta(order) {
  const items = order.items || [];
  const itemCount = items.length;
  const unmatched = items.filter(i => !i.product_id).length;
  const matchLabel = unmatched > 0
    ? `ยังไม่จับคู่ ${unmatched}`
    : 'จับคู่ครบแล้ว';
  return {
    itemCount,
    unmatched,
    matchLabel,
    allMatched: unmatched === 0,
  };
}

export function itemSkuLabel(item) {
  return item?.sku_name || item?.product_name || item?.seller_sku || '—';
}
