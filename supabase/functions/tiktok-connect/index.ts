// Start OAuth — admin-only, redirects to TikTok authorize URL.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { buildAuthorizeUrl, getEnv } from '../_shared/tiktok-client.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const auth = req.headers.get('Authorization');
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { supabaseUrl, serviceRole } = getEnv();
  const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const { data: isAdmin, error: adminErr } = await userClient.rpc('is_admin');
  if (adminErr || !isAdmin) {
    return new Response(JSON.stringify({ error: 'Admin only' }), {
      status: 403,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const state = crypto.randomUUID();
  const adminClient = createClient(supabaseUrl, serviceRole);
  await adminClient.from('tiktok_tokens').upsert({
    id: 1,
    oauth_state: state,
    oauth_state_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const authorizeUrl = buildAuthorizeUrl(state);
  if (req.method === 'GET') {
    return Response.redirect(authorizeUrl, 302);
  }
  return new Response(JSON.stringify({ url: authorizeUrl }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
