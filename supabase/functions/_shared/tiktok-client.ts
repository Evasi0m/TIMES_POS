// TikTok Shop Open API client — signing, token management, API wrapper.

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  extractProductImageUrl,
  extractSkuImageUrl,
} from './tiktok-catalog-images.ts';

export const AUTH_BASE = 'https://auth.tiktok-shops.com';
export const API_BASE = 'https://open-api.tiktokglobalshop.com';

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * TikTok token endpoints return `*_expire_in` as an ABSOLUTE UTC epoch in
 * SECONDS (the instant the token expires) — not a relative "expires in N"
 * duration. Treating it as relative (now + expire_in) produced year-2082
 * expiries, which made getValidAccessToken believe the token never expires and
 * silently disabled auto-refresh. Guard both shapes so a future API that ever
 * returns a small relative duration still works.
 */
export function tiktokExpiryToISO(
  expireIn: unknown,
  nowMs: number = Date.now(),
): string | null {
  const n = Number(expireIn) || 0;
  if (n <= 0) return null;
  // ~1e9 s ≈ year 2001. TikTok's absolute epochs are ~1.7e9+; any plausible
  // relative duration in seconds is far smaller than this threshold.
  const ms = n > 1_000_000_000 ? n * 1000 : nowMs + n * 1000;
  return new Date(ms).toISOString();
}

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

