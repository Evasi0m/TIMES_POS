import { describe, it, expect } from 'vitest';
import { normalizeModel, editDistance, findDuplicateCandidates, findSimilarToName } from '../src/lib/product-duplicates.js';

describe('normalizeModel', () => {
  it('drops distributor tails, spaces and brackets', () => {
    expect(normalizeModel('AQ-240B-7A2DF')).toBe('AQ-240B-7A2');
    expect(normalizeModel('AE-1200WHL-5AVDF')).toBe('AE-1200WHL-5A');
    expect(normalizeModel('AQ-230GA-3AMQYDF')).toBe('AQ-230GA-3AMQ');
    expect(normalizeModel('GA-800SC-2AJF')).toBe('GA-800SC-2A');
    expect(normalizeModel('ถ1216 (M)')).toBe('ถ1216');
  });
});

describe('editDistance', () => {
  it('counts edits and caps', () => {
    expect(editDistance('AQ-240B-7A2', 'AQ-240E-7A2')).toBe(1);
    expect(editDistance('ABCDEF', 'UVWXYZ', 2)).toBe(3);
  });
});

describe('findDuplicateCandidates', () => {
  const P = [
    { id: 1, name: 'AQ-240E-7A2', barcode: '', tiktokSkus: [] },
    { id: 2, name: 'AQ-240B-7A2DF', barcode: '', tiktokSkus: ['AQ-240E-7A2'] },
    { id: 3, name: 'AQ-240E-2ADF', barcode: '', tiktokSkus: [] },
    { id: 4, name: 'A178WA-1ADF', barcode: '111111', tiktokSkus: [] },
    { id: 5, name: 'A178WA-1AUDF', barcode: '', tiktokSkus: [] },
    { id: 6, name: 'X(ผิดไม่ใช้)', barcode: '111111', tiktokSkus: [] },
  ];
  const c = findDuplicateCandidates(P);
  const pair = (a, b) => c.find(x => x.a.id === a && x.b.id === b);
  it('flags TikTok cross-mapping as high', () => {
    expect(pair(1, 2).level).toBe('high');
  });
  it('flags same model after tail as high', () => {
    expect(pair(4, 5).level).toBe('high');
  });
  it('colour variant is only medium', () => {
    expect(pair(1, 3)?.level).toBe('medium');
  });
  it('ignores retired names', () => {
    expect(c.some(x => x.a.id === 6 || x.b.id === 6)).toBe(false);
  });
});

describe('findSimilarToName', () => {
  it('lists exact model first, then near names', () => {
    const r = findSimilarToName('AQ-240E-7A2DF', [
      { id: 1, name: 'AQ-240B-7A2DF' }, { id: 2, name: 'AQ-240E-7A2' }, { id: 3, name: 'GA-100-1A' },
    ]);
    expect(r.map(x => [x.product.id, x.level])).toEqual([[2, 'high'], [1, 'medium']]);
  });
});
