// verify-export-password — server-side password check for stock CSV export gate.
//
// Verifies the caller's password without refreshing the browser session
// (avoids MFA re-check / ProductsView unmount when signInWithPassword runs client-side).
//
// POST JSON: { password }
// Auth: verify_jwt = true — email is taken from JWT, not the request body.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return json({ ok: false, error: 'missing_authorization' }, 401);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user?.email) {
    return json({ ok: false, error: 'invalid_jwt' }, 401);
  }
  const email = userRes.user.email;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_json' }, 400);
  }

  const password = String(body.password || '');
  if (!password) {
    return json({ ok: false, error: 'password_required' }, 400);
  }

  const verifyClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await verifyClient.auth.signInWithPassword({ email, password });
  if (error) {
    return json({ ok: false, error: 'invalid_password', message: error.message }, 401);
  }

  return json({ ok: true });
});
