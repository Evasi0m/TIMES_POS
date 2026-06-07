// TikTok Shop Open API client — signing, token management, API wrapper.

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const AUTH_BASE = 'https://auth.tiktok-shops.com';
export const API_BASE = 'https://open-api.tiktokglobalshop.com';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export interface TikTokTokens {
  access_token: string | null;
  refresh_token: string | null;
  shop_cipher: string | null;
  shop_id: string | null;
  shop_name: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
}

export function getEnv() {
  const appKey = Deno.env.get('TIKTOK_APP_KEY') || '';
  const appSecret = Deno.env.get('TIKTOK_APP_SECRET') || '';
  const webhookSecret = Deno.env.get('TIKTOK_WEBHOOK_SECRET') || '';
  const posRedirect = Deno.env.get('TIKTOK_POS_REDIRECT_URL')
    || 'https://evasi0m.github.io/TIMES_POS/?tiktok=connected';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return { appKey, appSecret, webhookSecret, posRedirect, supabaseUrl, serviceRole };
}

export function serviceClient(): SupabaseClient {
  const { supabaseUrl, serviceRole } = getEnv();
  return createClient(supabaseUrl, serviceRole);
}

/** HMAC-SHA256 sign per TikTok Shop Open API spec */
export async function signRequest(
  path: string,
  query: Record<string, string | number | undefined | null>,
  body: string,
  appSecret: string,
): Promise<string> {
  const params = { ...query };
  delete params.sign;
  delete (params as Record<string, unknown>).access_token;
  const keys = Object.keys(params)
    .filter(k => params[k] != null && params[k] !== '')
    .sort();
  let base = appSecret + path;
  for (const k of keys) {
    base += k + String(params[k]);
  }
  if (body) base += body;
  base += appSecret;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Verify Tiktok-Signature header: t=<ts>,s=<hmac> */
export async function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map(p => {
      const [k, v] = p.trim().split('=');
      return [k, v];
    }),
  );
  const t = parts.t;
  const s = parts.s;
  if (!t || !s) return false;
  const payload = `${t}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return expected === s;
}

export async function exchangeAuthCode(code: string): Promise<Record<string, unknown>> {
  const { appKey, appSecret } = getEnv();
  const qs = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    auth_code: code,
    grant_type: 'authorized_code',
  });
  const res = await fetch(`${AUTH_BASE}/api/v2/token/get?${qs}`);
  const json = await res.json();
  if (json?.code !== 0) {
    throw new Error(json?.message || 'Token exchange failed');
  }
  return json.data as Record<string, unknown>;
}

export async function refreshAccessToken(refreshToken: string): Promise<Record<string, unknown>> {
  const { appKey, appSecret } = getEnv();
  const qs = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${AUTH_BASE}/api/v2/token/refresh?${qs}`);
  const json = await res.json();
  if (json?.code !== 0) {
    throw new Error(json?.message || 'Token refresh failed');
  }
  return json.data as Record<string, unknown>;
}

export async function fetchAuthorizedShops(accessToken: string): Promise<Record<string, unknown>[]> {
  const path = '/authorization/202309/shops';
  const data = await apiGet(path, {}, accessToken, null);
  return (data?.shops as Record<string, unknown>[]) || [];
}

export async function getValidAccessToken(supa: SupabaseClient): Promise<{
  accessToken: string;
  shopCipher: string;
  row: TikTokTokens;
}> {
  const { data: row, error } = await supa.from('tiktok_tokens').select('*').eq('id', 1).maybeSingle();
  if (error || !row?.access_token || !row?.shop_cipher) {
    throw new Error('TikTok not connected');
  }
  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return { accessToken: row.access_token, shopCipher: row.shop_cipher, row };
  }
  if (!row.refresh_token) throw new Error('No refresh token');
  const refreshed = await refreshAccessToken(row.refresh_token);
  const accessToken = String(refreshed.access_token || '');
  const refreshToken = String(refreshed.refresh_token || row.refresh_token);
  const accessExpire = Number(refreshed.access_token_expire_in || 0);
  const refreshExpire = Number(refreshed.refresh_token_expire_in || 0);
  const now = new Date();
  const update = {
    access_token: accessToken,
    refresh_token: refreshToken,
    access_token_expires_at: accessExpire
      ? new Date(now.getTime() + accessExpire * 1000).toISOString()
      : row.access_token_expires_at,
    refresh_token_expires_at: refreshExpire
      ? new Date(now.getTime() + refreshExpire * 1000).toISOString()
      : row.refresh_token_expires_at,
    last_refresh_error: null,
    updated_at: now.toISOString(),
  };
  await supa.from('tiktok_tokens').update(update).eq('id', 1);
  return { accessToken, shopCipher: row.shop_cipher, row: { ...row, ...update } };
}

export async function apiGet(
  path: string,
  extraQuery: Record<string, string | number>,
  accessToken: string,
  shopCipher: string | null,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return apiCall('GET', path, extraQuery, accessToken, shopCipher, body);
}

export async function apiPost(
  path: string,
  extraQuery: Record<string, string | number>,
  accessToken: string,
  shopCipher: string | null,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return apiCall('POST', path, extraQuery, accessToken, shopCipher, body);
}

