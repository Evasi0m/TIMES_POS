// Manual / cron trigger — sync TikTok Shop catalog → storefront_products.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders, jsonResponse } from '../_shared/shop-cors.ts';
import {
  needsCatalogSync,
  needsUnitsSoldRefresh,
  refreshStorefrontUnitsSold,
  runCasioBackfillBatches,
  runImageBackfillBatches,
  syncStorefrontFromTikTok,
} from '../_shared/shop-catalog.ts';
import { serviceClient } from '../_shared/tiktok-client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) });

  try {
    const body = req.method === 'POST'
      ? await req.json().catch(() => ({}))
      : {};
    const forceSync = body?.force_sync === true;
    const imageBatches = Math.min(Math.max(Number(body?.image_batches) || 3, 1), 6);
    const casioBatches = Math.min(Math.max(Number(body?.casio_batches) || 15, 1), 30);

    const supa = serviceClient();
    let sync: { upserted: number; skipped?: string } = { upserted: 0, skipped: 'cache_fresh' };
    let unitsSold = { updated: 0, skipped: 'fresh' as string | undefined };
    if (forceSync || await needsCatalogSync(supa)) {
      sync = await syncStorefrontFromTikTok(supa);
      unitsSold = { updated: 0 };
    } else if (await needsUnitsSoldRefresh(supa)) {
      unitsSold = await refreshStorefrontUnitsSold(supa);
    } else {
      unitsSold = { updated: 0, skipped: 'fresh' };
    }
    const casio = await runCasioBackfillBatches(supa, casioBatches);
    const images = await runImageBackfillBatches(supa, imageBatches);
    return jsonResponse(req, {
      ok: true,
      ...sync,
      units_sold_updated: unitsSold.updated,
      units_sold_skipped: unitsSold.skipped,
      casio_batches: casio.batches,
      casio_remaining: casio.remaining,
      image_batches: images.batches,
      images_remaining: images.remaining,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'sync failed';
    return jsonResponse(req, { ok: false, error: msg });
  }
});
