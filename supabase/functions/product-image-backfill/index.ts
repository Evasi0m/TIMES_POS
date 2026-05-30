// product-image-backfill
// ─────────────────────────────────────────────────────────────────────────
// Server-side image sourcing for the product catalog. Picks products that
// don't have an image yet, resolves a brand image URL, and upserts the result
// into `product_images` (+ an audit row in `product_image_jobs`). Runs with the
// service_role key so RLS (admin_write) doesn't block the writes, but the
// CALLER must still be an authenticated admin.
//
// This is the in-repo successor to the external Google Apps Script: same tables,
// same shapes (`fetched_by` distinguishes the two). Per-brand strategy:
//   • alba    — image URL is deterministic: albawatches.com/storage/product/{MODEL}.PNG
//   • casio   — scrape <meta property="og:image"> from the TH product page
//   • seiko / citizen — best-effort og:image scrape (TODO: confirm URL patterns)
//   • other   — skipped
//
// Request (POST, admin JWT):
//   { limit?: number = 25, brands?: string[], productIds?: number[] }
// Response:
//   { processed, found, not_found, skipped, results: [...] }
//
// Designed to be called repeatedly (small batches) until the catalog is covered.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const FETCH_TIMEOUT_MS = 8000;

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ── Brand detection (ported from src/lib/product-classify.js BRAND_RULES) ──
// Kept in sync intentionally; pure regex so it ports verbatim.
function classifyBrand(name: string): string {
  const m = name || '';
  if (/^S[NRKSUXYWEDP][A-Z0-9]/i.test(m) && !/^SHE/i.test(m)) return 'seiko';
  if (/^A[HST][0-9A-Z]{6,}$/i.test(m.replace(/-.*$/, '')) || /^A[HST][0-9][A-Z][0-9]/i.test(m)) return 'alba';
  if (/^(EW|EU|EM|BI|BJ|BM|BU|JY|NH|NJ|NP|EP)\d/i.test(m)) return 'citizen';
  if (/^(MTP|LTP|GA|BGA|DW|BA|GMA|EFR|GM|EFV|BGD|SHE|GST|MRW|MQ|AE|MTD|GBA|LQ|MSG|MDV|MW|LRW|AMW|BEM|GMD|GW|GBD|GD|ECB|EQS|EQB|EFB|MTG|MRG|GWM|PRG|PRW|PRS|PRT|PRJ|WSD|MTL|MTW|HDA|HDC|AEQ|LTF|LWA|MCW|F-?\d|W-?\d|A-?\d|AW-?\d|LA-?\d|CA-?\d|DB-?\d|AQ-?\d)/i.test(m)) return 'casio';
  return 'other';
}

