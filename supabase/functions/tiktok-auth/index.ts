// OAuth callback — exchange code, store tokens, redirect to POS.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  exchangeAuthCode,
  fetchAuthorizedShops,
  getEnv,
  serviceClient,
} from '../_shared/tiktok-client.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const { posRedirect } = getEnv();
  const fail = (msg: string) =>
    Response.redirect(`${posRedirect}&tiktok_error=${encodeURIComponent(msg)}`, 302);

  if (!code) return fail('missing_code');

  try {
    const supa = serviceClient();
    if (state) {
      const { data: row } = await supa.from('tiktok_tokens').select('oauth_state, oauth_state_at').eq('id', 1).maybeSingle();
      const valid = row?.oauth_state === state && row?.oauth_state_at
        && (Date.now() - new Date(row.oauth_state_at).getTime() < 5 * 60 * 1000);
      if (!valid) return fail('invalid_state');
    }

    const tokenData = await exchangeAuthCode(code);
    const accessToken = String(tokenData.access_token || '');
    const refreshToken = String(tokenData.refresh_token || '');
    const accessExpire = Number(tokenData.access_token_expire_in || 0);
    const refreshExpire = Number(tokenData.refresh_token_expire_in || 0);
    const now = new Date();

    const shops = await fetchAuthorizedShops(accessToken);
    const shop = shops[0] || {};
    const shopCipher = String(shop.cipher || shop.shop_cipher || '');
    const shopId = String(shop.id || shop.shop_id || '');
    const shopName = String(shop.name || shop.shop_name || 'TikTok Shop');

    await supa.from('tiktok_tokens').upsert({
      id: 1,
      access_token: accessToken,
      refresh_token: refreshToken,
      shop_cipher: shopCipher || null,
      shop_id: shopId || null,
      shop_name: shopName,
      access_token_expires_at: accessExpire
        ? new Date(now.getTime() + accessExpire * 1000).toISOString()
        : null,
      refresh_token_expires_at: refreshExpire
        ? new Date(now.getTime() + refreshExpire * 1000).toISOString()
        : null,
      oauth_state: null,
      oauth_state_at: null,
      last_error: null,
      connected_at: now.toISOString(),
      updated_at: now.toISOString(),
    });

    return Response.redirect(posRedirect, 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'auth_failed';
    try {
      const supa = serviceClient();
      await supa.from('tiktok_tokens').upsert({
        id: 1,
        last_error: msg,
        updated_at: new Date().toISOString(),
      });
    } catch { /* ignore */ }
    return fail(msg);
  }
});
