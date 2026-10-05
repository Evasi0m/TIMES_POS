// Decide whether a TikTok seller SKU and a POS model name are the same watch.
// Exact match or a whitelisted distributor suffix (VDF, UDF, DR, …) counts as
// the same model. A different colourway (MTP-V300D-1A vs MTP-V300D-1A2VDF)
// does not.

import { isSameTikTokModel, skuMatchTier } from './fuzzy-match.js';

const GENERIC_SKUS = new Set(['DEFAULT', 'STANDARD', '—']);

export function isLikelyWrongTikTokModel(sellerSku, posName) {
  const sku = String(sellerSku || '').trim();
  const name = String(posName || '').trim();
  if (!sku || !name || GENERIC_SKUS.has(sku.toUpperCase())) return false;
  return !isSameTikTokModel(sku, name);
}

/** Rank POS products for a TikTok seller SKU. Same-model hits come first. */
export function rankPosModelsForTikTokSku(sellerSku, products, { excludeId } = {}) {
  const sku = String(sellerSku || '').trim();
  return (products || [])
    .filter(p => p && p.id != null && p.id !== excludeId)
    .map(p => ({ product: p, match: skuMatchTier(sku, p.name) }))
    .sort((a, b) => {
      const aSame = a.match.tier === 'exact' || a.match.tier === 'suffix' ? 1 : 0;
      const bSame = b.match.tier === 'exact' || b.match.tier === 'suffix' ? 1 : 0;
      if (aSame !== bSame) return bSame - aSame;
      return (b.match.score || 0) - (a.match.score || 0);
    });
}

export function bestSameModelProduct(sellerSku, products, opts) {
  const ranked = rankPosModelsForTikTokSku(sellerSku, products, opts);
  const hit = ranked.find(r => r.match.tier === 'exact' || r.match.tier === 'suffix');
  return hit?.product || null;
}
