// Public invoice request form submit — token + buyer fields.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { serviceClient } from '../_shared/tiktok-client.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Simple in-memory rate limit per IP (best-effort in edge isolate)
const hits = new Map<string, { count: number; at: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const row = hits.get(ip);
  if (!row || now - row.at > 60_000) {
    hits.set(ip, { count: 1, at: now });
    return false;
  }
  row.count += 1;
  return row.count > 10;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  let body: {
    token?: string;
    buyer_name?: string;
    buyer_tax_id?: string;
    buyer_address?: string;
    buyer_branch?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const token = body.token?.trim();
  if (!token) {
    return new Response(JSON.stringify({ error: 'token required' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  const supa = serviceClient();
  const { data, error } = await supa.rpc('submit_tiktok_invoice_buyer', {
    p_token: token,
    p_buyer: {
      buyer_name: body.buyer_name,
      buyer_tax_id: body.buyer_tax_id,
      buyer_address: body.buyer_address,
      buyer_branch: body.buyer_branch || 'สำนักงานใหญ่',
    },
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, tax_invoice_no: data?.tax_invoice_no }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
