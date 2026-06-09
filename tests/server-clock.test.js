import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  syncServerClock,
  todayISO,
  serverNowISO,
  isClockSynced,
  clockDriftMs,
} from '../src/lib/server-clock.js';

describe('server-clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-08T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('syncServerClock caches offset from RPC', async () => {
    const sb = {
      rpc: vi.fn().mockResolvedValue({
        data: '2026-06-08T10:05:00.000Z',
        error: null,
      }),
    };
    const ok = await syncServerClock(sb);
    expect(ok).toBe(true);
    expect(isClockSynced()).toBe(true);
    expect(clockDriftMs()).toBe(5 * 60 * 1000);
    expect(todayISO()).toBe('2026-06-08');
    expect(serverNowISO()).toBe('2026-06-08T10:05:00.000Z');
  });

  it('falls back to device clock when RPC fails', async () => {
    const sb = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'fail' } }) };
    const ok = await syncServerClock(sb);
    expect(ok).toBe(false);
    expect(isClockSynced()).toBe(false);
    expect(todayISO()).toBe('2026-06-08');
  });
});
