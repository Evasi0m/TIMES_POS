import { isSameTikTokModel, skuMatchTier } from '../../../lib/fuzzy-match.js';
import { TTC_COPY, TTC_TIER_LABEL } from './copy.js';

export const SORT_OLDEST = 'oldest';
export const SORT_NEWEST = 'newest';

export const TIER_LABEL = TTC_TIER_LABEL;

const SKU_CODE_RE = /[A-Z]{1,4}(?:-[A-Z0-9]{1,6}){1,4}/i;

export const GENERIC_TIKTOK_SKU_LABELS = new Set(['DEFAULT', 'STANDARD', '—', '']);

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
  return m ? m[0].toUpperCase() : text.trim().toUpperCase();
}

/** TikTok basket with no real SKU (e.g. sku_name = DEFAULT). */
export function isGenericTikTokSku(item) {
  const seller = (item?.seller_sku || '').trim();
  if (seller && !GENERIC_TIKTOK_SKU_LABELS.has(seller.toUpperCase())) return false;
  const key = extractTikTokSkuKey(item);
  if (GENERIC_TIKTOK_SKU_LABELS.has(key)) return true;
  return !SKU_CODE_RE.test(key);
}

export function orderListMeta(order) {
  const items = order.items || [];
  const itemCount = items.length;
  const unmatched = items.filter(i => !i.product_id).length;
  const matchLabel = unmatched > 0
    ? TTC_COPY.orderUnmatched(unmatched)
    : TTC_COPY.orderMatchedAll;
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

/** Live POS stock for a matched pick — catalog wins over cached pick value. */
export function resolvePickStock(pick, catalog) {
  const live = catalog?.find(p => p.id === pick?.id);
  const n = live?.current_stock ?? pick?.current_stock;
  return n != null && n !== '' ? Number(n) : null;
}

/** null = sufficient stock | { stock, need } = cannot confirm without going negative. */
export function stockShortfall(item, pick, catalog) {
  const stock = resolvePickStock(pick, catalog);
  const need = Number(item?.quantity) || 1;
  if (stock == null || !Number.isFinite(stock)) return null;
  if (stock < need) return { stock, need };
  return null;
}

export function orderHasStockIssue(items, picks, catalog) {
  return (items || []).some(
    it => picks[it.id]?.id && stockShortfall(it, picks[it.id], catalog),
  );
}

/** Normalize SKU tokens for display comparison. */
export function normalizeSkuToken(s) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function tiktokSkuForCompare(item) {
  return normalizeSkuToken(item?.seller_sku || extractTikTokSkuKey(item));
}

export function resolvePickSkuMatchTier(item, pick) {
  const tiktokSku = tiktokSkuForCompare(item);
  if (!tiktokSku || !pick) return { tier: 'none', score: 0, auto: false };
  const candidates = [pick.name, pick.model_code].filter(Boolean);
  let best = { tier: 'none', score: 0, auto: false };
  for (const sku of candidates) {
    const m = skuMatchTier(tiktokSku, sku);
    if (m.score > best.score) best = m;
  }
  return best;
}

/**
 * True when picked POS SKU is a genuinely different model from TikTok.
 * Whitelisted distributor suffixes count as the same SKU.
 * Generic TikTok baskets require explicit match confirmation.
 */
export function isTikTokSkuMismatch(item, pick, matchConfirmed = {}) {
  if (!item || !pick?.name) return false;
  if (matchConfirmed[item.id]) return false;

  if (isGenericTikTokSku(item)) return true;

  const tiktokSku = tiktokSkuForCompare(item);
  const pickSkus = [pick.name, pick.model_code].filter(Boolean);
  if (!tiktokSku || !pickSkus.length) return false;
  return !pickSkus.some(sku => isSameTikTokModel(tiktokSku, sku));
}

/** Show "ยืนยันการจับคู่" — generic basket or close prefix/fuzzy (not true substitution). */
export function needsMatchConfirm(item, pick, matchConfirmed = {}) {
  if (!item || !pick?.id || matchConfirmed[item.id]) return false;
  if (isGenericTikTokSku(item)) return true;
  const { tier } = resolvePickSkuMatchTier(item, pick);
  return tier === 'prefix' || tier === 'fuzzy';
}

/** Human-readable match status for match/review UI. */
export function skuMatchStatusMessage(item, pick, matchConfirmed = {}) {
  if (!item || !pick?.id) return null;
  if (matchConfirmed[item.id]) {
    return isGenericTikTokSku(item)
      ? TTC_COPY.matchConfirmedGeneric
      : TTC_COPY.matchConfirmedSimple;
  }
  const { tier } = resolvePickSkuMatchTier(item, pick);
  if (tier === 'exact' || tier === 'suffix') return null;
  if (isGenericTikTokSku(item)) {
    return TTC_COPY.genericNoModel;
  }
  if (tier === 'prefix' || tier === 'fuzzy') {
    return TTC_COPY.codeClose;
  }
  return TTC_COPY.modelMismatch;
}

/** @deprecated use isTikTokSkuMismatch — kept for existing imports */
export const isSkuSubstitution = isTikTokSkuMismatch;

/** Default substitution meta when a pick is made — always opt-in (off). */
export function defaultSubstitutionMeta() {
  return { substitute: false, note: '' };
}

/**
 * Line still needs cashier to pick a resolution path:
 * confirm match (mapping) OR substitute (one-off ship different model).
 * Auto-clear for exact/suffix non-generic matches.
 */
export function lineNeedsResolutionAck(item, pick, meta, matchConfirmed = {}) {
  if (!pick?.id) return false;
  if (matchConfirmed[item.id] || meta?.substitute === true) return false;
  if (!isGenericTikTokSku(item) && !isTikTokSkuMismatch(item, pick, {})) return false;
  return true;
}

export function orderNeedsResolutionAck(items, picks, substitutionMeta, matchConfirmed = {}) {
  return (items || []).some(it => {
    const pick = picks[it.id];
    if (!pick?.id) return false;
    return lineNeedsResolutionAck(it, pick, substitutionMeta?.[it.id], matchConfirmed);
  });
}

/** Show substitution checkbox — generic or true SKU mismatch, not yet resolved. */
export function needsSubstitutionOption(item, pick, meta, matchConfirmed = {}) {
  if (!pick?.id || meta?.substitute === true || matchConfirmed[item.id]) return false;
  return isGenericTikTokSku(item) || isTikTokSkuMismatch(item, pick, {});
}

/** SKU mismatch without explicit substitute opt-in — blocks confirm in review step. */
export function lineNeedsSubstitutionAck(item, pick, meta, matchConfirmed = {}) {
  return lineNeedsResolutionAck(item, pick, meta, matchConfirmed);
}

export function orderHasSubstitutionBlock(items, picks, substitutionMeta, matchConfirmed = {}) {
  return orderNeedsResolutionAck(items, picks, substitutionMeta, matchConfirmed);
}

/** @deprecated use orderNeedsResolutionAck */
export function orderNeedsMatchConfirm(items, picks, matchConfirmed = {}) {
  return (items || []).some(it => {
    const pick = picks[it.id];
    if (!pick?.id) return false;
    return needsMatchConfirm(it, pick, matchConfirmed);
  });
}

/** Resolve substitute flag + note for confirm RPC — explicit opt-in only. */
export function resolveSubstitutionForConfirm(item, pick, meta, matchConfirmed = {}) {
  const substitute = meta?.substitute === true
    && !matchConfirmed[item.id]
    && (isGenericTikTokSku(item) || isTikTokSkuMismatch(item, pick, {}));
  return {
    substitute,
    substitution_note: substitute ? (meta?.note || '').trim() || null : null,
  };
}