async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const x = (a || '').trim().toLowerCase();
  const y = (b || '').trim().toLowerCase();
  if (x.length !== y.length || !x.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a TikTok Shop Partner webhook.
 *
 * Primary (what our order / package / return webhooks actually use):
 *   Authorization header = hex HMAC-SHA256( key=app_secret, msg=app_key + rawBody ).
 * The previous implementation only checked the TikTok-for-Developers scheme
 * (HMAC(secret, `${t}.${body}`) in a TikTok-Signature header), so every Shop
 * webhook was rejected with 401. We try the Shop scheme first, then fall back to
 * the developers scheme (signed with webhook_secret or app_secret) so either
 * configuration works. Accepting requires a valid HMAC under a real secret, so
 * supporting both schemes does not weaken security.
 */
export async function verifyTikTokWebhook(
  rawBody: string,
  headers: Headers,
  opts: { appKey: string; appSecret: string; webhookSecret?: string },
): Promise<boolean> {
  const { appKey, appSecret, webhookSecret } = opts;

  // ── TikTok Shop scheme ──────────────────────────────────────────────────
  const auth = headers.get('authorization')
    || headers.get('x-tts-signature')
    || '';
  if (auth && appKey && appSecret) {
    const expected = await hmacHex(appSecret, appKey + rawBody);
    if (timingSafeEqualHex(auth, expected)) return true;
  }

  // ── TikTok-for-Developers scheme (t=<ts>,s=<hmac>) ──────────────────────
  const sigHeader = headers.get('tiktok-signature');
  if (sigHeader) {
    const parts: Record<string, string> = {};
    for (const seg of sigHeader.split(',')) {
      const [k, v] = seg.trim().split('=');
      if (k) parts[k] = v;
    }
    if (parts.t && parts.s) {
      for (const key of [webhookSecret, appSecret]) {
        if (!key) continue;
        const expected = await hmacHex(key, `${parts.t}.${rawBody}`);
        if (timingSafeEqualHex(parts.s, expected)) return true;
      }
    }
  }
  return false;
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
    access_token_expires_at: tiktokExpiryToISO(accessExpire, now.getTime())
      ?? row.access_token_expires_at,
    refresh_token_expires_at: tiktokExpiryToISO(refreshExpire, now.getTime())
      ?? row.refresh_token_expires_at,
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

function isTikTokSkuIdQuery(q: string): boolean {
  return /^\d{10,}$/.test(String(q || '').trim());
}

/** Keep only SKUs that actually match any query variant (API may ignore seller_sku filter). */
export function filterSkusForQueries(
  skus: TikTokSkuInventory[],
  queries: string[],
  minScore = 0.5,
): TikTokSkuInventory[] {
  const qs = [...new Set(queries.map(q => String(q || '').trim()).filter(q => q.length >= 2))];
  if (!qs.length) return skus;
  const out: TikTokSkuInventory[] = [];
  const seen = new Set<string>();
  for (const s of skus) {
    if (seen.has(s.tiktok_sku_id)) continue;
    for (const q of qs) {
      if (isTikTokSkuIdQuery(q) && String(s.tiktok_sku_id) === q) {
        seen.add(s.tiktok_sku_id);
        out.push(s);
        break;
      }
    }
  }
  for (const s of skus) {
    if (seen.has(s.tiktok_sku_id)) continue;
    const code = (s.seller_sku || s.product_name || '').trim();
    if (!code) continue;
    let best = 0;
    for (const q of qs) {
      if (isTikTokSkuIdQuery(q)) continue;
      const m = skuMatchTier(q, code);
      if (m.score > best) best = m.score;
      const title = (s.product_name || '').trim();
      if (title && title !== code) {
        const m2 = skuMatchTier(q, title);
        if (m2.score > best) best = m2.score;
      }
    }
    if (best >= minScore) {
      seen.add(s.tiktok_sku_id);
      out.push(s);
    }
  }
  return out;
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

// ── Product / inventory API (mirror POS stock → TikTok) ─────────────────────

export interface TikTokSkuInventory {
  tiktok_product_id: string;
  tiktok_sku_id: string;
  seller_sku: string;
  product_name: string;
  quantity: number;
  warehouse_id?: string;
  image_url?: string;
}

/** Flatten product search results into SKU rows with current qty. */
export function flattenProductSkus(products: Record<string, unknown>[]): TikTokSkuInventory[] {
  const out: TikTokSkuInventory[] = [];
  for (const p of products) {
    const productId = String(p.id || p.product_id || '');
    const title = String(p.title || p.product_name || '');
    const productImage = extractProductImageUrl(p);
    const skus = (p.skus as Record<string, unknown>[]) || [];
    for (const sku of skus) {
      const skuId = String(sku.id || sku.sku_id || '');
      if (!skuId || !productId) continue;
      const sellerSku = String(sku.seller_sku || sku.sku_name || '');
      let qty = 0;
      let warehouseId: string | undefined;
      const inv = (sku.inventory as Record<string, unknown>[]) || [];
      for (const w of inv) {
        const wh = String(w.warehouse_id || '');
        const q = Number(w.quantity ?? w.available_stock ?? 0) || 0;
        if (!warehouseId && wh) warehouseId = wh;
        qty += q;
      }
      const imageUrl = extractSkuImageUrl(sku, productImage);
      out.push({
        tiktok_product_id: productId,
        tiktok_sku_id: skuId,
        seller_sku: sellerSku,
        product_name: title,
        quantity: qty,
        warehouse_id: warehouseId,
        ...(imageUrl ? { image_url: imageUrl } : {}),
      });
    }
  }
  return out;
}

/** Search TikTok catalog — returns flat SKU list. */
export async function searchTikTokProducts(
  accessToken: string,
  shopCipher: string,
  opts: {
    query?: string;
    queryVariants?: string[];
    pageSize?: number;
    maxPages?: number;
  } = {},
): Promise<TikTokSkuInventory[]> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 50);
  const maxPages = opts.maxPages ?? 5;
  const baseBody: Record<string, unknown> = { status: 'ACTIVATE' };

  const listPage = async (body: Record<string, unknown>, pageToken = '') => {
    const queryParams: Record<string, string | number> = { page_size: pageSize };
    if (pageToken) queryParams.page_token = pageToken;
    const data = await apiPost(
      '/product/202502/products/search',
      queryParams,
      accessToken,
      shopCipher,
      body,
    );
    const nextToken = String(
      data?.next_page_token || data?.page_token || '',
    );
    return {
      skus: flattenProductSkus((data?.products as Record<string, unknown>[]) || []),
      nextToken: nextToken && nextToken !== pageToken ? nextToken : '',
    };
  };

  const q = (opts.query || '').trim();
  const variants = [...new Set([
    ...(opts.queryVariants || []).map(v => String(v || '').trim()).filter(v => v.length >= 2),
    ...(q ? [q] : []),
  ])];

  for (const v of variants) {
    if (isTikTokSkuIdQuery(v)) continue;
    try {
      const { skus } = await listPage({ ...baseBody, seller_sku: v });
      const filtered = filterSkusForQueries(skus, variants, 0.55);
      if (filtered.length) return filtered;
    } catch { /* try next variant */ }
  }

  const skuIdQueries = variants.filter(isTikTokSkuIdQuery);
  if (skuIdQueries.length) {
    let pageToken = '';
    for (let page = 0; page < maxPages; page++) {
      const { skus, nextToken } = await listPage(baseBody, pageToken);
      for (const q of skuIdQueries) {
        const hit = skus.find(s => String(s.tiktok_sku_id) === q);
        if (hit) return [hit];
      }
      if (!nextToken) break;
      pageToken = nextToken;
    }
  }

  const needles = variants.map(s => s.toLowerCase());
  if (needles.length) {
    const matched: TikTokSkuInventory[] = [];
    const seen = new Set<string>();
    let pageToken = '';
    for (let page = 0; page < maxPages; page++) {
      const { skus, nextToken } = await listPage(baseBody, pageToken);
      const pageHits = filterSkusForQueries(skus, variants, 0.55);
      for (const s of pageHits) {
        if (!seen.has(s.tiktok_sku_id)) {
          seen.add(s.tiktok_sku_id);
          matched.push(s);
        }
      }
      if (!nextToken) break;
      pageToken = nextToken;
    }
    return matched;
  }

  const merged: TikTokSkuInventory[] = [];
  const seen = new Set<string>();
  let pageToken = '';
  for (let page = 0; page < maxPages; page++) {
    const { skus, nextToken } = await listPage(baseBody, pageToken);
    for (const s of skus) {
      if (!seen.has(s.tiktok_sku_id)) {
        seen.add(s.tiktok_sku_id);
        merged.push(s);
      }
    }
    if (!nextToken) break;
    pageToken = nextToken;
  }
  return merged;
}

/** Unwrap product detail payload (API may nest under `product`). */
function unwrapProductDetail(data: Record<string, unknown>): Record<string, unknown> {
  const nested = data?.product;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return data;
}

/** Fetch product detail and resolve image URL for a mapped SKU. */
export async function fetchTikTokSkuImageUrl(
  accessToken: string,
  shopCipher: string,
  tiktokProductId: string,
  tiktokSkuId: string,
): Promise<string | undefined> {
  const raw = await apiGet(
    `/product/202309/products/${tiktokProductId}`,
    {},
    accessToken,
    shopCipher,
  );
  const data = unwrapProductDetail(raw);
  const productImage = extractProductImageUrl(data);
  const skus = (data?.skus as Record<string, unknown>[]) || [];
  const sku = skus.find(s => String(s.id || s.sku_id) === tiktokSkuId);
  if (sku) return extractSkuImageUrl(sku, productImage);
  return productImage;
}

/** Read current qty for one SKU (first warehouse in response). */
export async function getTikTokSkuQuantity(
  accessToken: string,
  shopCipher: string,
  productId: string,
  skuId: string,
  warehouseId: string,
): Promise<number> {
  const data = await apiGet(
    `/product/202309/products/${productId}`,
    {},
    accessToken,
    shopCipher,
  );
  const skus = (data?.skus as Record<string, unknown>[]) || [];
  const sku = skus.find(s => String(s.id || s.sku_id) === skuId);
  if (!sku) return 0;
  const inv = (sku.inventory as Record<string, unknown>[]) || [];
  const wh = inv.find(w => String(w.warehouse_id) === warehouseId);
  return Number(wh?.quantity ?? wh?.available_stock ?? 0) || 0;
}

/** Mirror POS stock — set TikTok warehouse qty to posStock. */
export async function updateTikTokInventoryMirror(
  accessToken: string,
  shopCipher: string,
  productId: string,
  skuId: string,
  warehouseId: string,
  posStock: number,
): Promise<void> {
  const qty = Math.max(0, Math.floor(posStock));
  await apiPost(
    `/product/202309/products/${productId}/inventory/update`,
    {},
    accessToken,
    shopCipher,
    {
      skus: [{
        id: skuId,
        inventory: [{ warehouse_id: warehouseId, quantity: qty }],
      }],
    },
  );
}

/** List warehouses for the shop. */
export async function fetchTikTokWarehouses(
  accessToken: string,
  shopCipher: string,
): Promise<Array<{ id: string; name: string }>> {
  const data = await apiGet(
    '/logistics/202309/warehouses',
    {},
    accessToken,
    shopCipher,
  );
  const list = (data?.warehouses as Record<string, unknown>[])
    || (data?.warehouse_list as Record<string, unknown>[])
    || [];
  return list.map(w => ({
    id: String(w.id || w.warehouse_id || ''),
    name: String(w.name || w.warehouse_name || w.id || ''),
  })).filter(w => w.id);
}
