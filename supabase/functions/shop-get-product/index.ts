// Product listing PDP for TIMES_SHOP — TikTok-synced storefront_products (all SKUs per listing).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders, jsonResponse } from '../_shared/shop-cors.ts';
import {
  ensureCatalogFreshForRead,
  queryStorefrontListing,
} from '../_shared/shop-catalog.ts';
import { serviceClient } from '../_shared/tiktok-client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) });

  try {
    const supa = serviceClient();
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch { /* empty */ }

    const tiktokSkuId = String(body.tiktok_sku_id || '').trim();
    const tiktokProductId = String(body.tiktok_product_id || '').trim();
    if (!tiktokSkuId && !tiktokProductId) {
      return jsonResponse(req, {
        ok: false,
        error: 'validation_failed',
        message: 'tiktok_sku_id or tiktok_product_id required',
      });
    }

    await ensureCatalogFreshForRead(supa);
    const result = await queryStorefrontListing(supa, {
      tiktok_sku_id: tiktokSkuId,
      tiktok_product_id: tiktokProductId,
    });
    return jsonResponse(req, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'product failed';
    return jsonResponse(req, { ok: false, error: msg });
  }
});
