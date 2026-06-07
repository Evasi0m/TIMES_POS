// Refresh TikTok tokens — cron or manual (service role).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { refreshAccessToken, serviceClient } from '../_shared/tiktok-client.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const supa = serviceClient();
  const { data: row } = await supa.from('tiktok_tokens').select('*').eq('id', 1).maybeSingle();
  if (!row?.refresh_token) {
    return new Response(JSON.stringify({ ok: false, reason: 'not_connected' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const refreshed = await refreshAccessToken(row.refresh_token);
    const now = new Date();
    const accessExpire = Number(refreshed.access_token_expire_in || 0);
    const refreshExpire = Number(refreshed.refresh_token_expire_in || 0);
    await supa.from('tiktok_tokens').update({
      access_token: String(refreshed.access_token || row.access_token),
      refresh_token: String(refreshed.refresh_token || row.refresh_token),
      access_token_expires_at: accessExpire
        ? new Date(now.getTime() + accessExpire * 1000).toISOString()
        : row.access_token_expires_at,
      refresh_token_expires_at: refreshExpire
        ? new Date(now.getTime() + refreshExpire * 1000).toISOString()
        : row.refresh_token_expires_at,
      last_refresh_error: null,
      updated_at: now.toISOString(),
    }).eq('id', 1);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'refresh_failed';
    await supa.from('tiktok_tokens').update({
      last_refresh_error: msg,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
