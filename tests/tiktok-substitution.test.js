import { describe, it, expect } from 'vitest';
import {
  normalizeSkuToken,
  isTikTokSkuMismatch,
  isSkuSubstitution,
  isGenericTikTokSku,
  needsMatchConfirm,
  defaultSubstitutionMeta,
  resolveSubstitutionForConfirm,
  lineNeedsSubstitutionAck,
  lineNeedsResolutionAck,
  orderHasSubstitutionBlock,
  orderNeedsResolutionAck,
  orderNeedsMatchConfirm,
  needsSubstitutionOption,
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

describe('isGenericTikTokSku', () => {
  it('detects DEFAULT basket labels', () => {
    expect(isGenericTikTokSku({ sku_name: 'DEFAULT', seller_sku: '' })).toBe(true);
    expect(isGenericTikTokSku({ sku_name: 'Casio Watch', seller_sku: 'W-218HD-1A' })).toBe(false);
  });
});

describe('isTikTokSkuMismatch', () => {
  it('returns false when pick matches TikTok seller_sku', () => {
    expect(isTikTokSkuMismatch(tiktokLine, { name: 'AE-1600HX-3A' })).toBe(false);
  });

  it('returns false when POS has whitelisted distributor suffix (same model)', () => {
    expect(isTikTokSkuMismatch(
      { seller_sku: 'AMW-870DA-2A1' },
      { name: 'AMW-870DA-2A1VDF' },
    )).toBe(false);
    expect(isTikTokSkuMismatch(
      { seller_sku: 'GA-2100-1A1' },
      { name: 'GA-2100-1A1DR' },
    )).toBe(false);
    expect(isTikTokSkuMismatch(
      { seller_sku: 'EF-539D-1A' },
      { name: 'EF-539D-1AVUDF' },
    )).toBe(false);
    expect(isTikTokSkuMismatch(
      { seller_sku: 'MTP-VD01D-1B' },
      { name: 'MTP-VD01D-1BVUDF' },
    )).toBe(false);
  });

  it('returns false when matchConfirmed for generic basket', () => {
    const item = { id: 1, sku_name: 'DEFAULT', seller_sku: '', tiktok_sku_id: 'sku-123' };
    const pick = { id: 2, name: 'W-218HD-1AVDF' };
    expect(isTikTokSkuMismatch(item, pick)).toBe(true);
    expect(isTikTokSkuMismatch(item, pick, { 1: true })).toBe(false);
  });

  it('returns true when pick is a genuinely different model', () => {
    expect(isTikTokSkuMismatch(tiktokLine, { name: 'AE-1500WHX-1AVDF' })).toBe(true);
  });

  it('isSkuSubstitution alias matches isTikTokSkuMismatch', () => {
    const pick = { name: 'AE-1500WHX-1AVDF' };
    expect(isSkuSubstitution(tiktokLine, pick)).toBe(isTikTokSkuMismatch(tiktokLine, pick));
  });
});

describe('needsMatchConfirm', () => {
  it('requires confirm for DEFAULT basket with a pick', () => {
    const item = { id: 1, sku_name: 'DEFAULT', seller_sku: '' };
    const pick = { id: 2, name: 'W-218HD-1AVDF' };
    expect(needsMatchConfirm(item, pick)).toBe(true);
    expect(needsMatchConfirm(item, pick, { 1: true })).toBe(false);
  });

  it('does not require confirm when suffix matches', () => {
    const item = { id: 1, seller_sku: 'EF-539D-1A' };
    const pick = { id: 2, name: 'EF-539D-1AVUDF' };
    expect(needsMatchConfirm(item, pick)).toBe(false);
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

describe('lineNeedsResolutionAck', () => {
  const pick = { id: 2, name: 'AE-1500WHX-1AVDF' };
  const genericItem = { id: 1, sku_name: 'DEFAULT', seller_sku: '' };
  const genericPick = { id: 3, name: 'W-218HD-1AVDF' };

  it('true for true SKU mismatch without resolution', () => {
    expect(lineNeedsResolutionAck(tiktokLine, pick, {})).toBe(true);
  });

  it('false when substitute opted in', () => {
    expect(lineNeedsResolutionAck(tiktokLine, pick, { substitute: true })).toBe(false);
  });

  it('true for DEFAULT basket without match confirm or substitute', () => {
    expect(lineNeedsResolutionAck(genericItem, genericPick, {})).toBe(true);
  });

  it('false for DEFAULT when match confirmed', () => {
    expect(lineNeedsResolutionAck(genericItem, genericPick, {}, { 1: true })).toBe(false);
  });

  it('false for DEFAULT when substitute opted in', () => {
    expect(lineNeedsResolutionAck(genericItem, genericPick, { substitute: true })).toBe(false);
  });

  it('false for suffix match auto-OK', () => {
    const item = { id: 1, seller_sku: 'EF-539D-1A' };
    expect(lineNeedsResolutionAck(item, { id: 2, name: 'EF-539D-1AVUDF' }, {})).toBe(false);
  });
});

describe('needsSubstitutionOption', () => {
  it('offers subst for generic and true mismatch', () => {
    const generic = { id: 1, sku_name: 'DEFAULT', seller_sku: '' };
    expect(needsSubstitutionOption(generic, { id: 2, name: 'W-218HD-1AVDF' }, {})).toBe(true);
    expect(needsSubstitutionOption(tiktokLine, { id: 2, name: 'AE-1500WHX-1AVDF' }, {})).toBe(true);
  });

  it('hidden when already resolved', () => {
    const generic = { id: 1, sku_name: 'DEFAULT', seller_sku: '' };
    expect(needsSubstitutionOption(generic, { id: 2, name: 'W-218HD-1AVDF' }, { substitute: true })).toBe(false);
    expect(needsSubstitutionOption(generic, { id: 2, name: 'W-218HD-1AVDF' }, {}, { 1: true })).toBe(false);
  });
});

describe('lineNeedsSubstitutionAck', () => {
  const pick = { id: 2, name: 'AE-1500WHX-1AVDF' };

  it('true when SKU mismatch and not opted in', () => {
    expect(lineNeedsSubstitutionAck(tiktokLine, pick, { substitute: false })).toBe(true);
    expect(lineNeedsSubstitutionAck(tiktokLine, pick, undefined)).toBe(true);
  });

  it('false when user opted in', () => {
    expect(lineNeedsSubstitutionAck(tiktokLine, pick, { substitute: true })).toBe(false);
  });

  it('false when SKUs match', () => {
    expect(lineNeedsSubstitutionAck(tiktokLine, { id: 2, name: 'AE-1600HX-3A' }, {})).toBe(false);
  });

  it('true for generic basket pending resolution', () => {
    const item = { id: 1, sku_name: 'DEFAULT', seller_sku: '' };
    expect(lineNeedsSubstitutionAck(item, { id: 2, name: 'W-218HD-1AVDF' }, {})).toBe(true);
    expect(lineNeedsSubstitutionAck(item, { id: 2, name: 'W-218HD-1AVDF' }, { substitute: true })).toBe(false);
  });
});

describe('orderNeedsResolutionAck', () => {
  it('blocks DEFAULT until match confirm or substitute', () => {
    const items = [{ id: 1, sku_name: 'DEFAULT', seller_sku: '' }];
    const picks = { 1: { id: 2, name: 'W-218HD-1AVDF' } };
    expect(orderNeedsResolutionAck(items, picks, {})).toBe(true);
    expect(orderNeedsResolutionAck(items, picks, { 1: { substitute: true } })).toBe(false);
    expect(orderNeedsResolutionAck(items, picks, {}, { 1: true })).toBe(false);
  });

  it('blocks true mismatch until substitute', () => {
    const items = [{ id: 10, seller_sku: 'AE-1600HX-3A', quantity: 1 }];
    const picks = { 10: { id: 2, name: 'AE-1500WHX-1AVDF' } };
    expect(orderNeedsResolutionAck(items, picks, {})).toBe(true);
    expect(orderNeedsResolutionAck(items, picks, { 10: { substitute: true } })).toBe(false);
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

describe('orderNeedsMatchConfirm', () => {
  it('blocks when generic line not confirmed', () => {
    const items = [{ id: 1, sku_name: 'DEFAULT', seller_sku: '' }];
    const picks = { 1: { id: 2, name: 'W-218HD-1AVDF' } };
    expect(orderNeedsMatchConfirm(items, picks)).toBe(true);
    expect(orderNeedsMatchConfirm(items, picks, { 1: true })).toBe(false);
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

  it('sends substitute=true for generic DEFAULT when opted in', () => {
    const item = { id: 1, sku_name: 'DEFAULT', seller_sku: '' };
    expect(resolveSubstitutionForConfirm(item, pick, { substitute: true, note: 'เปลี่ยนสี' }))
      .toEqual({ substitute: true, substitution_note: 'เปลี่ยนสี' });
  });

  it('sends substitute=false when match confirmed on generic basket', () => {
    const item = { id: 1, sku_name: 'DEFAULT', seller_sku: '' };
    expect(resolveSubstitutionForConfirm(item, pick, { substitute: true }, { 1: true }))
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
      'สั่ง: AE-1600HX-3A → ส่งจริง: AE-1500WHX-1AVDF (ลูกค้าเปลี่ยนใจ)',
    );
  });
});
