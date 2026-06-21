// Mirror POS stock → TikTok Shop (set warehouse qty = pos_stock_after).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  fetchTikTokWarehouses,
  getTikTokSkuQuantity,
  getValidAccessToken,
  serviceClient,
  updateTikTokInventoryMirror,
} from '../_shared/tiktok-client.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncItem {
  product_id: number;
  receive_order_id: number;
  tiktok_product_id: string;
  tiktok_sku_id: string;
  warehouse_id?: string;
  pos_stock_after: number;
  seller_sku?: string;
  tiktok_product_name?: string;
  skip?: boolean;
  sync_operation?: 'receive' | 'void' | 'sale' | 'sale_void' | 'sale_edit' | 'return' | 'return_void' | 'manual_adjust';
}

type SyncOp = 'receive' | 'void' | 'sale' | 'sale_void' | 'sale_edit' | 'return' | 'return_void' | 'manual_adjust';

function resolveSyncOperation(it: SyncItem): SyncOp {
  const op = it.sync_operation;
  if (
    op === 'void' || op === 'sale' || op === 'sale_void' || op === 'sale_edit'
    || op === 'return' || op === 'return_void' || op === 'manual_adjust'
  ) {
    return op;
  }
  return 'receive';
}

async function checkAlreadySynced(
  supa: ReturnType<typeof serviceClient>,
  receiveOrderId: number,
  productId: number,
  syncOp: SyncOp,
): Promise<boolean> {
  if (syncOp === 'sale_edit' || syncOp === 'manual_adjust') return false;
  const { data, error } = await supa.rpc('tiktok_inventory_already_synced', {
    p_receive_order_id: receiveOrderId,
    p_product_id: productId,
    p_sync_operation: syncOp,
  });
  if (error) {
    console.warn('[tiktok-inventory-update] already_synced check failed:', error.message);
    return false;
  }
  return data === true;
}

async function rpcOrThrow(
  supa: ReturnType<typeof serviceClient>,
  fn: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await supa.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const supa = serviceClient();
  const results: Record<string, unknown>[] = [];

  try {
    const body = await req.json();
    const items = (body?.items as SyncItem[]) || [];
    if (!items.length) {
      return new Response(JSON.stringify({ ok: false, error: 'items required' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const { accessToken, shopCipher, row } = await getValidAccessToken(supa);
    let defaultWarehouse = row.default_warehouse_id || '';

    if (!defaultWarehouse) {
      const whs = await fetchTikTokWarehouses(accessToken, shopCipher);
      defaultWarehouse = whs[0]?.id || '';
      if (defaultWarehouse) {
        await supa.from('tiktok_tokens').update({
          default_warehouse_id: defaultWarehouse,
          updated_at: new Date().toISOString(),
        }).eq('id', 1);
      }
    }

    if (!defaultWarehouse) {
      throw new Error('ไม่พบ warehouse — ตั้งค่าใน TikTok Seller Center หรือเพิ่ม Product write scope');
    }

    for (const it of items) {
      const productId = Number(it.product_id);
      const receiveOrderId = Number(it.receive_order_id);
      const posStock = Math.max(0, Math.floor(Number(it.pos_stock_after) || 0));
      const syncOp = resolveSyncOperation(it);

      if (it.skip) {
        await rpcOrThrow(supa, 'log_tiktok_inventory_sync', {
          p_receive_order_id: receiveOrderId,
          p_product_id: productId,
          p_tiktok_sku_id: it.tiktok_sku_id || null,
          p_pos_stock_after: posStock,
          p_tiktok_qty_before: null,
          p_tiktok_qty_after: null,
          p_status: 'skipped',
          p_sync_operation: syncOp,
        });
        results.push({ product_id: productId, status: 'skipped' });
        continue;
      }

      const already = await checkAlreadySynced(supa, receiveOrderId, productId, syncOp);
      if (already) {
        results.push({ product_id: productId, status: 'duplicate' });
        continue;
      }

      const tiktokProductId = String(it.tiktok_product_id || '');
      const tiktokSkuId = String(it.tiktok_sku_id || '');
      const warehouseId = String(it.warehouse_id || defaultWarehouse);

      if (!tiktokProductId || !tiktokSkuId) {
        await rpcOrThrow(supa, 'log_tiktok_inventory_sync', {
          p_receive_order_id: receiveOrderId,
          p_product_id: productId,
          p_tiktok_sku_id: tiktokSkuId || null,
          p_pos_stock_after: posStock,
          p_tiktok_qty_before: null,
          p_tiktok_qty_after: null,
          p_status: 'failed',
          p_error_message: 'missing tiktok_product_id or tiktok_sku_id',
          p_sync_operation: syncOp,
        });
        results.push({ product_id: productId, status: 'failed', error: 'missing TikTok IDs' });
        continue;
      }

      try {
        const before = await getTikTokSkuQuantity(
          accessToken, shopCipher, tiktokProductId, tiktokSkuId, warehouseId,
        );
        await updateTikTokInventoryMirror(
          accessToken, shopCipher, tiktokProductId, tiktokSkuId, warehouseId, posStock,
        );

        await rpcOrThrow(supa, 'upsert_tiktok_inventory_mapping', {
          p_tiktok_sku_id: tiktokSkuId,
          p_product_id: productId,
          p_tiktok_product_id: tiktokProductId,
          p_seller_sku: it.seller_sku || null,
          p_tiktok_product_name: it.tiktok_product_name || null,
          p_warehouse_id: warehouseId,
        });

        await rpcOrThrow(supa, 'log_tiktok_inventory_sync', {
          p_receive_order_id: receiveOrderId,
          p_product_id: productId,
          p_tiktok_sku_id: tiktokSkuId,
          p_pos_stock_after: posStock,
          p_tiktok_qty_before: before,
          p_tiktok_qty_after: posStock,
          p_status: 'success',
          p_sync_operation: syncOp,
        });

        results.push({
          product_id: productId,
          status: 'success',
          tiktok_qty_before: before,
          tiktok_qty_after: posStock,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'sync failed';
        try {
          await rpcOrThrow(supa, 'log_tiktok_inventory_sync', {
            p_receive_order_id: receiveOrderId,
            p_product_id: productId,
            p_tiktok_sku_id: tiktokSkuId,
            p_pos_stock_after: posStock,
            p_tiktok_qty_before: null,
            p_tiktok_qty_after: null,
            p_status: 'failed',
            p_error_message: msg,
            p_sync_operation: syncOp,
          });
        } catch { /* best-effort failure log */ }
        results.push({ product_id: productId, status: 'failed', error: msg });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'inventory update failed';
    return new Response(JSON.stringify({ ok: false, error: msg, results }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
