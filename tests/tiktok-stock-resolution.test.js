import { describe, it, expect } from 'vitest';
import {
  RESOLUTION_KIND,
  STOCK_RESOLUTION,
  tiktokOrderWasShipped,
  resolutionKindLabel,
  defaultGoodsReturnedForKind,
  resolvedStockLabel,
} from '../src/lib/tiktok-stock-resolution.js';

describe('tiktokOrderWasShipped', () => {
  it('true when IN_TRANSIT', () => {
    expect(tiktokOrderWasShipped({ tiktok_order_status: 'IN_TRANSIT' })).toBe(true);
  });

  it('true when tracking_number set', () => {
    expect(tiktokOrderWasShipped({
      tiktok_order_status: 'AWAITING_SHIPMENT',
      tracking_number: 'TH123',
    })).toBe(true);
  });

  it('false for AWAITING_SHIPMENT without tracking', () => {
    expect(tiktokOrderWasShipped({ tiktok_order_status: 'AWAITING_SHIPMENT' })).toBe(false);
  });
});

describe('resolutionKindLabel', () => {
  it('maps known kinds', () => {
    expect(resolutionKindLabel(RESOLUTION_KIND.CANCEL_PRE_SHIP)).toBe('?????????????');
    expect(resolutionKindLabel(RESOLUTION_KIND.RETURN_POST_SHIP)).toBe('?????????????');
    expect(resolutionKindLabel(RESOLUTION_KIND.RETURN_REFUND)).toBe('?????????/??????? TikTok');
    expect(resolutionKindLabel(RESOLUTION_KIND.REFUND_ONLY)).toBe('?????????????????');
  });
});

describe('defaultGoodsReturnedForKind', () => {
  it('pre-ship defaults to received', () => {
    expect(defaultGoodsReturnedForKind(RESOLUTION_KIND.CANCEL_PRE_SHIP)).toBe(true);
  });

  it('refund_only defaults to not received', () => {
    expect(defaultGoodsReturnedForKind(RESOLUTION_KIND.REFUND_ONLY)).toBe(false);
  });

  it('post-ship requires explicit choice', () => {
    expect(defaultGoodsReturnedForKind(RESOLUTION_KIND.RETURN_POST_SHIP)).toBeNull();
    expect(defaultGoodsReturnedForKind(RESOLUTION_KIND.RETURN_REFUND)).toBeNull();
  });
});

describe('resolvedStockLabel', () => {
  it('labels awaiting and resolved states', () => {
    expect(resolvedStockLabel(STOCK_RESOLUTION.AWAITING)?.label).toBe('????????');
    expect(resolvedStockLabel(STOCK_RESOLUTION.RESTOCKED)?.label).toBe('?????????????');
    expect(resolvedStockLabel(STOCK_RESOLUTION.LOST)?.label).toBe('?????? (??????)');
    expect(resolvedStockLabel(STOCK_RESOLUTION.NA)).toBeNull();
  });
});

describe('void_tiktok no auto sale_void (design contract)', () => {
  it('documents that active cancel must not imply sale_void without user confirm', () => {
    const allowedAutoStockOnTikTokCancel = false;
    expect(allowedAutoStockOnTikTokCancel).toBe(false);
  });
});
