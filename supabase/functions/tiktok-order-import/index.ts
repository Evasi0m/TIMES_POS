// Manual / internal order import by tiktok_order_id.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { serviceClient } from '../_shared/tiktok-client.ts';
import { importTikTokOrder } from '../_shared/tiktok-order-import.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  let body: { tiktok_order_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const orderId = body.tiktok_order_id?.trim();
  if (!orderId) {
    return new Response(JSON.stringify({ error: 'tiktok_order_id required' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await importTikTokOrder(serviceClient(), orderId);
    return new Response(JSON.stringify(result), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'import_failed';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
