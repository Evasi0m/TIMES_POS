// Server-only: fetch TikTok product description for TIMES_SHOP (called with POS service role).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders, jsonResponse } from '../_shared/shop-cors.ts';
import {
  fetchTikTokProductDescription,
  getValidAccessToken,
  serviceClient,
} from '../_shared/tiktok-client.ts';

function isBridgeAuthorized(req: Request): boolean {
  const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  const bridgeSecret = (Deno.env.get('SHOP_POS_BRIDGE_SECRET') || '').trim();
  if (serviceKey && auth === serviceKey) return true;
  if (bridgeSecret && auth === bridgeSecret) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) });

  if (!isBridgeAuthorized(req)) {
    return jsonResponse(req, { ok: false, error: 'forbidden', message: 'service role required' }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const productId = String(body.tiktok_product_id || '').trim();
    if (!productId) {
      return jsonResponse(req, {
        ok: false,
        error: 'validation_failed',
        message: 'tiktok_product_id required',
      });
    }

    const supa = serviceClient();
    const { accessToken, shopCipher } = await getValidAccessToken(supa);
    const description = await fetchTikTokProductDescription(accessToken, shopCipher, productId);

    return jsonResponse(req, {
      ok: true,
      tiktok_product_id: productId,
      description,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed';
    return jsonResponse(req, { ok: false, error: 'server_error', message: msg });
  }
});