// Normalize a product name into a model code for URL construction.
function modelCode(name: string): string {
  return (name || '').trim().toUpperCase().replace(/\s+/g, '');
}

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TIMESPOS-ImageBot/1.0)',
        ...(init?.headers || {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

function extractOgImage(html: string): string | null {
  // Tolerate attribute order: property/content in either sequence.
  const re1 = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i;
  const re2 = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i;
  return html.match(re1)?.[1] || html.match(re2)?.[1] || null;
}

interface Resolved {
  status: 'found' | 'not_found';
  image_url?: string;
  source_url?: string;     // page we sourced from
  attempted_url: string;   // what we hit (for the job log)
  http_status?: number;
  error?: string;
}

async function resolveAlba(model: string): Promise<Resolved> {
  // Alba image URLs are deterministic, e.g. AH7AA8X1 → /storage/product/AH7AA8X1.PNG
  const url = `https://www.albawatches.com/storage/product/${model}.PNG`;
  try {
    const res = await timedFetch(url, { method: 'GET' });
    if (res.ok) return { status: 'found', image_url: url, source_url: url, attempted_url: url, http_status: res.status };
    return { status: 'not_found', attempted_url: url, http_status: res.status };
  } catch (e) {
    return { status: 'not_found', attempted_url: url, error: String(e) };
  }
}

async function resolveByOgImage(pageUrl: string): Promise<Resolved> {
  try {
    const res = await timedFetch(pageUrl, { method: 'GET' });
    if (!res.ok) return { status: 'not_found', attempted_url: pageUrl, http_status: res.status };
    const html = await res.text();
    const og = extractOgImage(html);
    if (og) return { status: 'found', image_url: og, source_url: pageUrl, attempted_url: pageUrl, http_status: res.status };
    return { status: 'not_found', attempted_url: pageUrl, http_status: res.status, error: 'no og:image' };
  } catch (e) {
    return { status: 'not_found', attempted_url: pageUrl, error: String(e) };
  }
}

async function resolveImage(brand: string, model: string): Promise<Resolved | null> {
  switch (brand) {
    case 'alba':
      return await resolveAlba(model);
    case 'casio':
      return await resolveByOgImage(`https://www.casio.com/th/watches/casio/detail/${model}/`);
    // seiko / citizen URL patterns not yet confirmed — return null = "skipped"
    // so they don't get marked not_found prematurely. Wire up here once known.
    default:
      return null;
  }
}

// Map the resolver outcome to a product_image_jobs.status enum value.
function jobStatus(r: Resolved): string {
  if (r.status === 'found') return 'success';
  if (r.error?.includes('abort')) return 'timeout';
  if (r.error === 'no og:image') return 'no_og_image';
  if (typeof r.http_status === 'number') return 'http_error';
  return 'http_error';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return j(405, { error: 'method not allowed' });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return j(401, { error: 'missing JWT' });

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return j(401, { error: 'invalid JWT' });

  const { data: isAdminData, error: isAdminErr } = await userClient.rpc('is_admin');
  if (isAdminErr) return j(500, { error: 'admin check failed: ' + isAdminErr.message });
  if (!isAdminData) return j(403, { error: 'admin only' });

  let body: { limit?: number; brands?: string[]; productIds?: number[] };
  try { body = await req.json(); }
  catch { body = {}; }

  const limit = Math.min(Math.max(1, Number(body.limit) || DEFAULT_LIMIT), MAX_LIMIT);
  const brandFilter = Array.isArray(body.brands) && body.brands.length ? new Set(body.brands) : null;
  const idFilter = Array.isArray(body.productIds) && body.productIds.length ? new Set(body.productIds) : null;

  // Skip products that already have an image or a manual override. The table is
  // tiny relative to products, so loading it whole is cheap.
  const { data: existing, error: exErr } = await adminClient
    .from('product_images')
    .select('product_id, status, is_manual_override');
  if (exErr) return j(500, { error: 'cannot load product_images: ' + exErr.message });
  const skip = new Set<number>();
  for (const r of existing || []) {
    if (r.is_manual_override || r.status === 'found' || r.status === 'manual') skip.add(r.product_id);
  }

  // Collect candidates. Page through products (newest first) until we have
  // `limit` that match the brand/id filters and aren't already done.
  const candidates: { id: number; name: string; brand: string }[] = [];
  const PAGE = 1000;
  for (let from = 0; candidates.length < limit; from += PAGE) {
    const { data: prods, error: pErr } = await adminClient
      .from('products')
      .select('id, name')
      .order('id', { ascending: false })
      .range(from, from + PAGE - 1);
    if (pErr) return j(500, { error: 'cannot load products: ' + pErr.message });
    if (!prods || prods.length === 0) break;
    for (const p of prods) {
      if (candidates.length >= limit) break;
      if (skip.has(p.id)) continue;
      if (idFilter && !idFilter.has(p.id)) continue;
      const brand = classifyBrand(p.name || '');
      if (brandFilter && !brandFilter.has(brand)) continue;
      candidates.push({ id: p.id, name: p.name || '', brand });
    }
    if (prods.length < PAGE) break;
  }

  const results: unknown[] = [];
  let found = 0, notFound = 0, skipped = 0;

  for (const c of candidates) {
    const model = modelCode(c.name);
    const started = Date.now();
    const r = await resolveImage(c.brand, model);

    if (r === null) {
      // Unsupported brand — log as skipped, don't touch product_images.
      skipped++;
      await adminClient.from('product_image_jobs').insert({
        product_id: c.id, source_brand: c.brand, status: 'skipped',
        duration_ms: Date.now() - started, fetched_by: 'edge_fn',
      });
      results.push({ id: c.id, name: c.name, brand: c.brand, outcome: 'skipped' });
      continue;
    }

    const duration = Date.now() - started;

    // Upsert the image row (one per product — product_id is unique).
    await adminClient.from('product_images').upsert({
      product_id: c.id,
      source_brand: c.brand,
      source_name: c.name,
      image_url: r.image_url ?? null,
      source_url: r.source_url ?? null,
      status: r.status,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id' });

    // Audit log (append-only).
    await adminClient.from('product_image_jobs').insert({
      product_id: c.id,
      source_brand: c.brand,
      attempted_url: r.attempted_url,
      resolved_url: r.image_url ?? null,
      status: jobStatus(r),
      http_status: r.http_status ?? null,
      duration_ms: duration,
      error_message: r.error ?? null,
      fetched_by: 'edge_fn',
    });

    if (r.status === 'found') found++; else notFound++;
    results.push({ id: c.id, name: c.name, brand: c.brand, outcome: r.status, image_url: r.image_url });
  }

  return j(200, {
    processed: candidates.length,
    found, not_found: notFound, skipped,
    remaining_hint: candidates.length === limit ? 'more may remain — call again' : 'batch exhausted',
    results,
  });
});
