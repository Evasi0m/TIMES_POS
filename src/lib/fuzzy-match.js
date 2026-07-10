// Fuzzy string matcher for Casio model codes (e.g. "LTP-1302DS-4AVDF").
//
// Used by the CMG bill scanner to map a model code the AI read off the
// printed bill against a product row in our database. The codes are
// pseudo-structured (PREFIX-DIGITS[LETTER]-DIGITSSUFFIX), but humans —
// and OCR — flip dashes, drop trailing letters, and occasionally hallucinate
// a digit. Pure equality misses too many real matches; trigrams or
// embeddings would be overkill for a 6k-row catalog. Normalized Levenshtein
// is the right zoom level.
//
// Conventions:
//   similarityScore(a, b)   →  0 (unrelated) … 1 (identical after normalize)
//   findCandidates(q, list) →  up to N candidates sorted by score desc
//
// Tuning thresholds (used by CmgBillScanModal):
//   ≥ 0.94  →  auto-match (high confidence, no user prompt)
//   ≥ 0.60  →  show as suggestion
//   <  0.60 →  treat as no match (user must create new or skip)
//
// "Auto-match" threshold is intentionally strict (0.94 not 0.85) — a
// false positive here = wrong product getting stock; manual review is
// always available so erring on the cautious side is correct.

/** Normalize a model code for comparison.
 *  - Uppercase
 *  - Strip "CE " / "CB " prefix (CMG bills prepend distributor codes)
 *  - Strip whitespace + dashes (dashes are structural but inconsistent
 *    between OCR and our DB — "W-218H-8BVDF" vs "W218H8BVDF")
 */
export function normalizeCode(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/^(CE|CB)\s+/, '')
    .replace(/\s+/g, '')        // strip all whitespace
    .replace(/-/g, '');         // strip dashes
}

/** Classic Levenshtein distance — iterative with single-row buffer to
 *  keep memory at O(min(a, b)). Stops early at MAX_DIST to avoid burning
 *  cycles on obviously-unrelated pairs (cheap path for the 6k catalog). */
