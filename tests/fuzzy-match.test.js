import { describe, it, expect } from 'vitest';
import {
  normalizeCode,
  similarityScore,
  findCandidates,
  classifyMatch,
  skuMatchTier,
  findSkuCandidates,
  classifySkuMatch,
  isSameTikTokModel,
} from '../src/lib/fuzzy-match.js';

describe('normalizeCode', () => {
  it('uppercases', () => {
    expect(normalizeCode('ltp-1302ds-4avdf')).toBe('LTP1302DS4AVDF');
  });
  it('strips leading "CE " prefix', () => {
    expect(normalizeCode('CE LTP-1302DS-4AVDF')).toBe('LTP1302DS4AVDF');
  });
  it('strips dashes and whitespace', () => {
    expect(normalizeCode('  W - 218H - 8BVDF ')).toBe('W218H8BVDF');
  });
  it('handles null/undefined safely', () => {
    expect(normalizeCode(null)).toBe('');
    expect(normalizeCode(undefined)).toBe('');
    expect(normalizeCode('')).toBe('');
  });
});

describe('similarityScore', () => {
  it('returns 1 for identical strings (post-normalize)', () => {
    expect(similarityScore('LTP-1302DS-4AVDF', 'LTP-1302DS-4AVDF')).toBe(1);
  });
  it('returns 1 when only CE prefix differs', () => {
    expect(similarityScore('CE LTP-1302DS-4AVDF', 'LTP-1302DS-4AVDF')).toBe(1);
  });
  it('returns 1 when only dashes differ', () => {
    expect(similarityScore('W218H8BVDF', 'W-218H-8BVDF')).toBe(1);
  });
  it('catches missing trailing suffix (the W-218H-8B vs W-218H-8BVDF case)', () => {
    // 8 chars vs 10 chars, diff = 3 → score ≈ 0.7
    const s = similarityScore('W-218H-8B', 'W-218H-8BVDF');
    expect(s).toBeGreaterThanOrEqual(0.65);
    expect(s).toBeLessThan(0.94);  // not high enough to auto-match
  });
  it('returns 0 for unrelated strings', () => {
    const s = similarityScore('LTP-1302DS-4AVDF', 'ABCD');
    expect(s).toBeLessThan(0.3);
  });
  it('returns 0 for empty inputs', () => {
    expect(similarityScore('', 'abc')).toBe(0);
    expect(similarityScore('abc', '')).toBe(0);
    expect(similarityScore('', '')).toBe(0);
  });
  it('returns 0 for null/undefined inputs', () => {
    expect(similarityScore(null, 'abc')).toBe(0);
    expect(similarityScore(undefined, 'abc')).toBe(0);
  });
});

describe('findCandidates', () => {
  const products = [
    { id: 1, name: 'LTP-1302DS-4AVDF' },
    { id: 2, name: 'LTP-1302DS-7AVDF' },
    { id: 3, name: 'W-218H-8BVDF' },
    { id: 4, name: 'W-218H-8B' },
    { id: 5, name: 'MTP-VD01D-2BVUDF' },
    { id: 6, name: 'COMPLETELY-UNRELATED' },
  ];

  it('returns exact match first', () => {
    const r = findCandidates('LTP-1302DS-4AVDF', products);
    expect(r[0].product.id).toBe(1);
    expect(r[0].score).toBe(1);
  });
  it('returns the strict-prefix variant first when suffix is dropped', () => {
    // Query "W-218H-8B" → both id=4 (exact) and id=3 (longer) are
    // candidates; the exact normalize match must win.
    const r = findCandidates('W-218H-8B', products);
    expect(r[0].product.id).toBe(4);
  });
  it('finds the longer variant when suffix is included', () => {
    const r = findCandidates('W-218H-8BVDF', products);
    expect(r[0].product.id).toBe(3);
    expect(r[0].score).toBe(1);
  });
  it('respects minScore threshold', () => {
    const r = findCandidates('LTP-1302DS-4AVDF', products, { minScore: 0.99 });
    // Only the exact match passes the strict floor
    expect(r).toHaveLength(1);
  });
  it('respects limit', () => {
    const r = findCandidates('LTP-1302DS', products, { limit: 1, minScore: 0.3 });
    expect(r).toHaveLength(1);
  });
  it('returns empty array for unknown query', () => {
    const r = findCandidates('XYZABC123', products);
    expect(r).toEqual([]);
  });
  it('handles empty product list', () => {
    expect(findCandidates('anything', [])).toEqual([]);
  });
  it('handles null/empty query', () => {
    expect(findCandidates('', products)).toEqual([]);
    expect(findCandidates(null, products)).toEqual([]);
  });
});

