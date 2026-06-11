import { describe, it, expect } from 'vitest';
import {
  isTikTokCancelledVoid,
  recommendedGoodsReturned,
  saleMatchesOrderSearch,
  normalizeReturnLookupSale,
} from '../src/lib/tiktok-cancel-return.js';

describe('isTikTokCancelledVoid', () => {
  it('accepts voided tiktok sale with cancel reason', () => {
    expect(isTikTokCancelledVoid({
      status: 'voided',
      channel: 'tiktok',
      void_reason: 'TikTok order cancelled',
    })).toBe(true);
  });

  it('rejects active sales', () => {
    expect(isTikTokCancelledVoid({
      status: 'active',
      channel: 'tiktok',
      void_reason: 'TikTok order cancelled',
    })).toBe(false);
  });

  it('rejects voided non-tiktok channel', () => {
    expect(isTikTokCancelledVoid({
      status: 'voided',
      channel: 'store',
      void_reason: 'TikTok order cancelled',
    })).toBe(false);
  });
});

describe('recommendedGoodsReturned', () => {
  it('defaults false when POS stock already restored', () => {
    expect(recommendedGoodsReturned({ pos_stock_restored: true })).toBe(false);
  });

  it('defaults true when void did not restore stock', () => {
    expect(recommendedGoodsReturned({ pos_stock_restored: false })).toBe(true);
  });

  it('respects explicit recommended_goods_returned', () => {
    expect(recommendedGoodsReturned({
      pos_stock_restored: false,
      recommended_goods_returned: false,
    })).toBe(false);
  });
});

describe('saleMatchesOrderSearch', () => {
  const order = { id: 127492, tiktok_order_id: '5761234567890' };

  it('matches POS id substring', () => {
    expect(saleMatchesOrderSearch(order, '127492')).toBe(true);
    expect(saleMatchesOrderSearch(order, '#1274')).toBe(true);
  });

  it('matches TikTok order id', () => {
    expect(saleMatchesOrderSearch(order, '576123')).toBe(true);
  });

  it('returns true for empty query', () => {
    expect(saleMatchesOrderSearch(order, '')).toBe(true);
  });
});

describe('normalizeReturnLookupSale', () => {
  it('flags tiktok cancelled void rows', () => {
    const row = normalizeReturnLookupSale({
      id: 1,
      status: 'voided',
      channel: 'tiktok',
      void_reason: 'TikTok order cancelled',
    });
    expect(row.isTikTokCancelledVoid).toBe(true);
  });
});
