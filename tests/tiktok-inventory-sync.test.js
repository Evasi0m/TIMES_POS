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
  mappingNeedsProductId,
  pickCatalogSkuForMapping,
  formatMirrorSkipToast,
  formatReturnMirrorToast,
  formatReturnVoidMirrorToast,
  normalizeSyncOperation,
  persistResolvedRowMappings,
} from '../src/lib/tiktok-mirror-helpers.js';
import {
  notifyTiktokMappingChanged,
  subscribeTiktokMappingChanges,
} from '../src/lib/tiktok-mapping-bus.js';

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

  it('includes sync_operation return when requested', () => {
    const line = buildSyncLine({
      receiveOrderId: 88,
      productId: 44,
      posStockAfter: 3,
      mapping: { tiktok_sku_id: 's', tiktok_product_id: 'p' },
      syncOperation: 'return',
    });
    expect(line.sync_operation).toBe('return');
    expect(line.receive_order_id).toBe(88);
  });

  it('includes sync_operation return_void when requested', () => {
    const line = buildSyncLine({
      receiveOrderId: 99,
      productId: 55,
      posStockAfter: 2,
      mapping: { tiktok_sku_id: 's', tiktok_product_id: 'p' },
      syncOperation: 'return_void',
    });
    expect(line.sync_operation).toBe('return_void');
    expect(line.receive_order_id).toBe(99);
  });

  it('includes sync_operation sale_edit when requested', () => {
    const line = buildSyncLine({
      saleOrderId: 502,
      productId: 45,
      posStockAfter: 1,
      mapping: { tiktok_sku_id: 's', tiktok_product_id: 'p' },
      syncOperation: 'sale_edit',
    });
    expect(line.sync_operation).toBe('sale_edit');
  });
});

describe('normalizeSyncOperation', () => {
  it('passes through known ops including return and return_void', () => {
    expect(normalizeSyncOperation('return')).toBe('return');
    expect(normalizeSyncOperation('return_void')).toBe('return_void');
    expect(normalizeSyncOperation('sale_edit')).toBe('sale_edit');
    expect(normalizeSyncOperation('manual_adjust')).toBe('manual_adjust');
  });
  it('defaults unknown to receive', () => {
    expect(normalizeSyncOperation('bogus')).toBe('receive');
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

describe('mappingNeedsProductId', () => {
  it('true when sku id present but product id missing', () => {
    expect(mappingNeedsProductId({ tiktok_sku_id: 'a', tiktok_product_id: null })).toBe(true);
    expect(mappingNeedsProductId({ tiktok_sku_id: 'a' })).toBe(true);
  });
  it('false when product id present or no sku id', () => {
    expect(mappingNeedsProductId({ tiktok_sku_id: 'a', tiktok_product_id: 'p' })).toBe(false);
    expect(mappingNeedsProductId({ product_id: 1 })).toBe(false);
  });
});

describe('pickCatalogSkuForMapping', () => {
  const skus = [
    { tiktok_sku_id: 'sku-1', tiktok_product_id: 'prod-1', seller_sku: 'GBD-300-9' },
    { tiktok_sku_id: 'sku-2', tiktok_product_id: 'prod-2', seller_sku: 'GA-2100-1A' },
  ];

  it('matches by tiktok_sku_id first', () => {
    const m = pickCatalogSkuForMapping({ tiktok_sku_id: 'sku-1', seller_sku: 'OTHER' }, skus);
    expect(m?.tiktok_product_id).toBe('prod-1');
  });

  it('falls back to seller_sku', () => {
    const m = pickCatalogSkuForMapping({ tiktok_sku_id: 'missing', seller_sku: 'GA-2100-1A' }, skus);
    expect(m?.tiktok_product_id).toBe('prod-2');
  });

  it('returns null when no match', () => {
    expect(pickCatalogSkuForMapping({ tiktok_sku_id: 'x', seller_sku: 'y' }, skus)).toBeNull();
  });
});

describe('formatMirrorSkipToast', () => {
  it('warns when not connected', () => {
    const t = formatMirrorSkipToast({ reason: 'not_connected' });
    expect(t.type).toBe('warning');
    expect(t.msg).toContain('เชื่อมต่อ');
  });

  it('errors on incomplete mapping', () => {
    const t = formatMirrorSkipToast({ reason: 'incomplete_mapping', incompleteCount: 2 });
    expect(t.type).toBe('error');
    expect(t.msg).toContain('2 รายการ');
  });

  it('warns when no mapping', () => {
    const t = formatMirrorSkipToast({ reason: 'no_mapping' });
    expect(t.type).toBe('warning');
    expect(t.msg).toContain('ยังไม่ได้จับคู่');
  });

  it('warns when void has no target', () => {
    const t = formatMirrorSkipToast({ reason: 'void_no_target' });
    expect(t.type).toBe('warning');
    expect(t.msg).toContain('ไม่เคย mirror');
  });

  it('uses return label when context is return', () => {
    const t = formatMirrorSkipToast({ reason: 'no_mapping', context: 'return' });
    expect(t.msg).toContain('TikTok return mirror');
    expect(t.msg).not.toContain('sale mirror');
  });

  it('warns when return void has no target', () => {
    const t = formatMirrorSkipToast({ reason: 'return_void_no_target', context: 'return' });
    expect(t.type).toBe('warning');
    expect(t.msg).toContain('ไม่เคย mirror');
  });
});

describe('formatReturnMirrorToast', () => {
  it('formats success with return label', () => {
    const { msg, isError } = formatReturnMirrorToast([{ ok: true, product_id: 1 }]);
    expect(isError).toBe(false);
    expect(msg).toContain('return mirror');
  });
});

describe('formatReturnVoidMirrorToast', () => {
  it('formats success with return void label', () => {
    const { msg, isError } = formatReturnVoidMirrorToast([{ ok: true, product_id: 1 }]);
    expect(isError).toBe(false);
    expect(msg).toContain('return void mirror');
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

describe('persistResolvedRowMappings', () => {
  it('persists rows with product id and tiktok match', async () => {
    const calls = [];
    const result = await persistResolvedRowMappings([
      { product: { id: 1 }, tiktok_sku: { tiktok_sku_id: 'a' } },
      { product: { id: 2 }, tiktok_skip: true, tiktok_sku: { tiktok_sku_id: 'b' } },
      { product: { id: 3 } },
    ], {
      persist: async (pid, row) => { calls.push({ pid, row }); },
    });
    expect(result).toEqual({ failed: 0, persisted: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].pid).toBe(1);
  });

  it('counts failures and invokes onError', async () => {
    const errors = [];
    const result = await persistResolvedRowMappings([
      { product: { id: 10 }, tiktok_mapping: { tiktok_sku_id: 'x' } },
      { product: { id: 11 }, tiktok_sku: { tiktok_sku_id: 'y' } },
    ], {
      persist: async (pid) => {
        if (pid === 11) throw new Error('fail');
      },
      onError: (e, ctx) => errors.push({ e, ctx }),
    });
    expect(result).toEqual({ failed: 1, persisted: 1 });
    expect(errors).toHaveLength(1);
    expect(errors[0].ctx.productId).toBe(11);
  });
});

describe('subscribeTiktokMappingChanges', () => {
  it('notifies listeners with productId', () => {
    const seen = [];
    const unsub = subscribeTiktokMappingChanges((id) => seen.push(id));
    notifyTiktokMappingChanged(42);
    notifyTiktokMappingChanged(null);
    unsub();
    notifyTiktokMappingChanged(99);
    expect(seen).toEqual([42]);
  });
});
