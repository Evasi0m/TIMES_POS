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
 *  - Strip "CE " prefix (CMG bills always prepend it)
 *  - Strip whitespace + dashes (dashes are structural but inconsistent
 *    between OCR and our DB — "W-218H-8BVDF" vs "W218H8BVDF")
 */
export function normalizeCode(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/^CE\s+/, '')      // strip leading "CE "
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
    const s = similarityScore(query, p.name);
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
