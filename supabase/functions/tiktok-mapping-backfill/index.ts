// One-shot backfill tiktok_product_id for mappings created before mirror flow.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  getValidAccessToken,
  searchTikTokProducts,
  serviceClient,
  type TikTokSkuInventory,
} from '../_shared/tiktok-client.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MappingRow {
  tiktok_sku_id: string;
  product_id: number;
  seller_sku: string | null;
  tiktok_product_name: string | null;
}

function pickCatalogMatch(row: MappingRow, skus: TikTokSkuInventory[]) {
  const skuId = String(row.tiktok_sku_id || '');
  const seller = String(row.seller_sku || '').trim();
  if (skuId) {
    const byId = skus.find(s => String(s.tiktok_sku_id) === skuId);
    if (byId?.tiktok_product_id) return byId;
  }
  if (seller) {
    const bySeller = skus.find(s => String(s.seller_sku || '').trim() === seller);
    if (bySeller?.tiktok_product_id) return bySeller;
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const supa = serviceClient();
    const { accessToken, shopCipher } = await getValidAccessToken(supa);

    let limit = 30;
    try {
      const body = await req.json();
      if (body?.limit) limit = Math.min(Math.max(Number(body.limit) || 30, 1), 50);
    } catch { /* empty body ok */ }

    const { data: rows, error } = await supa
      .from('tiktok_product_mappings')
      .select('tiktok_sku_id, product_id, seller_sku, tiktok_product_name')
      .is('tiktok_product_id', null)
      .eq('sync_enabled', true)
      .limit(limit);

    if (error) throw error;

    let healed = 0;
    let failed = 0;
    const details: Record<string, unknown>[] = [];

    const catalog = await searchTikTokProducts(accessToken, shopCipher, { maxPages: 10 });

    for (const row of (rows || []) as MappingRow[]) {
      try {
        const match = pickCatalogMatch(row, catalog);
        if (!match?.tiktok_product_id) {
          failed++;
          details.push({ tiktok_sku_id: row.tiktok_sku_id, status: 'not_found' });
          continue;
        }
        await rpcOrThrow(supa, 'upsert_tiktok_inventory_mapping', {
          p_tiktok_sku_id: row.tiktok_sku_id,
          p_product_id: row.product_id,
          p_tiktok_product_id: match.tiktok_product_id,
          p_seller_sku: row.seller_sku || match.seller_sku,
          p_tiktok_product_name: row.tiktok_product_name || match.product_name,
          p_warehouse_id: match.warehouse_id || null,
        });
        healed++;
        details.push({
          tiktok_sku_id: row.tiktok_sku_id,
          status: 'healed',
          tiktok_product_id: match.tiktok_product_id,
        });
      } catch (e) {
        failed++;
        details.push({
          tiktok_sku_id: row.tiktok_sku_id,
          status: 'error',
          error: e instanceof Error ? e.message : 'failed',
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      total: (rows || []).length,
      healed,
      failed,
      catalog_size: catalog.length,
      details,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'backfill failed';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
