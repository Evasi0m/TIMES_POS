// Backfill product_images from TikTok Product Detail API (for AI receive / catalog mappings).
//
// Modes:
//   default          — fill products that are mapped but have no photo yet.
//   { refresh:true } — re-check every mapped product's TikTok photo against
//                      the live SKU photo: update when the seller changed it
//                      on TikTok, drop it when the SKU no longer has its own
//                      photo (old listing-main-photo fallback). Manual and
//                      brand-site photos are never touched. Run daily by cron
//                      (migration 085) and from "ดึงรูป SKU".
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  fetchTikTokProductDetail,
  fetchTikTokSkuImageUrl,
  getValidAccessToken,
  serviceClient,
} from '../_shared/tiktok-client.ts';
import {
  resolveListingSkuImageUrl,
  sameImageUrl,
} from '../_shared/tiktok-catalog-images.ts';

// Stay under Supabase's 150 s idle timeout. Listings are visited in a random
// order each run, so if one run is cut off, later runs still reach the rest.
const REFRESH_BUDGET_MS = 110_000;
const DETAIL_CONCURRENCY = 4;

type Supa = ReturnType<typeof serviceClient>;

async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function refreshAll(supa: Supa, accessToken: string, shopCipher: string) {
  const started = Date.now();
  const mappings = await selectAll<{ product_id: number; tiktok_sku_id: string; tiktok_product_id: string }>(
    (a, b) => supa.from('tiktok_product_mappings')
      .select('product_id, tiktok_sku_id, tiktok_product_id')
      .not('product_id', 'is', null)
      .not('tiktok_product_id', 'is', null)
      .or('sync_enabled.is.null,sync_enabled.eq.true')
      .order('tiktok_sku_id')
      .range(a, b),
  );
  const productIds = [...new Set(mappings.map(m => Number(m.product_id)))];
  const images = new Map<number, { image_url: string | null; source_brand: string | null; is_manual_override: boolean | null }>();
  for (let i = 0; i < productIds.length; i += 500) {
    const { data, error } = await supa.from('product_images')
      .select('product_id, image_url, source_brand, is_manual_override')
      .in('product_id', productIds.slice(i, i + 500));
    if (error) throw new Error(error.message);
    for (const r of data || []) images.set(Number(r.product_id), r);
  }

  // One product-detail call per listing, shared by all its SKUs.
  const listingIds = shuffle([...new Set(mappings.map(m => String(m.tiktok_product_id)))]);
  const details = new Map<string, Record<string, unknown> | null>();
  let errors = 0;
  let incomplete = false;
  for (let i = 0; i < listingIds.length; i += DETAIL_CONCURRENCY) {
    if (Date.now() - started > REFRESH_BUDGET_MS) { incomplete = true; break; }
    await Promise.all(listingIds.slice(i, i + DETAIL_CONCURRENCY).map(async (id) => {
      try {
        details.set(id, await fetchTikTokProductDetail(accessToken, shopCipher, id));
      } catch (e) {
        errors++;
        details.set(id, null);
        console.warn('[tiktok-image-refresh] detail failed', id, e);
      }
    }));
  }

  // Desired photo per product: first of its mapped SKUs (by sku id) that
  // has its own photo. Unknown when any of its listings failed to load.
  const desired = new Map<number, string | null>();
  const unknown = new Set<number>();
  for (const m of mappings) {
    const pid = Number(m.product_id);
    const detail = details.get(String(m.tiktok_product_id));
    if (detail === undefined || detail === null) { unknown.add(pid); continue; }
    if (desired.get(pid)) continue;
    desired.set(pid, resolveListingSkuImageUrl(detail, String(m.tiktok_sku_id)) || null);
  }

  let added = 0, updated = 0, cleared = 0, unchanged = 0, skipped = 0;
  for (const pid of productIds) {
    if (unknown.has(pid) && !desired.get(pid)) { skipped++; continue; }
    const want = desired.get(pid) || null;
    const cur = images.get(pid);
    const curUrl = cur?.image_url || null;
    if (cur?.is_manual_override) { skipped++; continue; }
    // Brand-site photo (casio/seiko/…): keep it; TikTok only fills gaps.
    if (curUrl && cur?.source_brand && cur.source_brand !== 'tiktok') { skipped++; continue; }
    try {
      if (want) {
        if (sameImageUrl(curUrl, want)) { unchanged++; continue; }
        const { error } = await supa.rpc('apply_tiktok_product_image', {
          p_product_id: pid, p_image_url: want,
        });
        if (error) throw new Error(error.message);
        if (curUrl) updated++; else added++;
      } else if (curUrl && cur?.source_brand === 'tiktok') {
        const { error } = await supa.from('product_images')
          .delete()
          .eq('product_id', pid)
          .eq('source_brand', 'tiktok')
          .eq('is_manual_override', false);
        if (error) throw new Error(error.message);
        cleared++;
      } else {
        unchanged++;
      }
    } catch (e) {
      errors++;
      console.warn('[tiktok-image-refresh] write failed', pid, e);
    }
  }

  return {
    ok: true,
    mode: 'refresh',
    products: productIds.length,
    listings: listingIds.length,
    added, updated, cleared, unchanged, skipped, errors,
    incomplete,
    // Shape shared with the default mode for the existing toast.
    synced: added + updated,
    checked: productIds.length,
    no_image: cleared,
  };
}