describe('classifyMatch', () => {
  const products = [
    { id: 1, name: 'LTP-1302DS-4AVDF' },
    { id: 2, name: 'LTP-1302DS-7AVDF' },
    { id: 3, name: 'W-218H-8BVDF' },
    { id: 4, name: 'W-218H-8B' },
  ];

  it('auto-matches the exact name when nothing else is close', () => {
    const r = classifyMatch('LTP-1302DS-4AVDF', products);
    expect(r.status).toBe('auto');
    expect(r.product.id).toBe(1);
  });
  it('auto-matches the exact variant even when a longer suffix variant exists', () => {
    // Query "W-218H-8B" matches id=4 exactly (score 1.0) while id=3
    // ("W-218H-8BVDF") scores ~0.7 — gap is large, exact match wins.
    // This is the SAFE direction: if the bill code is shorter than a
    // similar DB entry, prefer the exact one.
    const r = classifyMatch('W-218H-8B', products);
    expect(r.status).toBe('auto');
    expect(r.product.id).toBe(4);
  });
  it('returns "none" when no candidate clears the suggestion floor', () => {
    const r = classifyMatch('TOTALLY-UNKNOWN-XYZ', products);
    expect(r.status).toBe('none');
    expect(r.candidates).toEqual([]);
  });
  it('returns "suggestions" for the missing-suffix case (bill spec example)', () => {
    // The plan's canonical example: bill says "W-218H-8BVDF", DB has
    // "W-218H-8B" instead — should surface as a suggestion for the user
    // to pick, not auto-match.
    const partialDB = [{ id: 99, name: 'W-218H-8B' }];
    const r = classifyMatch('W-218H-8BVDF', partialDB);
    // Score should be high enough to suggest but not auto.
    expect(r.status).toBe('suggestions');
    expect(r.candidates[0].product.id).toBe(99);
    expect(r.candidates[0].score).toBeGreaterThanOrEqual(0.6);
  });
});

describe('skuMatchTier', () => {
  // The 5 real TikTok → POS pairs from the spec: TikTok lists the bare
  // model code, POS appends a distributor suffix (UDF/VDF/DR).
  it.each([
    ['LTP-V007G-9E', 'LTP-V007G-9EUDF', 'UDF'],
    ['AMW-870DA-2A1', 'AMW-870DA-2A1VDF', 'VDF'],
    ['GA-2100-1A1', 'GA-2100-1A1DR', 'DR'],
    ['GX-56BB-1', 'GX-56BB-1DR', 'DR'],
    ['MWD-110H-8A', 'MWD-110H-8AVDF', 'VDF'],
    ['EF-539D-1A', 'EF-539D-1AVUDF', 'VUDF'],
    ['MTP-VD01D-1B', 'MTP-VD01D-1BVUDF', 'VUDF'],
  ])('auto-matches %s ↔ %s via whitelist suffix %s', (tiktok, pos) => {
    const r = skuMatchTier(tiktok, pos);
    expect(r.tier).toBe('suffix');
    expect(r.auto).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.95);
  });

  it('is order-independent (POS first)', () => {
    const r = skuMatchTier('GA-2100-1A1DR', 'GA-2100-1A1');
    expect(r.tier).toBe('suffix');
    expect(r.auto).toBe(true);
  });

  it('returns exact tier for identical codes (post-normalize)', () => {
    const r = skuMatchTier('ga-2100-1a1dr', 'GA-2100-1A1DR');
    expect(r.tier).toBe('exact');
    expect(r.score).toBe(1);
    expect(r.auto).toBe(true);
  });

  it('suggests (not auto) when tail is a non-whitelisted short alpha code', () => {
    // "ZZ" isn't a known distributor suffix → generic prefix rule → suggest
    const r = skuMatchTier('GA-2100-1A1', 'GA-2100-1A1ZZ');
    expect(r.tier).toBe('prefix');
    expect(r.auto).toBe(false);
    expect(r.score).toBeCloseTo(0.9, 5);
  });

  it('does NOT prefix-match when tail contains digits (different colourway)', () => {
    // "GA-2100-1" vs "GA-2100-1A1DR": tail "A1DR" has digits → the codes
    // differ at the colour level, must not collapse to one product.
    const r = skuMatchTier('GA-2100-1', 'GA-2100-1A1DR');
    expect(['fuzzy', 'none']).toContain(r.tier);
    expect(r.auto).toBe(false);
  });

  it('does NOT auto-match when tail is too long even if alphabetic', () => {
    const r = skuMatchTier('GA-2100', 'GA-2100ABCDE');
    expect(r.tier).not.toBe('suffix');
    expect(r.tier).not.toBe('prefix');
    expect(r.auto).toBe(false);
  });

  it('returns none for unrelated codes', () => {
    const r = skuMatchTier('GA-2100-1A1', 'LTP-V007G-9E');
    expect(r.tier).toBe('none');
    expect(r.auto).toBe(false);
  });

  it('handles empty / null inputs safely', () => {
    expect(skuMatchTier('', 'GA-2100').tier).toBe('none');
    expect(skuMatchTier(null, undefined).auto).toBe(false);
  });
});

