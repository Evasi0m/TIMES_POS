// Search TikTok Shop catalog SKUs for receive-stock mirror matching.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  getValidAccessToken,
  searchTikTokProducts,
  serviceClient,
} from '../_shared/tiktok-client.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const supa = serviceClient();
    const { accessToken, shopCipher } = await getValidAccessToken(supa);

    let query = '';
    let pageSize = 50;
    let queryVariants: string[] = [];
    let maxPages = 5;
    try {
      const body = await req.json();
      query = String(body?.query || '').trim();
      if (body?.page_size) pageSize = Math.min(Math.max(Number(body.page_size) || 50, 1), 50);
      if (body?.max_pages) maxPages = Math.min(Math.max(Number(body.max_pages) || 5, 1), 10);
      if (Array.isArray(body?.query_variants)) {
        queryVariants = body.query_variants
          .map((v: unknown) => String(v || '').trim())
          .filter((v: string) => v.length >= 2);
      }
    } catch { /* empty body ok */ }

    const skus = await searchTikTokProducts(accessToken, shopCipher, {
      query,
      queryVariants,
      pageSize,
      maxPages,
    });
    return new Response(JSON.stringify({ ok: true, skus }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'search failed';
    // Return 200 so supabase-js invoke exposes `{ ok, error }` in `data` (not generic non-2xx).
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
