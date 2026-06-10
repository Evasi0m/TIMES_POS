import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getLatestPatchId,
  computeUnread,
  patchTintTag,
  formatPatchDate,
  paginatePatches,
  UPDATE_LOG_PAGE_SIZE,
} from '../src/lib/update-log.js';

const sampleLog = {
  schemaVersion: 1,
  patches: [
    { id: '2026-06-10-a', date: '2026-06-10', title: 'A', tags: ['ใหม่'], items: [] },
    { id: '2026-06-01-b', date: '2026-06-01', title: 'B', tags: ['แก้บั๊ก'], items: [] },
  ],
};

describe('getLatestPatchId', () => {
  it('returns first patch id', () => {
    expect(getLatestPatchId(sampleLog)).toBe('2026-06-10-a');
  });

  it('returns null for empty log', () => {
    expect(getLatestPatchId({ patches: [] })).toBeNull();
    expect(getLatestPatchId(null)).toBeNull();
  });
});

describe('computeUnread', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: {},
      getItem(k) { return this.store[k] ?? null; },
      setItem(k, v) { this.store[k] = v; },
    });
  });

  it('true when never seen', () => {
    expect(computeUnread(sampleLog)).toBe(true);
  });

  it('false when latest id was seen', () => {
    localStorage.setItem('pos.updateLog.lastSeen', '2026-06-10-a');
    expect(computeUnread(sampleLog)).toBe(false);
  });

  it('true when older id was seen', () => {
    localStorage.setItem('pos.updateLog.lastSeen', '2026-06-01-b');
    expect(computeUnread(sampleLog)).toBe(true);
  });
});

describe('patchTintTag', () => {
  it('maps tag types', () => {
    expect(patchTintTag(['แก้บั๊ก'])).toBe('bug');
    expect(patchTintTag(['ปรับปรุง'])).toBe('tweak');
    expect(patchTintTag(['ใหม่', 'TikTok'])).toBe('new');
  });
});

describe('formatPatchDate', () => {
  it('formats ISO date in Thai', () => {
    const s = formatPatchDate('2026-06-10');
    expect(s).toMatch(/10/);
    expect(s.length).toBeGreaterThan(3);
  });
});

describe('paginatePatches', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({
    id: `p-${i}`,
    date: '2026-06-01',
    title: `Patch ${i}`,
    tags: [],
    items: [],
  }));

  it('returns 3 items per page', () => {
    const r = paginatePatches(many, 1);
    expect(r.items).toHaveLength(UPDATE_LOG_PAGE_SIZE);
    expect(r.totalPages).toBe(3);
    expect(r.total).toBe(7);
  });

  it('clamps page to valid range', () => {
    expect(paginatePatches(many, 99).page).toBe(3);
    expect(paginatePatches(many, 0).page).toBe(1);
  });

  it('page 2 starts at index 3', () => {
    const r = paginatePatches(many, 2);
    expect(r.items[0].id).toBe('p-3');
  });
});
