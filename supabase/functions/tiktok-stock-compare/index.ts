// Compare POS stock vs TikTok Shop for all mapped SKUs (super admin).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  fetchTikTokWarehouses,
  getTikTokSkuQuantity,
  getValidAccessToken,
  serviceClient,
} from '../_shared/tiktok-client.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CONCURRENCY = 5;

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

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

interface MappingRow {
  tiktok_sku_id: string;
  product_id: number;
  seller_sku: string | null;
  tiktok_product_id: string | null;
  tiktok_product_name: string | null;
  warehouse_id: string | null;
  sync_enabled: boolean;
  products: { id: number; name: string; barcode: string | null; current_stock: number } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const denied = await requireSuperAdmin(req);
  if (denied) return denied;

  try {
    const supa = serviceClient();
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

    const { data: mappings, error: mapErr } = await supa
      .from('tiktok_product_mappings')
      .select(`
        tiktok_sku_id, product_id, seller_sku, tiktok_product_id,
        tiktok_product_name, warehouse_id, sync_enabled,
        products!inner(id, name, barcode, current_stock)
      `)
      .not('product_id', 'is', null)
      .order('seller_sku');

    if (mapErr) throw new Error(mapErr.message);

    const rows = await mapPool(
      (mappings || []) as MappingRow[],
      CONCURRENCY,
      async (m) => {
        const product = m.products;
        const posStock = Math.max(0, Number(product?.current_stock ?? 0));
        const warehouseId = String(m.warehouse_id || defaultWarehouse || '');
        const tiktokProductId = String(m.tiktok_product_id || '');
        const tiktokSkuId = String(m.tiktok_sku_id || '');

        if (!m.sync_enabled) {
          return {
            product_id: m.product_id,
            product_name: product?.name || '',
            barcode: product?.barcode || null,
            seller_sku: m.seller_sku,
            tiktok_sku_id: tiktokSkuId,
            tiktok_product_id: tiktokProductId || null,
            pos_stock: posStock,
            tiktok_stock: null,
            diff: null,
            sync_enabled: false,
            warehouse_id: warehouseId || null,
            status: 'sync_disabled',
            error: 'sync ปิดอยู่',
          };
        }

        if (!tiktokProductId || !tiktokSkuId) {
          return {
            product_id: m.product_id,
            product_name: product?.name || '',
            barcode: product?.barcode || null,
            seller_sku: m.seller_sku,
            tiktok_sku_id: tiktokSkuId,
            tiktok_product_id: tiktokProductId || null,
            pos_stock: posStock,
            tiktok_stock: null,
            diff: null,
            sync_enabled: true,
            warehouse_id: warehouseId || null,
            status: 'missing_product_id',
            error: 'ขาด tiktok_product_id',
          };
        }

        if (!warehouseId) {
          return {
            product_id: m.product_id,
            product_name: product?.name || '',
            barcode: product?.barcode || null,
            seller_sku: m.seller_sku,
            tiktok_sku_id: tiktokSkuId,
            tiktok_product_id: tiktokProductId,
            pos_stock: posStock,
            tiktok_stock: null,
            diff: null,
            sync_enabled: true,
            warehouse_id: null,
            status: 'tiktok_error',
            error: 'ไม่พบ warehouse',
          };
        }

        try {
          const tiktokStock = await getTikTokSkuQuantity(
            accessToken, shopCipher, tiktokProductId, tiktokSkuId, warehouseId,
          );
          const diff = posStock - tiktokStock;
          return {
            product_id: m.product_id,
            product_name: product?.name || '',
            barcode: product?.barcode || null,
            seller_sku: m.seller_sku,
            tiktok_sku_id: tiktokSkuId,
            tiktok_product_id: tiktokProductId,
            pos_stock: posStock,
            tiktok_stock: tiktokStock,
            diff,
            sync_enabled: true,
            warehouse_id: warehouseId,
            status: 'ok',
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'TikTok API error';
          return {
            product_id: m.product_id,
            product_name: product?.name || '',
            barcode: product?.barcode || null,
            seller_sku: m.seller_sku,
            tiktok_sku_id: tiktokSkuId,
            tiktok_product_id: tiktokProductId,
            pos_stock: posStock,
            tiktok_stock: null,
            diff: null,
            sync_enabled: true,
            warehouse_id: warehouseId,
            status: 'tiktok_error',
            error: msg,
          };
        }
      },
    );

    const okRows = rows.filter(r => r.status === 'ok');
    const matched = okRows.filter(r => r.diff === 0).length;
    const mismatched = okRows.filter(r => r.diff !== 0).length;
    const errors = rows.filter(r => r.status !== 'ok').length;

    return new Response(JSON.stringify({
      ok: true,
      scanned_at: new Date().toISOString(),
      rows,
      summary: {
        total: rows.length,
        matched,
        mismatched,
        errors,
      },
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'compare failed';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