function levenshtein(a, b, maxDist = 12) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // Always iterate over the shorter string in the inner loop.
  if (a.length > b.length) { const t = a; a = b; b = t; }

  const lenA = a.length, lenB = b.length;
  if (lenB - lenA > maxDist) return maxDist + 1;  // early exit

  let prev = new Array(lenA + 1);
  let curr = new Array(lenA + 1);
  for (let i = 0; i <= lenA; i++) prev[i] = i;

  for (let j = 1; j <= lenB; j++) {
    curr[0] = j;
    let rowMin = j;
    const cj = b.charCodeAt(j - 1);
    for (let i = 1; i <= lenA; i++) {
      const cost = a.charCodeAt(i - 1) === cj ? 0 : 1;
      const v = Math.min(
        prev[i] + 1,         // deletion
        curr[i - 1] + 1,     // insertion
        prev[i - 1] + cost,  // substitution
      );
      curr[i] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;  // early exit
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[lenA];
}

/** 0 (unrelated) … 1 (identical). NaN-safe; empty inputs return 0. */
export function similarityScore(a, b) {
  const A = normalizeCode(a);
  const B = normalizeCode(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const maxLen = Math.max(A.length, B.length);
  const dist = levenshtein(A, B, Math.max(8, Math.ceil(maxLen * 0.6)));
  return Math.max(0, 1 - dist / maxLen);
}

/**
 * Find the top-N candidate matches in a product list.
 *
 * @param {string} query             model code from the bill
 * @param {Array<{id, name, ...}>} products  catalog
 * @param {object} [opts]
 * @param {number} [opts.limit=5]    max candidates to return
 * @param {number} [opts.minScore=0.5]  threshold below which results are
 *                                      dropped — keep wide enough to catch
 *                                      "missing trailing VDF" cases
 * @returns {Array<{product, score}>} highest score first
 */
export function findCandidates(query, products, opts = {}) {
  const { limit = 5, minScore = 0.5 } = opts;
  if (!query || !Array.isArray(products) || products.length === 0) return [];

  const out = [];
  for (const p of products) {
    const byName = similarityScore(query, p.name);
    const byCode = p.model_code ? similarityScore(query, p.model_code) : 0;
    const s = Math.max(byName, byCode);
    if (s >= minScore) out.push({ product: p, score: s });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/**
 * Convenience: classify a query against a product list.
 *
 * @returns {{ status, product?, score?, candidates? }}
 *   status === 'auto'        → product is the high-confidence match
 *   status === 'suggestions' → candidates is the suggestion list
 *   status === 'none'        → no candidates above the suggestion floor
 */
export function classifyMatch(query, products, opts = {}) {
  const candidates = findCandidates(query, products, { limit: 5, minScore: 0.5, ...opts });
  if (candidates.length === 0) return { status: 'none', candidates: [] };
  const top = candidates[0];
  // Auto-match must be high score AND clearly better than the runner-up,
  // otherwise we'd auto-pick "W-218H-8B" over "W-218H-8BVDF" when both
  // exist and the user meant the longer one.
  const runnerUp = candidates[1]?.score ?? 0;
  if (top.score >= 0.94 && top.score - runnerUp >= 0.06) {
    return { status: 'auto', product: top.product, score: top.score, candidates };
  }
  return { status: 'suggestions', candidates };
}

// =====================================================================
// SKU matching — TikTok seller_sku ↔ POS model code
// =====================================================================
//
// TikTok lists the bare Casio model code (e.g. "GA-2100-1A1") while our
// POS catalog appends a regional/warranty distributor suffix
// ("GA-2100-1A1DR"). The TikTok SKU is therefore a strict PREFIX of the
// POS SKU and the leftover tail is the distributor code.
//
// Normalized Levenshtein scores these ~0.75–0.82 (the tail divides the
// score by length) so they never auto-match. A prefix + suffix-aware
// comparison recognizes them with high confidence.

/** Known Casio regional / warranty distributor suffixes (extend freely).
 *  A match where the leftover tail is one of these is high-confidence
 *  enough to auto-link. Anything else falls back to the generic
 *  "prefix + short alpha tail" rule which only *suggests*. */
export const KNOWN_SKU_SUFFIXES = new Set([
  'DR', 'VDF', 'UDF', 'ER', 'EF', 'JF', 'GF', 'A', 'JR',
  'AVDF', 'AUDF', 'VUDF', 'BVUDF', 'VCF', 'DF', 'UD', 'SDF', 'CR', 'PR', 'VDR', 'AER',
]);

/**
 * Tier-based SKU match between two codes (order-independent).
 *
 * Tiers (highest → lowest):
 *   'exact'  → identical after normalize                       (score 1.00, auto)
 *   'suffix' → shorter is prefix of longer, tail ∈ whitelist   (score 0.97, auto)
 *   'prefix' → shorter is prefix of longer, tail = 1–4 letters (score 0.90, suggest)
 *   'fuzzy'  → normalized Levenshtein ≥ 0.6                     (score = sim,  suggest)
 *   'none'   → below the suggestion floor                       (score = sim)
 *
 * The all-alphabetic ≤4-char tail guard prevents collapsing different
 * colourways: "GA-2100-1" vs "GA-2100-1A1DR" has tail "A1DR" (contains
 * digits) → not a region suffix → no prefix/suffix match.
 *
 * @returns {{ tier: 'exact'|'suffix'|'prefix'|'fuzzy'|'none', score: number, auto: boolean }}
 */
export function skuMatchTier(a, b) {
  const A = normalizeCode(a);
  const B = normalizeCode(b);
  if (!A || !B) return { tier: 'none', score: 0, auto: false };
  if (A === B) return { tier: 'exact', score: 1, auto: true };

  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  if (long.startsWith(short)) {
    const tail = long.slice(short.length);
    if (KNOWN_SKU_SUFFIXES.has(tail)) {
      return { tier: 'suffix', score: 0.97, auto: true };
    }
    if (/^[A-Z]{1,4}$/.test(tail)) {
      return { tier: 'prefix', score: 0.9, auto: false };
    }
  }

  const sim = similarityScore(A, B);
  if (sim >= 0.6) return { tier: 'fuzzy', score: sim, auto: false };
  return { tier: 'none', score: sim, auto: false };
}

/** True when TikTok bare code and POS code are the same model (exact or distributor suffix). */
export function isSameTikTokModel(tiktokKey, posSku) {
  const { tier } = skuMatchTier(tiktokKey, posSku);
  return tier === 'exact' || tier === 'suffix';
}

/**
 * Best SKU match for a query against a product list. Each product is
 * compared against the query using both `name` and `model_code`.
 *
 * @param {string} query                 TikTok seller_sku
 * @param {Array<{id, name, model_code?}>} products
 * @param {object} [opts]
 * @param {number} [opts.minScore=0.6]    drop matches below this score
 * @returns {Array<{product, tier, score, auto}>} highest score first
 */
export function findSkuCandidates(query, products, opts = {}) {
  const { minScore = 0.6, limit = 5 } = opts;
  if (!query || !Array.isArray(products) || products.length === 0) return [];

  const out = [];
  for (const p of products) {
    const byName = skuMatchTier(query, p.name);
    const byCode = p.model_code ? skuMatchTier(query, p.model_code) : { tier: 'none', score: 0, auto: false };
    const best = byCode.score > byName.score ? byCode : byName;
    if (best.score >= minScore) {
      out.push({ product: p, tier: best.tier, score: best.score, auto: best.auto });
    }
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, limit);
}

/**
 * Classify a SKU query into an auto-link target or a suggestion list.
 *
 * Auto requires the top candidate to be an auto-tier (exact/suffix) AND
 * clearly ahead of the runner-up, so two distributor variants of the
 * same code don't silently pick the wrong one.
 *
 * @returns {{ status: 'auto'|'suggestions'|'none', product?, tier?, score?, candidates }}
 */
export function classifySkuMatch(query, products, opts = {}) {
  const candidates = findSkuCandidates(query, products, opts);
  if (candidates.length === 0) return { status: 'none', candidates: [] };
  const top = candidates[0];
  const runnerUp = candidates[1]?.score ?? 0;
  if (top.auto && top.score - runnerUp >= 0.04) {
    return { status: 'auto', product: top.product, tier: top.tier, score: top.score, candidates };
  }
  return { status: 'suggestions', candidates };
}