/** Refresh deletes photos, so only cron (service role) or an admin may run it. */
async function callerMayRefresh(req: Request): Promise<boolean> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload?.role === 'service_role') return true;
  } catch { return false; }
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
  const { data, error } = await userClient.rpc('is_admin');
  return !error && data === true;
}

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

/** Same rule as get_tiktok_mappings_needing_images, scoped to these products. */
async function mappingsNeedingImagesFor(
  supa: ReturnType<typeof serviceClient>,
  productIds: number[],
) {
  const { data: maps, error } = await supa.from('tiktok_product_mappings')
    .select('product_id, tiktok_sku_id, tiktok_product_id, seller_sku')
    .in('product_id', productIds)
    .not('tiktok_product_id', 'is', null)
    .or('sync_enabled.is.null,sync_enabled.eq.true')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`mappings: ${error.message}`);
  const { data: imgs, error: imgErr } = await supa.from('product_images')
    .select('product_id, image_url, status, is_manual_override')
    .in('product_id', productIds);
  if (imgErr) throw new Error(`product_images: ${imgErr.message}`);
  const covered = new Set(
    (imgs || [])
      .filter(r => r.is_manual_override || (r.status === 'found' && (r.image_url || '').trim()))
      .map(r => Number(r.product_id)),
  );
  return (maps || []).filter(m => !covered.has(Number(m.product_id)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const supa = serviceClient();
    const { accessToken, shopCipher } = await getValidAccessToken(supa);

    let limit = 100;
    let productIds: number[] | undefined;
    let refresh = false;
    try {
      const body = await req.json();
      refresh = body?.refresh === true;
      if (body?.limit) limit = Math.min(Math.max(Number(body.limit) || 100, 1), 200);
      if (Array.isArray(body?.product_ids)) {
        productIds = body.product_ids
          .map((id: unknown) => Number(id))
          .filter((id: number) => Number.isFinite(id) && id > 0);
      }
    } catch { /* empty body ok */ }

    if (refresh) {
      if (!(await callerMayRefresh(req))) {
        return new Response(JSON.stringify({ ok: false, error: 'Only admin' }), {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
        });
      }
      const result = await refreshAll(supa, accessToken, shopCipher);
      return new Response(JSON.stringify(result), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    type MappingRow = {
      product_id: number;
      tiktok_sku_id: string;
      tiktok_product_id: string;
      seller_sku?: string;
    };
    let mappings: MappingRow[];
    if (productIds?.length) {
      // Filter by the requested products in the DB. The RPC orders every
      // mapping missing a photo shop-wide and applies its limit first, so
      // newer unrelated rows could push the requested ones out.
      mappings = await mappingsNeedingImagesFor(supa, productIds);
    } else {
      mappings = (await rpcOrThrow(supa, 'get_tiktok_mappings_needing_images', {
        p_limit: limit,
      })) as MappingRow[];
    }

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
