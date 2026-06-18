// Public catalog for TIMES_SHOP — reads TikTok-synced storefront_products (NOT POS products).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders, jsonResponse } from '../_shared/shop-cors.ts';
import {
  ensureCatalogFreshForRead,
  queryStorefrontCatalog,
} from '../_shared/shop-catalog.ts';
import { serviceClient } from '../_shared/tiktok-client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) });

  try {
    const supa = serviceClient();
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch { /* empty body ok */ }

    await ensureCatalogFreshForRead(supa);

    const result = await queryStorefrontCatalog(supa, {
      page: Number(body.page) || 1,
      page_size: Number(body.page_size) || 24,
      q: String(body.q || ''),
      sort: String(body.sort || 'newest'),
      series: String(body.series || ''),
      sub_type: String(body.sub_type || ''),
      strap_material: String(body.strap_material || ''),
      dial_color: String(body.dial_color || ''),
      price_min: Number(body.price_min) || 0,
      price_max: Number(body.price_max) || 0,
      include_facets: body.include_facets === true,
      include_items: body.include_items !== false,
      group_by: String(body.group_by || 'product') === 'sku' ? 'sku' : 'product',
    });

    return jsonResponse(req, result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'catalog failed';
    return jsonResponse(req, { ok: false, error: msg });
  }
});
