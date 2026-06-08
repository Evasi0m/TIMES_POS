// TikTok webhook — handles order status, address, package, and return events.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { getEnv, serviceClient, verifyTikTokWebhook } from '../_shared/tiktok-client.ts';
import { importTikTokOrder } from '../_shared/tiktok-order-import.ts';

// Webhook topic types (TikTok 202309 numeric "type").
const ORDER_STATUS_CHANGE = 1;
const RECIPIENT_ADDRESS_UPDATE = 3;
const PACKAGE_UPDATE = 4;
const CANCELLATION_STATUS_CHANGE = 11;
const RETURN_STATUS_CHANGE = 12;

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const { appKey, appSecret, webhookSecret } = getEnv();

  const verified = await verifyTikTokWebhook(rawBody, req.headers, {
    appKey,
    appSecret,
    webhookSecret,
  });
  if (!verified) return new Response('Invalid signature', { status: 401 });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const type = Number(payload.type ?? payload.event_type ?? 0);
  let data = payload.data;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = payload; }
  }
  if (!data || typeof data !== 'object') data = payload;
  const row = data as Record<string, unknown>;
  const orderId = String(
    row.order_id || row.orderId || payload.order_id || payload.orderId || '',
  );

  const ok = (extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ ok: true, type, ...extra }), {
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    const supa = serviceClient();

    switch (type) {
      case ORDER_STATUS_CHANGE:
      case RECIPIENT_ADDRESS_UPDATE:
      case PACKAGE_UPDATE:
      case CANCELLATION_STATUS_CHANGE: {
        if (!orderId) return ok({ skipped: 'no_order_id' });
        const result = await importTikTokOrder(supa, orderId);
        return ok({ result });
      }
      case RETURN_STATUS_CHANGE: {
        // Re-import to refresh status; returns table sync runs via tiktok-returns-sync.
        if (orderId) {
          try { await importTikTokOrder(supa, orderId); } catch { /* ignore */ }
        }
        try {
          await supa.functions.invoke('tiktok-returns-sync', {
            body: { order_id: orderId },
          });
        } catch { /* returns sync best-effort */ }
        return ok({ forwarded: 'returns-sync' });
      }
      default: {
        if (orderId) {
          const result = await importTikTokOrder(supa, orderId);
          return ok({ result });
        }
        return ok({ skipped: 'unhandled_type' });
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'import_failed';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
