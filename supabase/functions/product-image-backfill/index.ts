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
import { Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts';

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

// Background removal + storage.
const BUCKET = 'product-images';
// A pixel counts as "background white" when every channel is at/above this.
// 238 keeps near-white JPEG artefacts out without eating a true-white dial
// (the flood-fill from the borders protects interior whites anyway).
const WHITE_THRESHOLD = 238;
// Cap the working resolution so decode + flood-fill stay within the edge
// function's CPU budget; thumbnails never need more than this.
const MAX_EDGE = 800;

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

// ── Background removal + Supabase Storage ──────────────────────────────────

// deno-lint-ignore no-explicit-any
async function ensureBucket(admin: any): Promise<void> {
  const { data } = await admin.storage.getBucket(BUCKET);
  if (data) return;
  // public so the rendered <img> can load it without a signed URL. Ignore the
  // race where a concurrent invocation created it first.
  await admin.storage.createBucket(BUCKET, { public: true });
}

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await timedFetch(url, { method: 'GET' });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// Remove the (white) backdrop of a product photo by flooding transparency in
// from the four borders: only white pixels *connected to the edge* are cleared,
// so a white watch dial in the middle is preserved. Returns a PNG (with alpha).
async function removeWhiteBackground(bytes: Uint8Array): Promise<Uint8Array> {
  let img = await Image.decode(bytes);

  const longest = Math.max(img.width, img.height);
  if (longest > MAX_EDGE) {
    const scale = MAX_EDGE / longest;
    img = img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
  }

  const w = img.width, h = img.height;
  const bmp = img.bitmap; // RGBA, length w*h*4
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];

  const isWhite = (idx: number) => {
    const o = idx * 4;
    return bmp[o] >= WHITE_THRESHOLD && bmp[o + 1] >= WHITE_THRESHOLD && bmp[o + 2] >= WHITE_THRESHOLD;
  };
  const consider = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    if (isWhite(idx)) {
      bmp[idx * 4 + 3] = 0; // clear alpha
      stack.push(idx);
    }
  };

  for (let x = 0; x < w; x++) { consider(x, 0); consider(x, h - 1); }
  for (let y = 0; y < h; y++) { consider(0, y); consider(w - 1, y); }
  while (stack.length) {
    const idx = stack.pop()!;
    const x = idx % w;
    const y = (idx - x) / w;
    consider(x - 1, y); consider(x + 1, y); consider(x, y - 1); consider(x, y + 1);
  }

  return await img.encode(); // PNG
}

