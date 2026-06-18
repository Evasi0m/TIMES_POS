// TikTok Shop catalog → storefront_products cache for TIMES_SHOP.
// Source of truth: TikTok Shop API (NOT POS products table for price/stock display).

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  apiGet,
  apiPost,
  getValidAccessToken,
  serviceClient,
} from './tiktok-client.ts';
import {
  extractProductImageUrl,
  extractSkuImageUrl,
} from './tiktok-catalog-images.ts';
import {
  COLOR_MAP,
  MATERIAL_MAP,
  SERIES_RULES,
  SERIES_SUBS,
  VALID_COLORS,
  VALID_MATERIALS,
  VALID_SERIES,
  enrichCasioFromModelCode,
  getModelCodeFromRow,
} from './casio-catalog.ts';

const SYNC_STALE_MINUTES = 15;
const UNITS_SOLD_STALE_HOURS = 6;
const SYNC_MAX_PAGES = 40;
const SYNC_PAGE_SIZE = 50;

/** Columns needed for listing cards (catalog grid + related). */
const STOREFRONT_LISTING_CARD_SELECT =
  'tiktok_sku_id,tiktok_product_id,product_name,listing_image_url,image_url,unit_price,stock_available,updated_at,units_sold';

/** Columns needed for SKU-level catalog items and PDP variant picker. */
const STOREFRONT_SKU_SELECT =
  `${STOREFRONT_LISTING_CARD_SELECT},sku_name,seller_sku,sales_attributes`;

const STOREFRONT_PDP_ANCHOR_SELECT = `${STOREFRONT_SKU_SELECT},description`;
const MAX_DETAIL_FETCHES_PER_SYNC = 50;

export interface StorefrontRow {
  tiktok_sku_id: string;
  tiktok_product_id: string | null;
  product_name: string;
  sku_name: string | null;
  seller_sku: string | null;
  image_url: string | null;
  listing_image_url: string | null;
  unit_price: number;
  stock_available: number;
  pos_product_id: number | null;
  sales_attributes?: Record<string, string>[] | null;
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizeSalesAttributes(attrs: unknown): Record<string, string>[] | null {
  if (!Array.isArray(attrs) || !attrs.length) return null;
  const out: Record<string, string>[] = [];
  for (const raw of attrs) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const name = String(a.name || a.attribute_name || '').trim();
    const value = String(a.value_name || a.custom_value || a.value || '').trim();
    if (!name || !value) continue;
    out.push({ name, value_name: value });
  }
  return out.length ? out : null;
}

/** Pull unit price from TikTok SKU payload (search/detail shapes vary). */
export function extractSkuUnitPrice(sku: Record<string, unknown>): number {
  const price = sku.price as Record<string, unknown> | undefined;
  const priceInfo = sku.price_info as Record<string, unknown> | undefined;
  const candidates = [
    price?.sale_price,
    price?.tax_exclusive_price,
    price?.amount,
    priceInfo?.sale_price,
    priceInfo?.tax_exclusive_price,
    sku.sale_price,
    sku.sku_sale_price,
    sku.original_price,
    sku.sku_original_price,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'object' && c !== null && 'amount' in (c as object)) {
      const n = Number((c as Record<string, unknown>).amount);
      if (n > 0) return roundMoney(n);
    }
    const n = Number(c);
    if (n > 0) return roundMoney(n);
  }
  return 0;
}

function mapProductsToRows(products: Record<string, unknown>[]): StorefrontRow[] {
  const out: StorefrontRow[] = [];
  for (const p of products) {
    const productId = String(p.id || p.product_id || '');
    const title = String(p.title || p.product_name || '').trim();
    if (!productId || !title) continue;
    const productImage = extractProductImageUrl(p);
    const skus = (p.skus as Record<string, unknown>[]) || [];
    for (const sku of skus) {
      const skuId = String(sku.id || sku.sku_id || '');
      if (!skuId) continue;
      let qty = 0;
      const inv = (sku.inventory as Record<string, unknown>[]) || [];
      for (const w of inv) {
        qty += Number(w.quantity ?? w.available_stock ?? 0) || 0;
      }
      const skuName = String(sku.sku_name || sku.seller_sku || '').trim() || null;
      const sellerSku = String(sku.seller_sku || '').trim() || skuName;
      const imageUrl = extractSkuImageUrl(sku, productImage) || productImage || null;
      out.push({
        tiktok_sku_id: skuId,
        tiktok_product_id: productId,
        product_name: title,
        sku_name: skuName,
        seller_sku: sellerSku,
        image_url: imageUrl,
        listing_image_url: productImage || null,
        unit_price: extractSkuUnitPrice(sku),
        stock_available: qty,
        pos_product_id: null,
        sales_attributes: normalizeSalesAttributes(sku.sales_attributes),
      });
    }
  }
  return out;
}

