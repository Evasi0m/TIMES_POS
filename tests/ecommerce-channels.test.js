import { describe, it, expect } from 'vitest';
import {
  isTikTokApiOrder,
  isApiImportedOrder,
  excludePendingTikTok,
  TIKTOK_POS_GOLIVE,
} from '../src/lib/ecommerce-channels.js';

describe('ecommerce-channels', () => {
  it('isTikTokApiOrder detects tiktok_order_id', () => {
    expect(isTikTokApiOrder({ tiktok_order_id: '123' })).toBe(true);
    expect(isTikTokApiOrder({ tiktok_order_id: null })).toBe(false);
    expect(isTikTokApiOrder(null)).toBe(false);
  });

  it('isApiImportedOrder requires confirmed_at', () => {
    expect(isApiImportedOrder({ tiktok_order_id: '1', confirmed_at: '2026-06-07T10:00:00Z' })).toBe(true);
    expect(isApiImportedOrder({ tiktok_order_id: '1', confirmed_at: null })).toBe(false);
    expect(isApiImportedOrder({ tiktok_order_id: null, confirmed_at: '2026-06-07T10:00:00Z' })).toBe(false);
  });

  it('excludePendingTikTok chains neq and or filters', () => {
    const calls = [];
    const q = {
      neq: (col, val) => { calls.push(['neq', col, val]); return q; },
      or: (expr) => { calls.push(['or', expr]); return q; },
    };
    excludePendingTikTok(q);
    expect(calls).toEqual([
      ['neq', 'status', 'pending'],
      ['or', 'tiktok_order_id.is.null,confirmed_at.not.is.null'],
    ]);
  });

  it('TIKTOK_POS_GOLIVE is 13:00 Bangkok on 2026-06-07', () => {
    expect(TIKTOK_POS_GOLIVE).toBe('2026-06-07T06:00:00.000Z');
  });
});
