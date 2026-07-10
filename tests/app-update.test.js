import { describe, it, expect, vi, beforeEach } from 'vitest';

const { hardReload, clearSwAndCaches } = vi.hoisted(() => ({
  hardReload: vi.fn(),
  clearSwAndCaches: vi.fn(async () => {}),
}));

vi.mock('../src/lib/sw-self-heal.js', () => ({
  clearSwAndCaches,
  hardReload,
}));

const mockFetchUpdateLog = vi.fn(async () => ({
  patches: [{ id: 'remote-patch', title: 'Remote', date: '2026-07-10', tags: ['ใหม่'], items: ['line'] }],
}));

vi.mock('../src/lib/update-log.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchUpdateLog: (...args) => mockFetchUpdateLog(...args),
  };
});

vi.mock('../src/lib/runtime-fetch.js', () => ({
  runtimeFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({
      buildId: 'remote-build',
      releasePatchId: 'remote-patch',
      builtAt: '2026-07-10T00:00:00.000Z',
    }),
  })),
}));

import { isUpdateAvailable, applyAppUpdate, checkForUpdate } from '../src/lib/app-update.js';

describe('isUpdateAvailable', () => {
  it('returns false when remote is missing', () => {
    expect(isUpdateAvailable('abc123', null)).toBe(false);
    expect(isUpdateAvailable('abc123', '')).toBe(false);
  });

  it('returns true when local is missing but remote exists', () => {
    expect(isUpdateAvailable(null, 'def456')).toBe(true);
    expect(isUpdateAvailable('', 'def456')).toBe(true);
  });

  it('returns false when build ids match', () => {
    expect(isUpdateAvailable('same-id', 'same-id')).toBe(false);
  });

  it('returns true when build ids differ', () => {
    expect(isUpdateAvailable('old-build', 'new-build')).toBe(true);
  });
});

describe('applyAppUpdate', () => {
  beforeEach(() => {
    hardReload.mockClear();
    clearSwAndCaches.mockClear();
    vi.stubGlobal('window', {
      _getApplyUpdateContext: () => ({ cartCount: 0 }),
      _listQueuedSales: async () => [],
    });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn(async () => ({
          update: vi.fn(async () => {}),
          installing: null,
        })),
      },
    });
    vi.stubGlobal('sessionStorage', {
      store: {},
      setItem(k, v) { this.store[k] = v; },
      getItem(k) { return this.store[k] ?? null; },
      removeItem(k) { delete this.store[k]; },
    });
  });

  it('always clears caches and hard-reloads on success', async () => {
    const result = await applyAppUpdate();
    expect(result.ok).toBe(true);
    expect(clearSwAndCaches).toHaveBeenCalledTimes(1);
    expect(hardReload).toHaveBeenCalledTimes(1);
  });

  it('blocks when cart or queue has pending work', async () => {
    window._getApplyUpdateContext = () => ({ cartCount: 2 });
    window._listQueuedSales = async () => [{ id: 1 }];
    const result = await applyAppUpdate();
    expect(result).toEqual({ ok: false, reason: 'pending_work' });
    expect(clearSwAndCaches).not.toHaveBeenCalled();
    expect(hardReload).not.toHaveBeenCalled();
  });
});

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      _getApplyUpdateContext: () => ({ cartCount: 0 }),
      _listQueuedSales: async () => [],
    });
  });

  it('detects available update and loads release patches', async () => {
    const { available, patches } = await checkForUpdate();
    expect(available).toBe(true);
    expect(patches?.[0]?.id).toBe('remote-patch');
  });
});
