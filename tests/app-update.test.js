import { describe, it, expect, vi, beforeEach } from 'vitest';

const { hardReload, clearSwAndCaches } = vi.hoisted(() => ({
  hardReload: vi.fn(),
  clearSwAndCaches: vi.fn(async () => {}),
}));

vi.mock('../src/lib/sw-self-heal.js', () => ({
  clearSwAndCaches,
  hardReload,
}));

vi.mock('../src/lib/runtime-fetch.js', () => ({
  runtimeFetch: vi.fn(async () => ({
    ok: true,
    json: async () => ({ buildId: 'remote-build' }),
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
      confirm: vi.fn(() => true),
      _getApplyUpdateContext: () => ({ cartCount: 0 }),
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

  it('returns cancelled when user declines confirm', async () => {
    window.confirm = vi.fn(() => false);
    window._listQueuedSales = async () => [{ id: 1 }];
    const result = await applyAppUpdate();
    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(clearSwAndCaches).not.toHaveBeenCalled();
    expect(hardReload).not.toHaveBeenCalled();
  });
});

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      store: {},
      getItem(k) { return this.store[k] ?? null; },
      setItem(k, v) { this.store[k] = v; },
    });
  });

  it('detects available update from runtime fetch', async () => {
    const { available } = await checkForUpdate();
    expect(available).toBe(true);
  });
});
