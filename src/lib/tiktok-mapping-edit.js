// Unlink or move a TikTok SKU onto a different POS model, then push stock.

import { sb } from './supabase-client.js';
import { bestSameModelProduct } from './tiktok-mapping-model.js';
import {
  mirrorStockAfterManualAdjust,
  syncTikTokProductImages,
  upsertTiktokInventoryMapping,
} from './tiktok-inventory-sync.js';
import { notifyTiktokMappingChanged } from './tiktok-mapping-bus.js';

export async function findSameModelProduct(sellerSku, excludeProductId) {
  const sku = String(sellerSku || '').trim().replace(/[%_]/g, '');
  if (sku.length < 3) return null;
  const { data, error } = await sb.from('products')
    .select('id, name, barcode, current_stock')
    .ilike('name', `${sku}%`)
    .limit(20);
  if (error) throw error;
  return bestSameModelProduct(sku, data || [], { excludeId: excludeProductId });
}

/**
 * Drop the TikTok-sourced photo of these products (manual / brand-site photos
 * are kept), then re-fetch from whatever SKUs are still mapped to them. Without
 * this an unlinked or moved SKU leaves its photo stuck on the wrong model.
 * Best-effort: a photo failure never fails the mapping change.
 */
async function refreshTikTokPhotos(productIds) {
  const ids = [...new Set((productIds || []).filter(id => id != null))];
  if (!ids.length) return;
  try {
    for (const id of ids) {
      const { error } = await sb.rpc('clear_tiktok_product_image', { p_product_id: id });
      if (error) throw error;
    }
    await syncTikTokProductImages({ productIds: ids, limit: 10 });
  } catch (e) {
    console.warn('[TikTok mapping] photo refresh failed:', e?.message || e);
  }
}

export async function unlinkTikTokMapping(tiktokSkuId, productId) {
  const id = String(tiktokSkuId || '').trim();
  if (!id) throw new Error('ไม่พบ TikTok SKU');
  const { error } = await sb.from('tiktok_product_mappings').delete().eq('tiktok_sku_id', id);
  if (error) throw error;
  await refreshTikTokPhotos([productId]);
  if (productId != null) notifyTiktokMappingChanged(productId);
}

/** Move this TikTok SKU onto another POS product and mirror both products' stock. */
export async function reassignTikTokMapping({ mapping, fromProductId, toProduct }) {
  if (!mapping?.tiktok_sku_id || !toProduct?.id) throw new Error('ข้อมูลจับคู่ไม่ครบ');
  if (Number(fromProductId) === Number(toProduct.id)) {
    return { skipped: true, reason: 'same_product' };
  }
  await upsertTiktokInventoryMapping({
    productId: toProduct.id,
    // Photo is re-fetched below for the SKU's real image; don't carry over a
    // possibly-wrong cached one.
    tiktokMapping: { ...mapping, image_url: null, sku_image_url: null },
  });
  await refreshTikTokPhotos([fromProductId, toProduct.id]);
  notifyTiktokMappingChanged(fromProductId);
  notifyTiktokMappingChanged(toProduct.id);
  const productIds = [...new Set([fromProductId, toProduct.id].filter(id => id != null))];
  return mirrorStockAfterManualAdjust({
    auditId: Date.now(),
    productIds,
  });
}

/** Push current POS stock to every TikTok SKU mapped to these products. */
export async function pushPosStockToTikTok(productIds) {
  const ids = [...new Set((productIds || []).filter(id => id != null))];
  if (!ids.length) return { skipped: true, targetCount: 0 };
  return mirrorStockAfterManualAdjust({
    auditId: Date.now(),
    productIds: ids,
  });
}
