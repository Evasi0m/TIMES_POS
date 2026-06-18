// CORS for TIMES_SHOP storefront Edge Functions.

const DEFAULT_ORIGINS = [
  'https://evasi0m.github.io',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
];

export function shopAllowedOrigins(): string[] {
  const raw = Deno.env.get('SHOP_ALLOWED_ORIGINS') || '';
  const fromEnv = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ORIGINS;
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowed = shopAllowedOrigins();
  const isLocalDev = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
  const allowOrigin = allowed.includes(origin) || isLocalDev ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

export function jsonResponse(
  req: Request,
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}
