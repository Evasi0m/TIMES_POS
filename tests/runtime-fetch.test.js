import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runtimeFetchUrl, runtimeFetch } from '../src/lib/runtime-fetch.js';

describe('runtimeFetchUrl', () => {
  it('builds relative cache-busted URL', () => {
    const url = runtimeFetchUrl('version.json', 12345);
    expect(url).toBe('./version.json?v=12345');
  });

  it('strips leading ./ from path', () => {
    expect(runtimeFetchUrl('./updates.json', 99)).toBe('./updates.json?v=99');
  });
});

describe('runtimeFetch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  });

  it('calls fetch with no-store and bust query', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T12:00:00Z'));
    await runtimeFetch('version.json');
    expect(fetch).toHaveBeenCalledWith(
      './version.json?v=' + Date.now(),
      { cache: 'no-store' },
    );
    vi.useRealTimers();
  });
});
