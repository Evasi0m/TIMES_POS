import { describe, it, expect } from 'vitest';
import { pageCount, pageItems } from '../src/lib/pagination.js';

describe('pageCount', () => {
  it('rounds up and never drops below 1', () => {
    expect(pageCount(0, 100)).toBe(1);
    expect(pageCount(100, 100)).toBe(1);
    expect(pageCount(101, 100)).toBe(2);
    expect(pageCount(6012, 100)).toBe(61);
  });
});

describe('pageItems', () => {
  it('lists every page when there are few', () => {
    expect(pageItems(0, 5)).toEqual([0, 1, 2, 3, 4]);
  });
  it('windows around the current page with gaps', () => {
    expect(pageItems(5, 12)).toEqual([0, 'gap', 4, 5, 6, 'gap', 11]);
  });
  it('keeps a steady window at the start and end', () => {
    expect(pageItems(0, 12)).toEqual([0, 1, 2, 3, 'gap', 11]);
    expect(pageItems(11, 12)).toEqual([0, 'gap', 8, 9, 10, 11]);
  });
  it('shows a single skipped page instead of a gap', () => {
    expect(pageItems(3, 12)).toEqual([0, 1, 2, 3, 4, 'gap', 11]);
  });
  it('always includes first, last and current', () => {
    for (let c = 0; c < 40; c++) {
      const it = pageItems(c, 40);
      expect(it).toContain(0);
      expect(it).toContain(39);
      expect(it).toContain(c);
    }
  });
});
