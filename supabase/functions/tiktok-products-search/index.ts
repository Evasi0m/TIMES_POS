// Search TikTok Shop catalog SKUs for receive-stock mirror matching.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  countTikTokListings,
  getValidAccessToken,
  searchTikTokProducts,
  serviceClient,
} from '../_shared/tiktok-client.ts';

const MAX_PAGES = 20;
const PAGE_SIZE = 50;

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
    let countOnly = false;
    try {
      const body = await req.json();
      query = String(body?.query || '').trim();
      if (body?.page_size) pageSize = Math.min(Math.max(Number(body.page_size) || 50, 1), 50);
      // 20 × 50 = 1000 listings for the full-catalog load (was 10 → 500).
      if (body?.max_pages) maxPages = Math.min(Math.max(Number(body.max_pages) || 5, 1), MAX_PAGES);
      countOnly = body?.count_only === true;
      if (Array.isArray(body?.query_variants)) {
        queryVariants = body.query_variants
          .map((v: unknown) => String(v || '').trim())
          .filter((v: string) => v.length >= 2);
      }
    } catch { /* empty body ok */ }

    if (countOnly) {
      const total = await countTikTokListings(accessToken, shopCipher);
      return new Response(JSON.stringify({
        ok: true,
        catalog: { total, max_products: MAX_PAGES * PAGE_SIZE },
      }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const stats = { products: 0, pages: 0, truncated: false } as {
      products: number; pages: number; truncated: boolean; total?: number;
    };
    const skus = await searchTikTokProducts(accessToken, shopCipher, {
      query,
      queryVariants,
      pageSize,
      maxPages,
      stats,
    });
    const catalog = !query && !queryVariants.length
      ? { ...stats, max_products: maxPages * pageSize }
      : undefined;
    return new Response(JSON.stringify({ ok: true, skus, catalog }), {
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