function unwrapProductDetail(data: Record<string, unknown>): Record<string, unknown> {
  const nested = data?.product;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return data;
}

/** Product Detail API → listing cover + per-SKU images. */
async function fetchProductDetailImages(
  accessToken: string,
  shopCipher: string,
  tiktokProductId: string,
): Promise<{ cover: string | null; skuMap: Map<string, string> }> {
  const raw = await apiGet(
    `/product/202309/products/${tiktokProductId}`,
    {},
    accessToken,
    shopCipher,
  );
  const data = unwrapProductDetail(raw as Record<string, unknown>);
  const productImage = extractProductImageUrl(data);
  const skus = (data?.skus as Record<string, unknown>[]) || [];
  const skuMap = new Map<string, string>();
  for (const sku of skus) {
    const skuId = String(sku.id || sku.sku_id || '');
    if (!skuId) continue;
    const url = extractSkuImageUrl(sku, productImage) || productImage;
    if (url) skuMap.set(skuId, url);
  }
  return { cover: productImage || null, skuMap };
}

/** One Product Detail API call → map of tiktok_sku_id → image URL. */
async function fetchProductSkuImageMap(
  accessToken: string,
  shopCipher: string,
  tiktokProductId: string,
): Promise<Map<string, string>> {
  const { skuMap } = await fetchProductDetailImages(accessToken, shopCipher, tiktokProductId);
  return skuMap;
}

/** TikTok search API often omits images — backfill from Product Detail (~1 call per product). */
async function backfillSkuImagesFromProductDetail(
  rows: StorefrontRow[],
  accessToken: string,
  shopCipher: string,
): Promise<StorefrontRow[]> {
  const productIds = new Set<string>();
  for (const row of rows) {
    if (!row.image_url && row.tiktok_product_id) {
      productIds.add(row.tiktok_product_id);
    }
  }
  if (!productIds.size) return rows;

  const productIdList = [...productIds].slice(0, MAX_DETAIL_FETCHES_PER_SYNC);
  const imageCache = new Map<string, Map<string, string>>();
  for (const productId of productIdList) {
    try {
      imageCache.set(
        productId,
        await fetchProductSkuImageMap(accessToken, shopCipher, productId),
      );
    } catch {
      imageCache.set(productId, new Map());
    }
  }

  return rows.map((row) => {
    if (row.image_url || !row.tiktok_product_id) return row;
    const url = imageCache.get(row.tiktok_product_id)?.get(row.tiktok_sku_id);
    return url ? { ...row, image_url: url } : row;
  });
}

async function fetchAllTikTokProducts(
  accessToken: string,
  shopCipher: string,
): Promise<Record<string, unknown>[]> {
  const pageSize = SYNC_PAGE_SIZE;
  const merged: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let pageToken = '';
  for (let page = 0; page < SYNC_MAX_PAGES; page++) {
    const queryParams: Record<string, string | number> = { page_size: pageSize };
    if (pageToken) queryParams.page_token = pageToken;
    const data = await apiPost(
      '/product/202502/products/search',
      queryParams,
      accessToken,
      shopCipher,
      { status: 'ACTIVATE' },
    );
    const products = (data?.products as Record<string, unknown>[]) || [];
    for (const p of products) {
      const id = String(p.id || p.product_id || '');
      if (id && !seen.has(id)) {
        seen.add(id);
        merged.push(p);
      }
    }
    const nextToken = String(data?.next_page_token || data?.page_token || '');
    if (!nextToken || nextToken === pageToken) break;
    pageToken = nextToken;
  }
  return merged;
}

async function attachPosProductIds(
  supa: SupabaseClient,
  rows: StorefrontRow[],
): Promise<StorefrontRow[]> {
  const skuIds = rows.map((r) => r.tiktok_sku_id);
  if (!skuIds.length) return rows;
  const { data: mappings } = await supa
    .from('tiktok_product_mappings')
    .select('tiktok_sku_id, product_id')
    .in('tiktok_sku_id', skuIds);
  const map = new Map(
    (mappings || []).map((m: { tiktok_sku_id: string; product_id: number }) => [
      m.tiktok_sku_id,
      m.product_id,
    ]),
  );
  return rows.map((r) => ({
    ...r,
    pos_product_id: map.get(r.tiktok_sku_id) ?? null,
  }));
}

