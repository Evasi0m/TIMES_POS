// Backfill product_images from TikTok Product Detail API (for AI receive / catalog mappings).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  fetchTikTokSkuImageUrl,
  getValidAccessToken,
  serviceClient,
} from '../_shared/tiktok-client.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    let limit = 100;
    try {
      const body = await req.json();
      if (body?.limit) limit = Math.min(Math.max(Number(body.limit) || 100, 1), 200);
    } catch { /* empty body ok */ }

    const mappings = (await rpcOrThrow(supa, 'get_tiktok_mappings_needing_images', {
      p_limit: limit,
    })) as Array<{
      product_id: number;
      tiktok_sku_id: string;
      tiktok_product_id: string;
      seller_sku?: string;
    }>;

    let synced = 0;
    let noImage = 0;
    let errors = 0;
    const productCache = new Map<string, string | undefined>();

    for (const m of mappings || []) {
      const productId = m.tiktok_product_id;
      const skuId = m.tiktok_sku_id;
      if (!productId || !skuId || m.product_id == null) {
        noImage++;
        continue;
      }
      try {
        const cacheKey = `${productId}:${skuId}`;
        let imageUrl = productCache.get(cacheKey);
        if (imageUrl === undefined) {
          imageUrl = await fetchTikTokSkuImageUrl(
            accessToken,
            shopCipher,
            productId,
            skuId,
          ) || '';
          productCache.set(cacheKey, imageUrl);
        }
        if (!imageUrl) {
          noImage++;
          continue;
        }
        await rpcOrThrow(supa, 'apply_tiktok_product_image', {
          p_product_id: m.product_id,
          p_image_url: imageUrl,
        });
        synced++;
      } catch (e) {
        console.warn('[tiktok-product-image-backfill] failed', m.product_id, e);
        errors++;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      synced,
      no_image: noImage,
      errors,
      checked: (mappings || []).length,
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
