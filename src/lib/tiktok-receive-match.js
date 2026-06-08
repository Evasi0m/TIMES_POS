// POS product → TikTok SKU matching for receive-stock mirror sync.

import { classifySkuMatch, findSkuCandidates, KNOWN_SKU_SUFFIXES, skuMatchTier } from './fuzzy-match.js';

/** Normalize TikTok SKU row for fuzzy-match pool (uses seller_sku as primary code). */
export function tiktokSkuAsMatchProduct(sku) {
  const code = (sku.seller_sku || sku.product_name || '').trim();
  return {
    id: sku.tiktok_sku_id,
    name: code,
    barcode: sku.seller_sku || '',
    tiktok_product_id: sku.tiktok_product_id,
    tiktok_sku_id: sku.tiktok_sku_id,
    seller_sku: sku.seller_sku,
    product_name: sku.product_name,
    quantity: sku.quantity ?? 0,
    warehouse_id: sku.warehouse_id,
  };
}

/** Build query string from POS line (name + barcode). */
export function posLineQuery(line) {
  return (line.product_name || line.name || line.barcode || '').trim();
}

/** Find TikTok SKU candidates for a POS receive line. */
export function findTikTokCandidatesForPosLine(line, tiktokSkus, opts = {}) {
  const query = posLineQuery(line);
  if (!query || !tiktokSkus?.length) return [];
  const pool = tiktokSkus.map(tiktokSkuAsMatchProduct);
  return findSkuCandidates(query, pool, { minScore: 0.5, limit: 8, ...opts })
    .map(c => ({
      ...c,
      sku: c.product,
      score: c.score,
      tier: c.tier,
    }));
}

/** Find TikTok SKU candidates for a typed search term (mirror PosProductMatcher search). */
export function findTikTokCandidatesForQuery(query, tiktokSkus, opts = {}) {
  const q = (query || '').trim();
  if (!q || !tiktokSkus?.length) return [];
  const pool = tiktokSkus.map(tiktokSkuAsMatchProduct);
  return findSkuCandidates(q, pool, { minScore: 0.5, limit: 8, ...opts })
    .map(c => ({
      ...c,
      sku: c.product,
      score: c.score,
      tier: c.tier,
    }));
}

/** Dedupe raw TikTok SKU rows by tiktok_sku_id. */
export function mergeTiktokSkuPools(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const s of list || []) {
      const id = s?.tiktok_sku_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(s);
    }
  }
  return out;
}

/** Drop irrelevant TikTok API rows (API may return an unfiltered catalog page). */
export function filterTikTokSkusByTerm(term, skus, opts = {}) {
  const minScore = opts.minScore ?? 0.55;
  const limit = opts.limit ?? 50;
  const primary = (typeof term === 'string' ? term : posLineQuery(term)).trim();
  if (!primary || !skus?.length) return [];

  const collect = (queries) => {
    const seen = new Set();
    const out = [];
    for (const q of queries) {
      for (const c of findTikTokCandidatesForQuery(q, skus, { minScore, limit })) {
        const id = c.sku?.tiktok_sku_id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const raw = skus.find(s => s.tiktok_sku_id === id);
        if (!raw) continue;
        out.push({ ...raw, _score: c.score, _tier: c.tier });
      }
    }
    out.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
    return out;
  };

  const direct = collect([primary]);
  if (direct.length || opts.allowVariants === false) return direct;

  const variants = posSkuSearchVariants(term, opts.maxVariants ?? 12)
    .filter(q => q !== primary);
  return collect(variants);
}

/** Classify best TikTok match for a POS line. */
export function classifyPosToTikTok(line, tiktokSkus, opts = {}) {
  const query = posLineQuery(line);
  if (!query || !tiktokSkus?.length) return { status: 'none', candidates: [] };
  const pool = tiktokSkus.map(tiktokSkuAsMatchProduct);
  const result = classifySkuMatch(query, pool, opts);
  if (result.status === 'auto' && result.product) {
    return { ...result, sku: result.product };
  }
  return {
    ...result,
    candidates: (result.candidates || []).map(c => ({ ...c, sku: c.product })),
  };
}

/** Barcode exact match against TikTok seller_sku. */
export function matchTikTokByBarcode(line, tiktokSkus) {
  const bc = (line.barcode || '').trim();
  if (!bc) return null;
  const hit = tiktokSkus.find(s => (s.seller_sku || '').trim() === bc);
  return hit ? tiktokSkuAsMatchProduct(hit) : null;
}

/** Filter candidates by minimum % for bulk ×10 UI. */
export function filterCandidatesByMinPct(candidates, minPct = 0) {
  const min = Number(minPct) / 100;
  return (candidates || []).filter(c => (c.score ?? 0) >= min);
}

/** Score POS name against a single TikTok seller_sku (for display). */
export function scorePosToTikTokSku(posName, sellerSku) {
  return skuMatchTier(posName, sellerSku);
}

/**
 * Build TikTok catalog search variants from a POS model code.
 * Strips distributor suffixes (DR, VDF, …) so GBD-200-1DR → GBD-200-1.
 */
export function posSkuSearchVariants(codeOrLine, maxVariants = 10) {
  const rawCodes = [];
  if (typeof codeOrLine === 'string') {
    const s = codeOrLine.trim();
    if (s) rawCodes.push(s);
  } else if (codeOrLine) {
    const q = posLineQuery(codeOrLine);
    if (q) rawCodes.push(q);
    const bc = (codeOrLine.barcode || '').trim();
    if (bc && bc !== q) rawCodes.push(bc);
  }

  const out = [];
  const seen = new Set();
  const add = (q) => {
    const s = (q || '').trim();
    if (s.length < 2 || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  for (const code of rawCodes) {
    add(code);
    const parts = code.split('-').filter(Boolean);
    if (parts.length >= 2) add(parts.slice(0, 2).join('-'));

    for (const suf of KNOWN_SKU_SUFFIXES) {
      if (code.endsWith(`-${suf}`)) add(code.slice(0, -(suf.length + 1)));
    }

    if (parts.length >= 1) {
      const last = parts[parts.length - 1];
      if (KNOWN_SKU_SUFFIXES.has(last) && parts.length >= 2) {
        add(parts.slice(0, -1).join('-'));
      }
      for (const suf of KNOWN_SKU_SUFFIXES) {
        if (last.length > suf.length && last.endsWith(suf)) {
          const stem = last.slice(0, -suf.length);
          if (stem) add([...parts.slice(0, -1), stem].join('-'));
        }
      }
    }
  }

  return out.slice(0, maxVariants);
}

/** Build deduped prefetch queries for TikTok catalog search from receive lines. */
export function prefetchQueriesForLines(lines, maxQueries = 12) {
  const out = [];
  const seen = new Set();
  const add = (q) => {
    const s = (q || '').trim();
    if (s.length < 2 || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  for (const l of lines || []) {
    for (const v of posSkuSearchVariants(l, 8)) add(v);
  }
  return out.slice(0, maxQueries);
}
