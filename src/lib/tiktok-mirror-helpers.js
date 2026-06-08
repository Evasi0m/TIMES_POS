// Pure helpers for TikTok mirror receive flow (no Supabase import).

/** Build a tiktok_product_mappings-shaped row from a catalog SKU pick. */
export function mappingRowFromTiktokSku(sku, productId) {
  if (!sku || productId == null) return null;
  return {
    product_id: productId,
    tiktok_sku_id: sku.tiktok_sku_id || sku.id,
    tiktok_product_id: sku.tiktok_product_id,
    seller_sku: sku.seller_sku || sku.name || sku.barcode,
    tiktok_product_name: sku.product_name || sku.name,
    warehouse_id: sku.warehouse_id || null,
  };
}

/** Human-readable TikTok seller SKU from a catalog sku object or DB mapping row. */
export function tiktokSkuDisplayLabel(skuOrMapping) {
  if (!skuOrMapping) return '';
  return skuOrMapping.seller_sku
    || skuOrMapping.name
    || skuOrMapping.product_name
    || skuOrMapping.tiktok_product_name
    || '';
}

/** True when a TikTok match should be written to tiktok_product_mappings. */
export function shouldPersistTiktokMatch(productId, patch) {
  if (productId == null || patch?.tiktok_skip) return false;
  return !!(patch?.tiktok_sku || patch?.tiktok_mapping);
}

/** True when line is ready to save (matched or explicitly skipped). */
export function isTikTokLineReady(line) {
  if (!line || line.tiktok_skip) return true;
  return !!(line.tiktok_sku || line.tiktok_mapping);
}

/** Count ready lines among non-skipped mirror targets. */
export function countTikTokMirrorReady(lines) {
  const active = (lines || []).filter(l => !l.tiktok_skip);
  const ready = active.filter(isTikTokLineReady).length;
  return { ready, total: active.length };
}

/** Toast message from mirror API results. */
export function formatMirrorToast(results, { label = 'TikTok mirror' } = {}) {
  const ok = (results || []).filter(x => x.status === 'success').length;
  const fail = (results || []).filter(x => x.status === 'failed').length;
  const skip = (results || []).filter(x => x.status === 'skipped' || x.status === 'duplicate').length;
  const msg = `${label}: สำเร็จ ${ok} · ข้าม ${skip}${fail ? ` · ล้มเหลว ${fail}` : ''}`;
  return { msg, isError: fail > 0 };
}

/** Toast after void / delete receive line mirror. */
export function formatVoidMirrorToast(results) {
  return formatMirrorToast(results, { label: 'TikTok void mirror' });
}

/** Progress toast while void mirror runs (multi-SKU bills). */
export function formatVoidMirrorProgressToast(count) {
  const n = Math.max(0, Number(count) || 0);
  if (n <= 0) return 'กำลัง sync TikTok...';
  return `กำลัง sync TikTok ${n} รายการ...`;
}

/** Suggested toast duration (ms) after void mirror by SKU count. */
export function voidMirrorToastDurationMs(count, { isError = false } = {}) {
  if (isError) return 8000;
  const n = Math.max(1, Number(count) || 1);
  return Math.min(20000, 4500 + n * 900);
}

/** Build sync payload line from mapping + POS stock. */
export function buildSyncLine({
  receiveOrderId, productId, posStockAfter, mapping, tiktokSku, skipped,
  syncOperation = 'receive',
}) {
  const syncOp = syncOperation === 'void' ? 'void' : 'receive';
  if (skipped) {
    return {
      receive_order_id: receiveOrderId,
      product_id: productId,
      pos_stock_after: posStockAfter,
      skip: true,
      sync_operation: syncOp,
    };
  }
  const sku = tiktokSku || {};
  const m = mapping || {};
  return {
    receive_order_id: receiveOrderId,
    product_id: productId,
    tiktok_product_id: sku.tiktok_product_id || m.tiktok_product_id,
    tiktok_sku_id: sku.tiktok_sku_id || m.tiktok_sku_id,
    warehouse_id: sku.warehouse_id || m.warehouse_id,
    pos_stock_after: posStockAfter,
    seller_sku: sku.seller_sku || m.seller_sku,
    tiktok_product_name: sku.product_name || m.tiktok_product_name,
    skip: false,
    sync_operation: syncOp,
  };
}

/** Map common TikTok / connection errors to Thai hints. */
export function formatTikTokApiError(msg) {
  const s = String(msg || '');
  if (/TikTok not connected|not connected/i.test(s)) {
    return 'ยังไม่ได้เชื่อมต่อ TikTok Shop — ไปที่ ตั้งค่า → TikTok Shop';
  }
  if (/No refresh token|token.*expir/i.test(s)) {
    return 'Token TikTok หมดอายุ — เชื่อมต่อ TikTok Shop ใหม่ที่ ตั้งค่า';
  }
  if (/permission|scope|authorized|access denied|10500|120527/i.test(s)) {
    return `${s} — ลองเชื่อมต่อ TikTok Shop ใหม่ (ต้องมี scope Product read/write)`;
  }
  if (/non-2xx status code/i.test(s)) {
    return 'เรียก tiktok-products-search ไม่สำเร็จ — ตรวจว่า deploy function แล้วและ TikTok เชื่อมต่ออยู่';
  }
  return s || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
}
