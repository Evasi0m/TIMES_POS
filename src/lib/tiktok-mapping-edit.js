// Unlink or move a TikTok SKU onto a different POS model, then push stock.

import { sb } from './supabase-client.js';
import { bestSameModelProduct } from './tiktok-mapping-model.js';
import {
  mirrorStockAfterManualAdjust,
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

export async function unlinkTikTokMapping(tiktokSkuId, productId) {
  const id = String(tiktokSkuId || '').trim();
  if (!id) throw new Error('ไม่พบ TikTok SKU');
  const { error } = await sb.from('tiktok_product_mappings').delete().eq('tiktok_sku_id', id);
  if (error) throw error;
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
    tiktokMapping: mapping,
  });
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
