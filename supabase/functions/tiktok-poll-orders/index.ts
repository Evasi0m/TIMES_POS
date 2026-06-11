// Poll — import/resync TikTok orders. Supports single-order sync by ID.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { serviceClient } from '../_shared/tiktok-client.ts';
import {
  discoverPollOrders,
  discoverStaleToShipInDb,
  importTikTokOrder,
  type ImportResult,
} from '../_shared/tiktok-order-import.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cap imports per invocation so we never blow the edge function wall-clock limit.
// Awaiting orders are processed first, so "ที่จะจัดส่ง" always lands even if capped.
const MAX_PER_RUN = 60;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const supa = serviceClient();
  const results: unknown[] = [];

  let hours = 168;
  let resync = false;
  let orderId = '';
  try {
    const body = await req.json();
    if (body?.hours != null) hours = Math.min(Math.max(Number(body.hours) || 168, 1), 720);
    if (body?.resync === true) resync = true;
    if (body?.order_id) orderId = String(body.order_id).trim();
  } catch { /* empty body */ }

  try {
    // Single-order sync (debug / manual): always re-import.
    if (orderId) {
      const r = await importTikTokOrder(supa, orderId);
      return new Response(JSON.stringify({ ok: true, single: true, result: r }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    const [{ awaiting, others }, staleToShip] = await Promise.all([
      discoverPollOrders(supa, hours),
      discoverStaleToShipInDb(supa),
    ]);
    const awaitingSet = new Set(awaiting);
    const staleSet = new Set(staleToShip);

    // Always refresh orders still sitting in the POS confirm queue so a buyer
    // cancellation lands within one poll even when the realtime webhook is down:
    // importTikTokOrder voids CANCELLED orders, so they drop off the queue. Any
    // other status (incl. already shipped / completed) stays 'pending' and keeps
    // showing — the cashier must still record it into POS before it leaves the
    // queue. The queue is small, and these ids are forced even if order
    // discovery didn't surface them.
    const { data: pendingRows } = await supa.from('sale_orders')
      .select('tiktok_order_id')
      .eq('channel', 'tiktok')
      .eq('status', 'pending')
      .not('tiktok_order_id', 'is', null);
    const pendingIds = (pendingRows || [])
      .map((r) => String((r as { tiktok_order_id: unknown }).tiktok_order_id))
      .filter(Boolean);
    const pendingSet = new Set(pendingIds);

    // Awaiting + pending first (always refreshed), then the rest — capped to
    // MAX_PER_RUN. Dedupe so a single order is never imported twice per run.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of [...awaiting, ...staleToShip, ...pendingIds, ...others]) {
      if (id && !seen.has(id)) { seen.add(id); ordered.push(id); }
    }
    let processed = 0;
    let capped = false;
    const staleRefreshedIds = new Set<string>();

    for (const id of ordered) {
      if (processed >= MAX_PER_RUN) { capped = true; break; }
      // Awaiting + stale-to-ship + still-pending orders always update; other
      // existing orders only when new (unless resync).
      const forceUpdate = resync || awaitingSet.has(id) || staleSet.has(id) || pendingSet.has(id);
      if (!forceUpdate) {
        const { data: existing } = await supa.from('sale_orders')
          .select('id')
          .eq('tiktok_order_id', id)
          .maybeSingle();
        if (existing?.id) continue;
      }
      processed++;
      try {
        const r = await importTikTokOrder(supa, id);
        results.push(r);
        if (staleSet.has(id) && (r as ImportResult).action === 'updated') {
          staleRefreshedIds.add(id);
        }
      } catch (e) {
        results.push({ tiktok_order_id: id, error: e instanceof Error ? e.message : 'fail' });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      resync,
      capped,
      awaiting_found: awaiting.length,
      stale_found: staleToShip.length,
      stale_refreshed: staleRefreshedIds.size,
      scanned: ordered.length,
      processed: results.length,
      imported: results.filter((r) => (r as ImportResult).action === 'imported').length,
      updated: results.filter((r) => (r as ImportResult).action === 'updated').length,
      voided: results.filter((r) => (r as ImportResult).action === 'voided').length,
      skipped: results.filter((r) => (r as ImportResult).action === 'skipped').length,
      errors: results.filter((r) => (r as { error?: string }).error).length,
    }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'poll_failed';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