async function apiCall(
  method: 'GET' | 'POST',
  path: string,
  extraQuery: Record<string, string | number>,
  accessToken: string,
  shopCipher: string | null,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { appKey, appSecret } = getEnv();
  const timestamp = Math.floor(Date.now() / 1000);
  const query: Record<string, string | number> = {
    app_key: appKey,
    timestamp,
    ...extraQuery,
  };
  if (shopCipher) query.shop_cipher = shopCipher;
  const bodyStr = body ? JSON.stringify(body) : '';
  const sign = await signRequest(path, query, bodyStr, appSecret);
  query.sign = sign;
  const qs = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)]),
  );
  const url = `${API_BASE}${path}?${qs}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-tts-access-token': accessToken,
    },
    body: method === 'POST' && bodyStr ? bodyStr : undefined,
  });
  const json = await res.json();
  if (json?.code !== 0) {
    const code = json?.code != null ? `[${json.code}] ` : '';
    throw new Error(`${code}${json?.message || `TikTok API ${path} failed`}`);
  }
  return json.data as Record<string, unknown>;
}

/** OAuth authorize URL */
export function buildAuthorizeUrl(state: string): string {
  const { appKey, supabaseUrl } = getEnv();
  const redirectUri = `${supabaseUrl}/functions/v1/tiktok-auth`;
  const qs = new URLSearchParams({
    app_key: appKey,
    state,
    redirect_uri: redirectUri,
  });
  return `${AUTH_BASE}/oauth/authorize?${qs}`;
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function vatBreakdown(grandTotal: number, vatRate = 7) {
  const r = vatRate / 100;
  const g = roundMoney(grandTotal);
  if (r <= 0) return { vat: 0, exVat: g };
  const exVat = roundMoney(g / (1 + r));
  const vat = roundMoney(g - exVat);
  return { vat, exVat };
}

/** Product name fuzzy match — mirrors src/lib/fuzzy-match.js */
export function normalizeName(s: string): string {
  return String(s || '').toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
}

function levenshtein(a: string, b: string, maxDist = 12): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (a.length > b.length) { const t = a; a = b; b = t; }
  const lenA = a.length, lenB = b.length;
  if (lenB - lenA > maxDist) return maxDist + 1;
  let prev = new Array(lenA + 1);
  let curr = new Array(lenA + 1);
  for (let i = 0; i <= lenA; i++) prev[i] = i;
  for (let j = 1; j <= lenB; j++) {
    curr[0] = j;
    let rowMin = j;
    for (let i = 1; i <= lenA; i++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost);
      curr[i] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[lenA];
}

export function similarityScore(a: string, b: string): number {
  const A = normalizeName(a);
  const B = normalizeName(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const dist = levenshtein(A, B);
  const maxLen = Math.max(A.length, B.length);
  return Math.max(0, 1 - dist / maxLen);
}

// ---------------------------------------------------------------------
// SKU matching — TikTok seller_sku ↔ POS model code.
// Mirror of src/lib/fuzzy-match.js (edge can't import from src/). TikTok
// lists the bare Casio model code; POS appends a distributor suffix
// (DR/VDF/UDF). The TikTok SKU is a prefix of the POS SKU.
// ---------------------------------------------------------------------

/** Known Casio regional / warranty distributor suffixes (keep in sync
 *  with src/lib/fuzzy-match.js). Tail ∈ this set ⇒ high-confidence auto. */
export const KNOWN_SKU_SUFFIXES = new Set([
  'DR', 'VDF', 'UDF', 'ER', 'EF', 'JF', 'GF', 'A', 'JR',
  'AVDF', 'AUDF', 'VCF', 'DF', 'UD', 'SDF', 'CR', 'PR', 'VDR', 'AER',
]);

export type SkuTier = 'exact' | 'suffix' | 'prefix' | 'fuzzy' | 'none';

export interface SkuMatchResult {
  tier: SkuTier;
  score: number;
  auto: boolean;
}

/** Tier-based SKU match (order-independent). See fuzzy-match.js for docs. */
export function skuMatchTier(a: string, b: string): SkuMatchResult {
  const A = normalizeName(a);
  const B = normalizeName(b);
  if (!A || !B) return { tier: 'none', score: 0, auto: false };
  if (A === B) return { tier: 'exact', score: 1, auto: true };

  const [short, long] = A.length <= B.length ? [A, B] : [B, A];
  if (long.startsWith(short)) {
    const tail = long.slice(short.length);
    if (KNOWN_SKU_SUFFIXES.has(tail)) {
      return { tier: 'suffix', score: 0.97, auto: true };
    }
    if (/^[A-Z]{1,4}$/.test(tail)) {
      return { tier: 'prefix', score: 0.9, auto: false };
    }
  }

  const sim = similarityScore(A, B);
  if (sim >= 0.6) return { tier: 'fuzzy', score: sim, auto: false };
  return { tier: 'none', score: sim, auto: false };
}

export const IMPORT_STATUSES = new Set([
  'ON_HOLD',
  'AWAITING_SHIPMENT',
  'AWAITING_COLLECTION',
  'PARTIALLY_SHIPPING',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
]);

export const SKIP_STATUSES = new Set(['UNPAID']);
export const VOID_STATUSES = new Set(['CANCELLED']);
