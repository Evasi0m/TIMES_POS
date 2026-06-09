import { describe, it, expect } from 'vitest';
import {
  buildSyncLine,
  isTikTokLineReady,
  countTikTokMirrorReady,
  formatMirrorToast,
  formatVoidMirrorToast,
  formatVoidMirrorProgressToast,
  voidMirrorToastDurationMs,
  shouldPersistTiktokMatch,
  formatTikTokApiError,
  tiktokSkuDisplayLabel,
  mappingRowFromTiktokSku,
} from '../src/lib/tiktok-mirror-helpers.js';

describe('isTikTokLineReady', () => {
  it('ready when skipped', () => {
    expect(isTikTokLineReady({ tiktok_skip: true })).toBe(true);
  });
  it('ready when sku or mapping present', () => {
    expect(isTikTokLineReady({ tiktok_sku: { tiktok_sku_id: 'a' } })).toBe(true);
    expect(isTikTokLineReady({ tiktok_mapping: { tiktok_sku_id: 'b' } })).toBe(true);
  });
  it('not ready when mirror required but unmatched', () => {
    expect(isTikTokLineReady({ tiktok_skip: false })).toBe(false);
  });
});

describe('countTikTokMirrorReady', () => {
  it('counts only non-skipped lines', () => {
    const lines = [
      { tiktok_skip: true },
      { tiktok_sku: { tiktok_sku_id: 'a' } },
      { tiktok_skip: false },
    ];
    expect(countTikTokMirrorReady(lines)).toEqual({ ready: 1, total: 2 });
  });
});

describe('formatTikTokApiError', () => {
  it('maps not connected to Thai hint', () => {
    expect(formatTikTokApiError('TikTok not connected')).toContain('เชื่อมต่อ TikTok Shop');
  });
  it('passes through TikTok API code messages', () => {
    expect(formatTikTokApiError('[120527] Invalid parameter')).toContain('[120527]');
  });
});

describe('formatMirrorToast', () => {
  it('summarizes success skip and fail', () => {
    const { msg, isError } = formatMirrorToast([
      { status: 'success' },
      { status: 'skipped' },
      { status: 'failed' },
    ]);
    expect(msg).toContain('สำเร็จ 1');
    expect(msg).toContain('ข้าม 1');
    expect(msg).toContain('ล้มเหลว 1');
    expect(isError).toBe(true);
  });
});

describe('formatVoidMirrorToast', () => {
  it('uses void mirror label', () => {
    const { msg } = formatVoidMirrorToast([{ status: 'success' }]);
    expect(msg).toContain('TikTok void mirror');
    expect(msg).toContain('สำเร็จ 1');
  });
});

describe('formatVoidMirrorProgressToast', () => {
  it('formats multi-SKU progress message', () => {
    expect(formatVoidMirrorProgressToast(14)).toBe('กำลัง sync TikTok 14 รายการ...');
  });
  it('formats single SKU', () => {
    expect(formatVoidMirrorProgressToast(1)).toBe('กำลัง sync TikTok 1 รายการ...');
  });
});

describe('voidMirrorToastDurationMs', () => {
  it('scales duration with SKU count', () => {
    expect(voidMirrorToastDurationMs(14)).toBeGreaterThan(voidMirrorToastDurationMs(1));
    expect(voidMirrorToastDurationMs(14)).toBeLessThanOrEqual(20000);
  });
});

describe('shouldPersistTiktokMatch', () => {
  it('persists when product and sku present', () => {
    expect(shouldPersistTiktokMatch(42, { tiktok_sku: { tiktok_sku_id: 'a' } })).toBe(true);
    expect(shouldPersistTiktokMatch(42, { tiktok_mapping: { tiktok_sku_id: 'b' } })).toBe(true);
  });

  it('skips without product, skip flag, or sku', () => {
    expect(shouldPersistTiktokMatch(null, { tiktok_sku: { tiktok_sku_id: 'a' } })).toBe(false);
    expect(shouldPersistTiktokMatch(42, { tiktok_skip: true, tiktok_sku: { tiktok_sku_id: 'a' } })).toBe(false);
    expect(shouldPersistTiktokMatch(42, {})).toBe(false);
  });
});

describe('buildSyncLine', () => {
  it('includes sync_operation void when requested', () => {
    const line = buildSyncLine({
      receiveOrderId: 99,
      productId: 42,
      posStockAfter: 5,
      mapping: {
        tiktok_sku_id: 'sku-1',
        tiktok_product_id: 'prod-1',
        warehouse_id: 'wh-1',
        seller_sku: 'GA-2100-4A',
        tiktok_product_name: 'G-Shock',
      },
      syncOperation: 'void',
    });
    expect(line.sync_operation).toBe('void');
    expect(line.pos_stock_after).toBe(5);
    expect(line.tiktok_sku_id).toBe('sku-1');
  });

  it('defaults sync_operation to receive', () => {
    const line = buildSyncLine({
      receiveOrderId: 1,
      productId: 2,
      posStockAfter: 10,
      tiktokSku: { tiktok_sku_id: 'a', tiktok_product_id: 'b' },
    });
    expect(line.sync_operation).toBe('receive');
  });

  it('includes sync_operation sale when requested', () => {
    const line = buildSyncLine({
      saleOrderId: 500,
      productId: 42,
      posStockAfter: 0,
      mapping: {
        tiktok_sku_id: 'sku-1',
        tiktok_product_id: 'prod-1',
      },
      syncOperation: 'sale',
    });
    expect(line.sync_operation).toBe('sale');
    expect(line.receive_order_id).toBe(500);
  });

  it('includes sync_operation sale_void when requested', () => {
    const line = buildSyncLine({
      saleOrderId: 501,
      productId: 43,
      posStockAfter: 2,
      mapping: { tiktok_sku_id: 's', tiktok_product_id: 'p' },
      syncOperation: 'sale_void',
    });
    expect(line.sync_operation).toBe('sale_void');
  });
});

describe('mappingRowFromTiktokSku', () => {
  it('builds mapping row from catalog sku', () => {
    const row = mappingRowFromTiktokSku({
      id: 'sku-1',
      tiktok_product_id: 'prod-1',
      seller_sku: 'GA-2100-4A',
      product_name: 'G-Shock',
      warehouse_id: 'wh-1',
    }, 42);
    expect(row).toEqual({
      product_id: 42,
      tiktok_sku_id: 'sku-1',
      tiktok_product_id: 'prod-1',
      seller_sku: 'GA-2100-4A',
      tiktok_product_name: 'G-Shock',
      warehouse_id: 'wh-1',
    });
  });
  it('returns null without sku', () => {
    expect(mappingRowFromTiktokSku(null, 1)).toBeNull();
  });
});

describe('tiktokSkuDisplayLabel', () => {
  it('prefers seller_sku from catalog sku object', () => {
    expect(tiktokSkuDisplayLabel({ seller_sku: 'GA-2100-1A1', name: 'G-Shock' })).toBe('GA-2100-1A1');
  });
  it('reads seller_sku from DB mapping row', () => {
    expect(tiktokSkuDisplayLabel({ seller_sku: 'GBD-200-1', tiktok_product_name: 'Baby-G' })).toBe('GBD-200-1');
  });
  it('returns empty string for null', () => {
    expect(tiktokSkuDisplayLabel(null)).toBe('');
  });
});