describe('isSameTikTokModel', () => {
  it('returns true for exact and whitelisted suffix pairs', () => {
    expect(isSameTikTokModel('EF-539D-1A', 'EF-539D-1AVUDF')).toBe(true);
    expect(isSameTikTokModel('MTP-VD01D-1B', 'MTP-VD01D-1BVUDF')).toBe(true);
    expect(isSameTikTokModel('GA-2100-1A1', 'GA-2100-1A1DR')).toBe(true);
  });

  it('returns false for genuinely different models', () => {
    expect(isSameTikTokModel('AE-1600HX-3A', 'AE-1500WHX-1AVDF')).toBe(false);
  });
});

describe('findSkuCandidates / classifySkuMatch', () => {
  const products = [
    { id: 1, name: 'LTP-V007G-9EUDF', model_code: 'LTP-V007G-9EUDF' },
    { id: 2, name: 'GA-2100-1A1DR', model_code: 'GA-2100-1A1DR' },
    { id: 3, name: 'GA-2100-1A1ER', model_code: 'GA-2100-1A1ER' },
    { id: 4, name: 'MWD-110H-8AVDF', model_code: 'MWD-110H-8AVDF' },
    { id: 5, name: 'COMPLETELY-UNRELATED', model_code: null },
  ];

  it('finds the whitelist-suffix product as the top candidate', () => {
    const r = findSkuCandidates('LTP-V007G-9E', products);
    expect(r[0].product.id).toBe(1);
    expect(r[0].tier).toBe('suffix');
    expect(r[0].auto).toBe(true);
  });

  it('matches on model_code when name differs', () => {
    const list = [{ id: 9, name: 'นาฬิกา Casio รุ่นพิเศษ', model_code: 'MWD-110H-8AVDF' }];
    const r = findSkuCandidates('MWD-110H-8A', list);
    expect(r[0].product.id).toBe(9);
    expect(r[0].auto).toBe(true);
  });

  it('auto-classifies a clear whitelist match', () => {
    const r = classifySkuMatch('LTP-V007G-9E', products);
    expect(r.status).toBe('auto');
    expect(r.product.id).toBe(1);
  });

  it('falls back to suggestions when two distributor variants tie', () => {
    // "GA-2100-1A1" is a prefix of both id=2 (DR) and id=3 (ER); both are
    // auto-tier with identical score → no clear winner → suggest.
    const r = classifySkuMatch('GA-2100-1A1', products);
    expect(r.status).toBe('suggestions');
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('returns none when nothing clears the floor', () => {
    const r = classifySkuMatch('XYZ-999', products);
    expect(r.status).toBe('none');
  });
});
