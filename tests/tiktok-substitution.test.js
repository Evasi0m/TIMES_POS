import { describe, it, expect } from 'vitest';
import {
  normalizeSkuToken,
  isTikTokSkuMismatch,
  isSkuSubstitution,
  defaultSubstitutionMeta,
  resolveSubstitutionForConfirm,
  lineNeedsSubstitutionAck,
  orderHasSubstitutionBlock,
} from '../src/components/pos/tiktok-confirm/helpers.js';
import {
  saleLineIsSubstitution,
  saleLineSubstitutionCaption,
} from '../src/lib/sale-line-display.js';

const tiktokLine = {
  seller_sku: 'AE-1600HX-3A',
  sku_name: 'Casio AE-1600',
};

describe('normalizeSkuToken', () => {
  it('uppercases and strips spaces', () => {
    expect(normalizeSkuToken(' ae-1600hx-3a ')).toBe('AE-1600HX-3A');
  });
});

describe('isTikTokSkuMismatch', () => {
  it('returns false when pick matches TikTok seller_sku', () => {
    expect(isTikTokSkuMismatch(tiktokLine, { name: 'AE-1600HX-3A' })).toBe(false);
  });

  it('returns true when pick differs from TikTok seller_sku', () => {
    expect(isTikTokSkuMismatch(tiktokLine, { name: 'AE-1500WHX-1AVDF' })).toBe(true);
  });

  it('isSkuSubstitution alias matches isTikTokSkuMismatch', () => {
    const pick = { name: 'AE-1500WHX-1AVDF' };
    expect(isSkuSubstitution(tiktokLine, pick)).toBe(isTikTokSkuMismatch(tiktokLine, pick));
  });
});

describe('defaultSubstitutionMeta', () => {
  it('defaults substitute off even when SKU mismatches', () => {
    expect(defaultSubstitutionMeta()).toEqual({ substitute: false, note: '' });
    expect(defaultSubstitutionMeta(tiktokLine, { name: 'AE-1500WHX-1AVDF' })).toEqual({
      substitute: false,
      note: '',
    });
  });
});

describe('lineNeedsSubstitutionAck', () => {
  const pick = { name: 'AE-1500WHX-1AVDF' };

  it('true when SKU mismatch and not opted in', () => {
    expect(lineNeedsSubstitutionAck(tiktokLine, pick, { substitute: false })).toBe(true);
    expect(lineNeedsSubstitutionAck(tiktokLine, pick, undefined)).toBe(true);
  });

  it('false when user opted in', () => {
    expect(lineNeedsSubstitutionAck(tiktokLine, pick, { substitute: true })).toBe(false);
  });

  it('false when SKUs match', () => {
    expect(lineNeedsSubstitutionAck(tiktokLine, { name: 'AE-1600HX-3A' }, {})).toBe(false);
  });
});

describe('orderHasSubstitutionBlock', () => {
  const items = [{ id: 10, seller_sku: 'AE-1600HX-3A', quantity: 1 }];
  const picks = { 10: { id: 2, name: 'AE-1500WHX-1AVDF' } };

  it('blocks when any line needs substitution ack', () => {
    expect(orderHasSubstitutionBlock(items, picks, {})).toBe(true);
    expect(orderHasSubstitutionBlock(items, picks, { 10: { substitute: false } })).toBe(true);
  });

  it('allows when user opted in', () => {
    expect(orderHasSubstitutionBlock(items, picks, { 10: { substitute: true } })).toBe(false);
  });
});

describe('resolveSubstitutionForConfirm', () => {
  const pick = { name: 'AE-1500WHX-1AVDF' };

  it('sends substitute=true only on explicit opt-in', () => {
    expect(resolveSubstitutionForConfirm(tiktokLine, pick, { substitute: true, note: 'เปลี่ยนสี' }))
      .toEqual({ substitute: true, substitution_note: 'เปลี่ยนสี' });
  });

  it('sends substitute=false when not opted in even on mismatch', () => {
    expect(resolveSubstitutionForConfirm(tiktokLine, pick, { substitute: false, note: '' }))
      .toEqual({ substitute: false, substitution_note: null });
    expect(resolveSubstitutionForConfirm(tiktokLine, pick, undefined))
      .toEqual({ substitute: false, substitution_note: null });
  });

  it('sends substitute=false when SKUs match even if meta says true', () => {
    expect(resolveSubstitutionForConfirm(tiktokLine, { name: 'AE-1600HX-3A' }, { substitute: true }))
      .toEqual({ substitute: false, substitution_note: null });
  });
});

describe('saleLineSubstitutionCaption', () => {
  it('builds caption for substituted lines', () => {
    const line = {
      is_sku_substitution: true,
      seller_sku: 'AE-1600HX-3A',
      product_name: 'AE-1500WHX-1AVDF',
      substitution_note: 'ลูกค้าเปลี่ยนใจ',
    };
    expect(saleLineIsSubstitution(line)).toBe(true);
    expect(saleLineSubstitutionCaption(line)).toBe(
      'TikTok: AE-1600HX-3A → ส่งจริง: AE-1500WHX-1AVDF (ลูกค้าเปลี่ยนใจ)',
    );
  });
});
