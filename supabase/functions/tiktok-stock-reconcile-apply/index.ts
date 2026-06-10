// Apply TikTok ↔ POS stock reconciliation (super admin).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function requireSuperAdmin(req: Request): Promise<Response | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_authorization' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.rpc('is_super_admin');
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: 'auth_check_failed: ' + error.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  if (data !== true) {
    return new Response(JSON.stringify({ ok: false, error: 'forbidden' }), {
      status: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
  return null;
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

interface ApplyItem {
  product_id: number;
  tiktok_sku_id: string;
  tiktok_product_id: string;
  warehouse_id?: string;
  pos_stock: number;
  tiktok_stock: number;
  target_qty?: number;
  seller_sku?: string;
  tiktok_product_name?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const denied = await requireSuperAdmin(req);
  if (denied) return denied;

  const supa = serviceClient();
  const results: Record<string, unknown>[] = [];

  try {
    const body = await req.json();
    const source = body?.source === 'tiktok' ? 'tiktok' : 'pos';
    const batchId = Number(body?.batch_id) || Date.now();
    const items = (body?.items as ApplyItem[]) || [];

    if (!items.length) {
      return new Response(JSON.stringify({ ok: false, error: 'items required' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    if (source === 'tiktok') {
      const rpcItems = items.map(it => ({
        product_id: Number(it.product_id),
        target_qty: Math.max(0, Math.floor(Number(it.target_qty ?? it.tiktok_stock ?? 0))),
        tiktok_qty_before: Math.max(0, Math.floor(Number(it.tiktok_stock ?? 0))),
      }));

      const { data: rpcResult, error: rpcErr } = await supa.rpc('reconcile_pos_stock_from_tiktok', {
        p_batch_id: batchId,
        p_items: rpcItems,
      });

      if (rpcErr) throw new Error(rpcErr.message);

      for (const it of items) {
        const pid = Number(it.product_id);
        const errRow = (rpcResult?.errors || []).find(
          (e: { product_id: number }) => Number(e.product_id) === pid,
        );
        if (errRow) {
          results.push({ product_id: pid, status: 'failed', error: errRow.error });
        } else {
          const target = Math.max(0, Math.floor(Number(it.target_qty ?? it.tiktok_stock ?? 0)));
          const posBefore = Math.max(0, Math.floor(Number(it.pos_stock ?? 0)));
          if (target === posBefore) {
            results.push({ product_id: pid, status: 'skipped' });
          } else {
            results.push({
              product_id: pid,
              status: 'success',
              pos_before: posBefore,
              pos_after: target,
            });
          }
        }
      }

      return new Response(JSON.stringify({
        ok: true,
        source,
        batch_id: batchId,
        results,
        summary: {
          success: results.filter(r => r.status === 'success').length,
          skipped: results.filter(r => r.status === 'skipped').length,
          failed: results.filter(r => r.status === 'failed').length,
          rpc: rpcResult,
        },
      }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // source = pos → mirror POS qty to TikTok
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
      throw new Error('ไม่พบ warehouse — ตั้งค่าใน TikTok Seller Center');
    }

    for (const it of items) {
      const productId = Number(it.product_id);
      const posStock = Math.max(0, Math.floor(Number(it.pos_stock ?? 0)));
      const tiktokProductId = String(it.tiktok_product_id || '');
      const tiktokSkuId = String(it.tiktok_sku_id || '');
      const warehouseId = String(it.warehouse_id || defaultWarehouse);

      if (!tiktokProductId || !tiktokSkuId) {
        await rpcOrThrow(supa, 'log_tiktok_inventory_sync', {
          p_receive_order_id: batchId,
          p_product_id: productId,
          p_tiktok_sku_id: tiktokSkuId || null,
          p_pos_stock_after: posStock,
          p_tiktok_qty_before: null,
          p_tiktok_qty_after: null,
          p_status: 'failed',
          p_error_message: 'missing tiktok_product_id or tiktok_sku_id',
          p_sync_operation: 'reconcile',
        });
        results.push({ product_id: productId, status: 'failed', error: 'missing TikTok IDs' });
        continue;
      }

      try {
        const before = await getTikTokSkuQuantity(
          accessToken, shopCipher, tiktokProductId, tiktokSkuId, warehouseId,
        );

        if (before === posStock) {
          results.push({ product_id: productId, status: 'skipped', tiktok_qty_before: before });
          continue;
        }

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
          p_receive_order_id: batchId,
          p_product_id: productId,
          p_tiktok_sku_id: tiktokSkuId,
          p_pos_stock_after: posStock,
          p_tiktok_qty_before: before,
          p_tiktok_qty_after: posStock,
          p_status: 'success',
          p_sync_operation: 'reconcile',
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
            p_receive_order_id: batchId,
            p_product_id: productId,
            p_tiktok_sku_id: tiktokSkuId,
            p_pos_stock_after: posStock,
            p_tiktok_qty_before: null,
            p_tiktok_qty_after: null,
            p_status: 'failed',
            p_error_message: msg,
            p_sync_operation: 'reconcile',
          });
        } catch { /* best-effort */ }
        results.push({ product_id: productId, status: 'failed', error: msg });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      source,
      batch_id: batchId,
      results,
      summary: {
        success: results.filter(r => r.status === 'success').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        failed: results.filter(r => r.status === 'failed').length,
      },
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'reconcile apply failed';
    return new Response(JSON.stringify({ ok: false, error: msg, results }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