// Fetch a brand image, strip the white background, and upload the transparent
// PNG to Storage. Returns the public URL, or null if any step fails (caller
// falls back to the original external URL so the product still gets an image).
// deno-lint-ignore no-explicit-any
async function processToStorage(admin: any, productId: number, imageUrl: string): Promise<string | null> {
  const bytes = await fetchImageBytes(imageUrl);
  if (!bytes) return null;
  let png: Uint8Array;
  try {
    png = await removeWhiteBackground(bytes);
  } catch {
    return null;
  }
  const path = `${productId}.png`;
  const up = await admin.storage.from(BUCKET).upload(path, png, {
    contentType: 'image/png',
    upsert: true,
  });
  if (up.error) return null;
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return data?.publicUrl ?? null;
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

  let body: {
    limit?: number; brands?: string[]; productIds?: number[];
    processBg?: boolean; reprocessExisting?: boolean;
  };
  try { body = await req.json(); }
  catch { body = {}; }

  const limit = Math.min(Math.max(1, Number(body.limit) || DEFAULT_LIMIT), MAX_LIMIT);
  const brandFilter = Array.isArray(body.brands) && body.brands.length ? new Set(body.brands) : null;
  const idFilter = Array.isArray(body.productIds) && body.productIds.length ? new Set(body.productIds) : null;
  const processBg = body.processBg !== false;          // default ON
  const reprocess = body.reprocessExisting === true;   // re-run bg removal on found rows

  // Ensure the storage bucket exists before any upload attempt.
  if (processBg) {
    try { await ensureBucket(adminClient); }
    catch (e) { return j(500, { error: 'cannot ensure storage bucket: ' + String(e) }); }
  }

  interface Task { id: number; name: string; brand: string; sourceImageUrl?: string; sourcePageUrl?: string; }
  const tasks: Task[] = [];

  if (reprocess) {
    // Re-run background removal on rows that already resolved to a found image,
    // sourcing from the original brand image (image_url). Lets us upgrade the
    // pre-existing rows (and anything an earlier no-bg run stored).
    const { data: rows, error } = await adminClient
      .from('product_images')
      .select('product_id, source_brand, source_name, image_url, source_url, is_manual_override')
      .eq('status', 'found')
      .limit(limit);
    if (error) return j(500, { error: 'cannot load product_images: ' + error.message });
    for (const row of rows || []) {
      if (row.is_manual_override) continue;
      if (!row.image_url) continue;
      if (idFilter && !idFilter.has(row.product_id)) continue;
      if (brandFilter && !brandFilter.has(row.source_brand)) continue;
      tasks.push({
        id: row.product_id, name: row.source_name || '', brand: row.source_brand,
        sourceImageUrl: row.image_url, sourcePageUrl: row.source_url || undefined,
      });
    }
  } else {
    // Default mode: find products that don't have an image / override yet and
    // resolve one. The product_images table is tiny relative to products.
    const { data: existing, error: exErr } = await adminClient
      .from('product_images')
      .select('product_id, status, is_manual_override');
    if (exErr) return j(500, { error: 'cannot load product_images: ' + exErr.message });
    const skip = new Set<number>();
    for (const r of existing || []) {
      if (r.is_manual_override || r.status === 'found' || r.status === 'manual') skip.add(r.product_id);
    }

    const PAGE = 1000;
    for (let from = 0; tasks.length < limit; from += PAGE) {
      const { data: prods, error: pErr } = await adminClient
        .from('products')
        .select('id, name')
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1);
      if (pErr) return j(500, { error: 'cannot load products: ' + pErr.message });
      if (!prods || prods.length === 0) break;
      for (const p of prods) {
        if (tasks.length >= limit) break;
        if (skip.has(p.id)) continue;
        if (idFilter && !idFilter.has(p.id)) continue;
        const brand = classifyBrand(p.name || '');
        if (brandFilter && !brandFilter.has(brand)) continue;
        tasks.push({ id: p.id, name: p.name || '', brand });
      }
      if (prods.length < PAGE) break;
    }
  }

  const results: unknown[] = [];
  let found = 0, notFound = 0, skipped = 0, bgRemovedCount = 0;

  for (const t of tasks) {
    const started = Date.now();

    // 1. Determine the source brand image URL (either pre-known or resolved).
    let imageUrl = t.sourceImageUrl ?? null;
    let pageUrl = t.sourcePageUrl ?? null;

    if (!imageUrl) {
      const r = await resolveImage(t.brand, modelCode(t.name));
      if (r === null) {
        // Unsupported brand — log as skipped, don't touch product_images.
        skipped++;
        await adminClient.from('product_image_jobs').insert({
          product_id: t.id, source_brand: t.brand, status: 'skipped',
          duration_ms: Date.now() - started, fetched_by: 'edge_fn',
        });
        results.push({ id: t.id, name: t.name, brand: t.brand, outcome: 'skipped' });
        continue;
      }
      if (r.status !== 'found') {
        notFound++;
        await adminClient.from('product_images').upsert({
          product_id: t.id, source_brand: t.brand, source_name: t.name,
          image_url: null, source_url: r.source_url ?? null, status: 'not_found',
          last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }, { onConflict: 'product_id' });
        await adminClient.from('product_image_jobs').insert({
          product_id: t.id, source_brand: t.brand,
          attempted_url: r.attempted_url, status: jobStatus(r),
          http_status: r.http_status ?? null, duration_ms: Date.now() - started,
          error_message: r.error ?? null, fetched_by: 'edge_fn',
        });
        results.push({ id: t.id, name: t.name, brand: t.brand, outcome: 'not_found' });
        continue;
      }
      imageUrl = r.image_url!;
      pageUrl = r.source_url ?? null;
    }

    // 2. Strip the white background and host the transparent PNG ourselves.
    //    On any failure, fall back to the original external URL.
    let finalUrl = imageUrl;
    let bgRemoved = false;
    if (processBg) {
      const stored = await processToStorage(adminClient, t.id, imageUrl);
      if (stored) { finalUrl = stored; bgRemoved = true; bgRemovedCount++; }
    }

    // 3. Persist. source_url keeps the original brand reference; image_url is
    //    what the UI renders (our Storage PNG when bg removal succeeded).
    await adminClient.from('product_images').upsert({
      product_id: t.id, source_brand: t.brand, source_name: t.name,
      image_url: finalUrl, source_url: pageUrl ?? imageUrl, status: 'found',
      metadata: { bg_removed: bgRemoved },
      last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id' });

    await adminClient.from('product_image_jobs').insert({
      product_id: t.id, source_brand: t.brand,
      attempted_url: imageUrl, resolved_url: finalUrl, status: 'success',
      duration_ms: Date.now() - started, fetched_by: 'edge_fn',
      metadata: { bg_removed: bgRemoved, reprocess },
    });

    found++;
    results.push({ id: t.id, name: t.name, brand: t.brand, outcome: 'found', bg_removed: bgRemoved, image_url: finalUrl });
  }

  return j(200, {
    processed: tasks.length,
    found, not_found: notFound, skipped, bg_removed: bgRemovedCount,
    remaining_hint: tasks.length === limit ? 'more may remain — call again' : 'batch exhausted',
    results,
  });
});
