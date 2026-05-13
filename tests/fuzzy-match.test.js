import { describe, it, expect } from 'vitest';
import {
  normalizeCode,
  similarityScore,
  findCandidates,
  classifyMatch,
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