async function needsImageBackfill(supa: SupabaseClient): Promise<boolean> {
  const { count } = await supa
    .from('storefront_products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .is('image_url', null);
  return (count ?? 0) > 0;
}

/** Incremental image backfill for rows already in DB (avoids full catalog re-sync). */
async function backfillMissingImagesInDb(
  supa: SupabaseClient,
): Promise<void> {
  const { accessToken, shopCipher } = await getValidAccessToken(supa);
  const { data: missing } = await supa
    .from('storefront_products')
    .select('tiktok_sku_id, tiktok_product_id')
    .is('deleted_at', null)
    .is('image_url', null)
    .not('tiktok_product_id', 'is', null)
    .limit(500);
  if (!missing?.length) return;

  const productIds = [...new Set(
    missing.map((r: { tiktok_product_id: string }) => r.tiktok_product_id).filter(Boolean),
  )].slice(0, MAX_DETAIL_FETCHES_PER_SYNC);

  for (const productId of productIds) {
    try {
      const { cover, skuMap } = await fetchProductDetailImages(accessToken, shopCipher, productId);
      const now = new Date().toISOString();
      if (cover) {
        await supa
          .from('storefront_products')
          .update({ listing_image_url: cover, updated_at: now })
          .eq('tiktok_product_id', productId)
          .is('deleted_at', null);
      }
      const updates = missing.filter(
        (r: { tiktok_product_id: string; tiktok_sku_id: string }) =>
          r.tiktok_product_id === productId && skuMap.has(r.tiktok_sku_id),
      );
      for (const row of updates) {
        const url = skuMap.get(row.tiktok_sku_id);
        if (!url) continue;
        await supa
          .from('storefront_products')
          .update({ image_url: url, updated_at: now })
          .eq('tiktok_sku_id', row.tiktok_sku_id);
      }
    } catch {
      /* skip product on API error */
    }
  }
}

async function needsListingImageBackfill(supa: SupabaseClient): Promise<boolean> {
  const { count } = await supa
    .from('storefront_products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .is('listing_image_url', null)
    .not('tiktok_product_id', 'is', null);
  return (count ?? 0) > 0;
}

/** Backfill TikTok product cover (listing_image_url) from Product Detail API. */
async function backfillListingImagesInDb(supa: SupabaseClient): Promise<void> {
  const { accessToken, shopCipher } = await getValidAccessToken(supa);
  const { data: rows } = await supa
    .from('storefront_products')
    .select('tiktok_product_id')
    .is('deleted_at', null)
    .is('listing_image_url', null)
    .not('tiktok_product_id', 'is', null)
    .limit(500);
  if (!rows?.length) return;

  const productIds = [...new Set(
    rows.map((r: { tiktok_product_id: string }) => r.tiktok_product_id).filter(Boolean),
  )].slice(0, MAX_DETAIL_FETCHES_PER_SYNC);

  const now = new Date().toISOString();
  for (const productId of productIds) {
    try {
      const { cover } = await fetchProductDetailImages(accessToken, shopCipher, productId);
      if (!cover) continue;
      await supa
        .from('storefront_products')
        .update({ listing_image_url: cover, updated_at: now })
        .eq('tiktok_product_id', productId)
        .is('deleted_at', null);
    } catch {
      /* skip product on API error */
    }
  }
}

/** Run multiple backfill batches (for shop-sync-catalog manual trigger). */
export async function runImageBackfillBatches(
  supa: SupabaseClient,
  maxBatches = 8,
): Promise<{ batches: number; remaining: boolean }> {
  let batches = 0;
  for (let i = 0; i < maxBatches; i++) {
    if (!(await needsImageBackfill(supa))) break;
    await backfillMissingImagesInDb(supa);
    batches++;
  }
  return { batches, remaining: await needsImageBackfill(supa) };
}

export async function needsCatalogSync(supa: SupabaseClient): Promise<boolean> {
  const { count } = await supa
    .from('storefront_products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);
  if (!count) return true;

  const { data } = await supa
    .from('storefront_products')
    .select('synced_at')
    .order('synced_at', { ascending: false, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  if (!data?.synced_at) return true;
  const ageMs = Date.now() - new Date(data.synced_at).getTime();
  return ageMs > SYNC_STALE_MINUTES * 60 * 1000;
}

/** Pull every ACTIVE TikTok SKU into storefront_products. Preserves admin publish/delete flags. */
export async function syncStorefrontFromTikTok(
  supa: SupabaseClient = serviceClient(),
): Promise<{ upserted: number }> {
  const { accessToken, shopCipher } = await getValidAccessToken(supa);
  const products = await fetchAllTikTokProducts(accessToken, shopCipher);
  let rows = mapProductsToRows(products);
  rows = await backfillSkuImagesFromProductDetail(rows, accessToken, shopCipher);
  rows = await attachPosProductIds(supa, rows);
  const now = new Date().toISOString();

  const { data: existing } = await supa
    .from('storefront_products')
    .select(
      'tiktok_sku_id, is_published, deleted_at, image_url, listing_image_url, sales_attributes, model_base, watch_series, watch_sub_type, casio_prefix, strap_material, dial_color_code',
    );
  const existingMap = new Map(
    (existing || []).map((e: {
      tiktok_sku_id: string;
      is_published: boolean;
      deleted_at: string | null;
      image_url: string | null;
      listing_image_url: string | null;
      sales_attributes: Record<string, string>[] | null;
      model_base: string | null;
      watch_series: string | null;
      watch_sub_type: string | null;
      casio_prefix: string | null;
      strap_material: string | null;
      dial_color_code: string | null;
    }) => [e.tiktok_sku_id, e]),
  );

  const payload = rows.map((r) => {
    const prev = existingMap.get(r.tiktok_sku_id);
    const modelCode = getModelCodeFromRow(r);
    const enriched = enrichCasioFromModelCode(modelCode);
    return {
      tiktok_sku_id: r.tiktok_sku_id,
      tiktok_product_id: r.tiktok_product_id,
      product_name: r.product_name,
      sku_name: r.sku_name,
      seller_sku: r.seller_sku,
      image_url: r.image_url || prev?.image_url || null,
      listing_image_url: r.listing_image_url || prev?.listing_image_url || null,
      unit_price: r.unit_price,
      stock_available: r.stock_available,
      pos_product_id: r.pos_product_id,
      sales_attributes: r.sales_attributes ?? prev?.sales_attributes ?? null,
      model_base: enriched.model_base || prev?.model_base || null,
      watch_series: enriched.watch_series || prev?.watch_series || 'standard',
      watch_sub_type: enriched.watch_sub_type ?? prev?.watch_sub_type ?? null,
      casio_prefix: enriched.casio_prefix || prev?.casio_prefix || null,
      strap_material: enriched.strap_material || prev?.strap_material || 'R',
      dial_color_code: enriched.dial_color_code || prev?.dial_color_code || '',
      is_published: prev ? prev.is_published : true,
      deleted_at: prev?.deleted_at ?? null,
      synced_at: now,
      updated_at: now,
    };
  });

  if (!payload.length) return { upserted: 0 };

  const { error } = await supa.from('storefront_products').upsert(payload, {
    onConflict: 'tiktok_sku_id',
  });
  if (error) throw new Error(error.message);
  await refreshStorefrontUnitsSold(supa);
  return { upserted: payload.length };
}

export async function needsUnitsSoldRefresh(supa: SupabaseClient): Promise<boolean> {
  const { data } = await supa
    .from('storefront_products')
    .select('units_sold_synced_at')
    .is('deleted_at', null)
    .order('units_sold_synced_at', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();
  if (!data?.units_sold_synced_at) return true;
  const ageMs = Date.now() - new Date(data.units_sold_synced_at).getTime();
  return ageMs > UNITS_SOLD_STALE_HOURS * 60 * 60 * 1000;
}

/** Aggregate POS sale_order_items → storefront_products.units_sold (all channels). */
export async function refreshStorefrontUnitsSold(
  supa: SupabaseClient,
): Promise<{ updated: number }> {
  const { data, error } = await supa.rpc('refresh_storefront_units_sold');
  if (error) throw new Error(error.message);
  const row = data as { updated?: number } | null;
  return { updated: Number(row?.updated) || 0 };
}

const CASIO_BACKFILL_BATCH = 200;

export async function needsCasioBackfill(supa: SupabaseClient): Promise<boolean> {
  const { count } = await supa
    .from('storefront_products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .or('model_base.is.null,watch_series.is.null');
  return (count ?? 0) > 0;
}

/** One-time / incremental backfill of CASIO derived columns from sku_name/seller_sku. */
export async function backfillCasioFieldsInDb(
  supa: SupabaseClient,
  batchSize = CASIO_BACKFILL_BATCH,
): Promise<{ updated: number; remaining: boolean }> {
  const { data: rows, error } = await supa
    .from('storefront_products')
    .select('tiktok_sku_id, sku_name, seller_sku, model_base, watch_series, watch_sub_type, casio_prefix, strap_material, dial_color_code')
    .is('deleted_at', null)
    .or('model_base.is.null,watch_series.is.null')
    .limit(batchSize);
  if (error) throw new Error(error.message);
  if (!rows?.length) return { updated: 0, remaining: false };

  const now = new Date().toISOString();
  let updated = 0;
  for (const row of rows) {
    const modelCode = getModelCodeFromRow(row);
    const enriched = enrichCasioFromModelCode(modelCode);
    const payload = {
      model_base: enriched.model_base || row.model_base || null,
      watch_series: enriched.watch_series || row.watch_series || 'standard',
      watch_sub_type: enriched.watch_sub_type ?? row.watch_sub_type ?? null,
      casio_prefix: enriched.casio_prefix || row.casio_prefix || null,
      strap_material: enriched.strap_material || row.strap_material || 'R',
      dial_color_code: enriched.dial_color_code || row.dial_color_code || '',
      updated_at: now,
    };
    const { error: upErr } = await supa
      .from('storefront_products')
      .update(payload)
      .eq('tiktok_sku_id', row.tiktok_sku_id);
    if (!upErr) updated++;
  }

  return { updated, remaining: rows.length >= batchSize };
}

export async function runCasioBackfillBatches(
  supa: SupabaseClient,
  maxBatches = 15,
): Promise<{ batches: number; remaining: boolean }> {
  let batches = 0;
  for (let i = 0; i < maxBatches; i++) {
    if (!(await needsCasioBackfill(supa))) break;
    const { remaining } = await backfillCasioFieldsInDb(supa);
    batches++;
    if (!remaining) break;
  }
  return { batches, remaining: await needsCasioBackfill(supa) };
}

export function toCatalogItem(row: Record<string, unknown>) {
  const stock = Number(row.stock_available) || 0;
  const item: Record<string, unknown> = {
    tiktok_sku_id: row.tiktok_sku_id,
    tiktok_product_id: row.tiktok_product_id,
    product_name: row.product_name,
    sku_name: row.sku_name,
    seller_sku: row.seller_sku,
    image_url: row.image_url,
    unit_price: Number(row.unit_price) || 0,
    stock_available: stock,
    in_stock: stock > 0,
    units_sold: Number(row.units_sold) || 0,
  };
  if (row.sales_attributes != null) {
    item.sales_attributes = row.sales_attributes;
  }
  return item;
}

function listingGroupKey(row: Record<string, unknown>): string {
  const productId = String(row.tiktok_product_id || '').trim();
  if (productId) return productId;
  return `sku:${row.tiktok_sku_id}`;
}

function pickDefaultSkuItem(skus: Record<string, unknown>[]) {
  if (!skus.length) return null;
  const inStock = skus.filter((s) => Number(s.stock_available) > 0);
  const pool = inStock.length ? inStock : skus;
  return pool.reduce((best, cur) => {
    const bestPrice = Number(best.unit_price) || Infinity;
    const curPrice = Number(cur.unit_price) || Infinity;
    return curPrice < bestPrice ? cur : best;
  });
}

function pickListingCoverImage(rows: Record<string, unknown>[]): string | null {
  for (const row of rows) {
    const cover = String(row.listing_image_url || '').trim();
    if (cover) return cover;
  }
  const sorted = [...rows].sort((a, b) =>
    String(a.tiktok_sku_id).localeCompare(String(b.tiktok_sku_id)));
  for (const row of sorted) {
    const url = String(row.image_url || '').trim();
    if (url) return url;
  }
  return null;
}

/** Aggregate sibling SKUs into one TikTok listing card. */
export function toListingCatalogItem(rows: Record<string, unknown>[]) {
  if (!rows.length) return null;
  const skus = rows.map(toCatalogItem) as Record<string, unknown>[];
  const prices = skus
    .map((s) => Number(s.unit_price) || 0)
    .filter((p) => p > 0);
  const priceMin = prices.length ? Math.min(...prices) : 0;
  const priceMax = prices.length ? Math.max(...prices) : 0;
  const defaultSku = pickDefaultSkuItem(skus);
  const inStock = skus.some((s) => s.in_stock);
  const coverImage = pickListingCoverImage(rows);
  const updatedAt = rows.reduce((max, row) => {
    const ts = String(row.updated_at || '');
    return ts > max ? ts : max;
  }, '');

  return {
    tiktok_product_id: rows[0].tiktok_product_id || null,
    product_name: rows[0].product_name,
    image_url: coverImage,
    listing_image_url: coverImage,
    sku_count: skus.length,
    price_min: priceMin,
    price_max: priceMax,
    unit_price: priceMin,
    default_sku_id: defaultSku?.tiktok_sku_id || skus[0]?.tiktok_sku_id,
    tiktok_sku_id: defaultSku?.tiktok_sku_id || skus[0]?.tiktok_sku_id,
    in_stock: inStock,
    stock_available: skus.reduce((sum, s) => sum + (Number(s.stock_available) || 0), 0),
    units_sold: skus.reduce((sum, s) => sum + (Number(s.units_sold) || 0), 0),
    updated_at: updatedAt,
  };
}

function groupSkuRowsIntoListings(
  rows: Record<string, unknown>[],
  sort: string,
): Record<string, unknown>[] {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = listingGroupKey(row);
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  let listings = [...groups.values()]
    .map((groupRows) => toListingCatalogItem(groupRows))
    .filter(Boolean) as Record<string, unknown>[];

  if (sort === 'price_asc') {
    listings.sort((a, b) => (Number(a.price_min) || 0) - (Number(b.price_min) || 0));
  } else if (sort === 'price_desc') {
    listings.sort((a, b) => (Number(b.price_max) || 0) - (Number(a.price_max) || 0));
  } else {
    listings.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }
  return listings;
}

export interface CatalogQueryOpts {
  page?: number;
  page_size?: number;
  q?: string;
  sort?: string;
  series?: string;
  sub_type?: string;
  strap_material?: string;
  dial_color?: string;
  price_min?: number;
  price_max?: number;
  include_facets?: boolean;
  include_items?: boolean;
  group_by?: 'product' | 'sku';
}

interface ParsedCatalogFilters {
  q: string;
  series: string;
  sub_type: string;
  strap_material: string;
  dial_color: string;
  price_min: number;
  price_max: number;
}

function parseCatalogFilters(opts: CatalogQueryOpts): ParsedCatalogFilters {
  let priceMin = Math.max(0, Number(opts.price_min) || 0);
  let priceMax = Math.max(0, Number(opts.price_max) || 0);
  if (priceMin > 0 && priceMax > 0 && priceMin > priceMax) {
    [priceMin, priceMax] = [priceMax, priceMin];
  }

  const series = String(opts.series || '').trim();
  const subType = String(opts.sub_type || '').trim();
  const mat = String(opts.strap_material || '').trim().toUpperCase();
  const color = String(opts.dial_color || '').trim();

  return {
    q: String(opts.q || '').trim(),
    series: series && VALID_SERIES.has(series) ? series : '',
    sub_type: subType,
    strap_material: mat && VALID_MATERIALS.has(mat) ? mat : '',
    dial_color: color && VALID_COLORS.has(color) ? color : '',
    price_min: priceMin,
    price_max: priceMax,
  };
}

type FacetOmit = 'series' | 'sub_type' | 'strap_material' | 'dial_color' | 'price';

function applyCatalogFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  filters: ParsedCatalogFilters,
  omit: FacetOmit[] = [],
) {
  const skip = new Set(omit);
  const hasQ = Boolean(filters.q);

  if (!hasQ && filters.series && !skip.has('series')) {
    query = query.eq('watch_series', filters.series);
  }
  if (filters.sub_type && !skip.has('sub_type')) {
    query = query.eq('watch_sub_type', filters.sub_type);
  }
  if (hasQ) {
    const needle = `%${filters.q.replace(/[%_]/g, '')}%`;
    query = query.or(
      `model_base.ilike.${needle},sku_name.ilike.${needle},seller_sku.ilike.${needle},product_name.ilike.${needle}`,
    );
  }
  if (!skip.has('price')) {
    if (filters.price_min > 0) query = query.gte('unit_price', filters.price_min);
    if (filters.price_max > 0) query = query.lte('unit_price', filters.price_max);
  }
  if (filters.strap_material && !skip.has('strap_material')) {
    query = query.eq('strap_material', filters.strap_material);
  }
  if (filters.dial_color && !skip.has('dial_color')) {
    query = query.eq('dial_color_code', filters.dial_color);
  }
  return query;
}

function countByField(
  rows: Record<string, unknown>[],
  field: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = row[field];
    const key = raw == null || raw === '' ? '' : String(raw);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

async function buildCatalogFacets(
  supa: SupabaseClient,
  filters: ParsedCatalogFilters,
) {
  const baseSelect =
    'watch_series, watch_sub_type, strap_material, dial_color_code, unit_price';

  const [seriesRows, subRows, matRows, colorRows, priceRows] = await Promise.all([
    applyCatalogFilters(
      supa.from('storefront_products').select(baseSelect).eq('is_published', true).is('deleted_at', null),
      filters,
      ['series'],
    ).then(({ data, error }: { data: Record<string, unknown>[] | null; error: { message: string } | null }) => {
      if (error) throw new Error(error.message);
      return data || [];
    }),
    applyCatalogFilters(
      supa.from('storefront_products').select(baseSelect).eq('is_published', true).is('deleted_at', null),
      filters,
      ['sub_type'],
    ).then(({ data, error }: { data: Record<string, unknown>[] | null; error: { message: string } | null }) => {
      if (error) throw new Error(error.message);
      return data || [];
    }),
    applyCatalogFilters(
      supa.from('storefront_products').select(baseSelect).eq('is_published', true).is('deleted_at', null),
      filters,
      ['strap_material'],
    ).then(({ data, error }: { data: Record<string, unknown>[] | null; error: { message: string } | null }) => {
      if (error) throw new Error(error.message);
      return data || [];
    }),
    applyCatalogFilters(
      supa.from('storefront_products').select(baseSelect).eq('is_published', true).is('deleted_at', null),
      filters,
      ['dial_color'],
    ).then(({ data, error }: { data: Record<string, unknown>[] | null; error: { message: string } | null }) => {
      if (error) throw new Error(error.message);
      return data || [];
    }),
    applyCatalogFilters(
      supa.from('storefront_products').select('unit_price').eq('is_published', true).is('deleted_at', null),
      filters,
      ['price'],
    ).then(({ data, error }: { data: Record<string, unknown>[] | null; error: { message: string } | null }) => {
      if (error) throw new Error(error.message);
      return data || [];
    }),
  ]);

  const seriesCounts = countByField(seriesRows, 'watch_series');
  const subCounts = countByField(subRows, 'watch_sub_type');
  const matCounts = countByField(matRows, 'strap_material');
  const colorCounts = countByField(colorRows, 'dial_color_code');

  const series = SERIES_RULES.filter((r) => r.id !== 'standard' || seriesCounts.has('standard'))
    .map((r) => ({
      id: r.id,
      label: r.label,
      count: seriesCounts.get(r.id) || 0,
    }))
    .filter((x) => x.count > 0);

  const seriesForSubs = filters.series || 'standard';
  const subDefs = SERIES_SUBS[seriesForSubs] || [];
  const sub_types = subDefs
    .map((s) => ({
      id: s.id,
      label: s.label,
      count: subCounts.get(s.id) || 0,
    }))
    .filter((x) => x.count > 0);

  const materials = [...matCounts.entries()]
    .filter(([id]) => VALID_MATERIALS.has(id))
    .map(([id, count]) => ({
      id,
      label: MATERIAL_MAP[id],
      count,
    }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);

  const colors = [...colorCounts.entries()]
    .map(([id, count]) => ({
      id,
      label: COLOR_MAP[id]?.label || id,
      hex: COLOR_MAP[id]?.hex || '#9ca3af',
      count,
    }))
    .filter((x) => x.count > 0)
    .sort((a, b) => Number(a.id) - Number(b.id));

  let priceMin = 0;
  let priceMax = 0;
  for (const row of priceRows) {
    const p = Number(row.unit_price) || 0;
    if (p <= 0) continue;
    if (!priceMin || p < priceMin) priceMin = p;
    if (p > priceMax) priceMax = p;
  }

  return {
    series,
    sub_types,
    materials,
    colors,
    price_range: { min: priceMin, max: priceMax },
  };
}

export async function queryStorefrontCatalog(
  supa: SupabaseClient,
  opts: CatalogQueryOpts = {},
) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(Math.max(Number(opts.page_size) || 24, 1), 100);
  const sort = opts.sort || 'newest';
  const groupBy = opts.group_by === 'sku' ? 'sku' : 'product';
  const filters = parseCatalogFilters(opts);
  const includeItems = opts.include_items !== false;
  const includeFacets = opts.include_facets === true;

  const emptySkuResult = { data: [] as Record<string, unknown>[], count: 0, error: null };

  const [facets, skuResult] = await Promise.all([
    includeFacets ? buildCatalogFacets(supa, filters) : Promise.resolve(null),
    includeItems
      ? (groupBy === 'sku'
        ? (async () => {
          let skuQuery = supa
            .from('storefront_products')
            .select(STOREFRONT_SKU_SELECT, { count: 'exact' })
            .eq('is_published', true)
            .is('deleted_at', null);
          skuQuery = applyCatalogFilters(skuQuery, filters);
          if (sort === 'price_asc') skuQuery = skuQuery.order('unit_price', { ascending: true });
          else if (sort === 'price_desc') skuQuery = skuQuery.order('unit_price', { ascending: false });
          else skuQuery = skuQuery.order('updated_at', { ascending: false });
          const from = (page - 1) * pageSize;
          return skuQuery.range(from, from + pageSize - 1);
        })()
        : applyCatalogFilters(
          supa.from('storefront_products').select(STOREFRONT_LISTING_CARD_SELECT)
            .eq('is_published', true).is('deleted_at', null),
          filters,
        ).order('updated_at', { ascending: false }))
      : Promise.resolve(emptySkuResult),
  ]);

  if (skuResult.error) throw new Error(skuResult.error.message);

  let items: Record<string, unknown>[];
  let total: number;

  if (!includeItems) {
    items = [];
    total = 0;
  } else if (groupBy === 'sku') {
    items = (skuResult.data || []).map(toCatalogItem);
    total = skuResult.count ?? items.length;
  } else {
    const listings = groupSkuRowsIntoListings(skuResult.data || [], sort);
    total = listings.length;
    const from = (page - 1) * pageSize;
    items = listings.slice(from, from + pageSize);
  }

  const result: Record<string, unknown> = {
    ok: true as const,
    items,
    total,
    page,
    page_size: pageSize,
    group_by: groupBy,
  };
  if (facets) result.facets = facets;
  return result;
}

export async function queryStorefrontListing(
  supa: SupabaseClient,
  opts: { tiktok_sku_id?: string; tiktok_product_id?: string },
) {
  const skuId = String(opts.tiktok_sku_id || '').trim();
  const productId = String(opts.tiktok_product_id || '').trim();
  if (!skuId && !productId) {
    return { ok: false as const, error: 'validation_failed', message: 'tiktok_sku_id or tiktok_product_id required' };
  }

  let resolvedProductId = productId;
  let selectedSkuId = skuId;

  if (skuId) {
    const { data: anchor, error } = await supa
      .from('storefront_products')
      .select(STOREFRONT_PDP_ANCHOR_SELECT)
      .eq('tiktok_sku_id', skuId)
      .eq('is_published', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!anchor) return { ok: false as const, error: 'not_found', message: 'ไม่พบสินค้า' };
    resolvedProductId = String(anchor.tiktok_product_id || '').trim() || resolvedProductId;
    if (!resolvedProductId) {
      const skus = [toCatalogItem(anchor)];
      const coverImage =
        String(anchor.listing_image_url || '').trim() ||
        String(anchor.image_url || '').trim() ||
        null;
      return {
        ok: true as const,
        listing: {
          tiktok_product_id: null,
          product_name: anchor.product_name,
          description: anchor.description ?? null,
          listing_image_url: coverImage,
        },
        selected_sku_id: skuId,
        skus,
        product: skus[0],
        related: [],
      };
    }
  }

  const { data: siblingRows, error: sibErr } = await supa
    .from('storefront_products')
    .select(STOREFRONT_SKU_SELECT)
    .eq('tiktok_product_id', resolvedProductId)
    .eq('is_published', true)
    .is('deleted_at', null)
    .order('sku_name', { ascending: true });
  if (sibErr) throw new Error(sibErr.message);
  if (!siblingRows?.length) {
    return { ok: false as const, error: 'not_found', message: 'ไม่พบสินค้า' };
  }

  const skus = siblingRows.map(toCatalogItem);
  if (!selectedSkuId || !skus.some((s) => s.tiktok_sku_id === selectedSkuId)) {
    selectedSkuId = String(pickDefaultSkuItem(skus as Record<string, unknown>[])?.tiktok_sku_id || skus[0].tiktok_sku_id);
  }
  const selected = skus.find((s) => s.tiktok_sku_id === selectedSkuId) || skus[0];
  const anchorRow = siblingRows[0];

  const { data: relatedRows } = await supa
    .from('storefront_products')
    .select(STOREFRONT_LISTING_CARD_SELECT)
    .eq('is_published', true)
    .is('deleted_at', null)
    .neq('tiktok_product_id', resolvedProductId)
    .not('tiktok_product_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(48);

  const relatedListings = groupSkuRowsIntoListings(relatedRows || [], 'newest').slice(0, 10);
  const listingCoverImage = pickListingCoverImage(siblingRows) ||
    String(anchorRow.listing_image_url || '').trim() ||
    null;

  return {
    ok: true as const,
    listing: {
      tiktok_product_id: resolvedProductId,
      product_name: anchorRow.product_name,
      description: anchorRow.description ?? null,
      listing_image_url: listingCoverImage,
    },
    selected_sku_id: selectedSkuId,
    skus,
    product: selected,
    related: relatedListings,
  };
}

/** @deprecated Use queryStorefrontListing */
export async function queryStorefrontProduct(
  supa: SupabaseClient,
  tiktokSkuId: string,
) {
  return queryStorefrontListing(supa, { tiktok_sku_id: tiktokSkuId });
}

/** Background sync/backfill — must not block shop-get-catalog reads. */
function scheduleCatalogMaintenance(supa: SupabaseClient): void {
  const task = async () => {
    try {
      if (await needsCatalogSync(supa)) {
        await syncStorefrontFromTikTok(supa);
      } else if (await needsCasioBackfill(supa)) {
        await backfillCasioFieldsInDb(supa);
      } else if (await needsImageBackfill(supa)) {
        await backfillMissingImagesInDb(supa);
      } else if (await needsListingImageBackfill(supa)) {
        await backfillListingImagesInDb(supa);
      } else if (await needsUnitsSoldRefresh(supa)) {
        await refreshStorefrontUnitsSold(supa);
      }
    } catch {
      /* best-effort background maintenance */
    }
  };
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(task());
  }
}

/**
 * Fast path for catalog/product reads: return cached rows immediately.
 * Only blocks on first-ever sync (empty table). Stale/image work runs in background.
 */
export async function ensureCatalogFreshForRead(supa: SupabaseClient): Promise<void> {
  const { count } = await supa
    .from('storefront_products')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);
  if (!count) {
    await syncStorefrontFromTikTok(supa);
    return;
  }
  scheduleCatalogMaintenance(supa);
}

/** @deprecated Use ensureCatalogFreshForRead on read endpoints; full blocking sync for shop-sync-catalog only. */
export async function ensureCatalogFresh(supa: SupabaseClient): Promise<void> {
  if (await needsCatalogSync(supa)) {
    await syncStorefrontFromTikTok(supa);
  } else if (await needsImageBackfill(supa)) {
    await backfillMissingImagesInDb(supa);
  }
}
