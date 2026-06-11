// Shared TikTok order → TIMES POS import logic.

import { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  apiGet,
  apiPost,
  getValidAccessToken,
  IMPORT_STATUSES,
  roundMoney,
  similarityScore,
  SKIP_STATUSES,
  skuMatchTier,
  VOID_STATUSES,
  vatBreakdown,
} from './tiktok-client.ts';
import { queueSaleVoidMirror } from './tiktok-sale-void-mirror.ts';

const NUMERIC_STATUS: Record<string, string> = {
  '100': 'UNPAID',
  '111': 'AWAITING_SHIPMENT',
  '112': 'AWAITING_COLLECTION',
  '114': 'PARTIALLY_SHIPPING',
  '121': 'IN_TRANSIT',
  '122': 'DELIVERED',
  '130': 'COMPLETED',
  '140': 'CANCELLED',
};

function normalizeOrderStatus(order: Record<string, unknown>): string {
  const raw = String(
    order.status || order.order_status || order.order_status_old || '',
  ).trim();
  const mapped = NUMERIC_STATUS[raw];
  return (mapped || raw).toUpperCase();
}

function parseSaleDate(order: Record<string, unknown>): string {
  const ct = order.create_time;
  if (ct == null || ct === '') return new Date().toISOString();
  const n = Number(ct);
  if (Number.isFinite(n) && n > 1_000_000_000) {
    return new Date(n * 1000).toISOString();
  }
  const d = new Date(String(ct));
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? v as Record<string, unknown>
    : null;
}

/** TikTok 202309 nests recipient_address; legacy uses flat fields. */
export function extractRecipientAddress(order: Record<string, unknown>) {
  const ra = asRecord(order.recipient_address) || {};
  const name = String(
    ra.name || ra.full_name
      || [ra.first_name, ra.last_name].filter(Boolean).join(' ')
      || order.recipient_name || '',
  ).trim();
  const phone = String(ra.phone_number || ra.phone || order.recipient_phone || '').trim();
  const address = String(
    ra.full_address || ra.address_detail
      || [ra.address_line1, ra.address_line2, ra.address_line3].filter(Boolean).join(' ')
      || order.recipient_full_address || '',
  ).trim();
  const postal = String(ra.postal_code || ra.zipcode || order.recipient_postal_code || '').trim();
  return { name, phone, address, postal };
}

export function extractPackageIds(order: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const lists = [
    order.packages,
    order.package_list,
    (order as Record<string, unknown>).package_ids,
  ];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      if (typeof p === 'string' && p) ids.add(p);
      else if (p && typeof p === 'object') {
        const rec = p as Record<string, unknown>;
        const id = String(rec.id || rec.package_id || '');
        if (id) ids.add(id);
      }
    }
  }
  // 202309 keeps package_id on each line item — gather those too.
  const lineItems = extractLineItems(order);
  for (const li of lineItems) {
    const pkg = String(li.package_id || '');
    if (pkg) ids.add(pkg);
  }
  if (order.package_id) ids.add(String(order.package_id));
  return [...ids];
}

export function extractTrackingNumber(order: Record<string, unknown>): string {
  if (order.tracking_number) return String(order.tracking_number);
  const lineItems = extractLineItems(order);
  for (const li of lineItems) {
    if (li.tracking_number) return String(li.tracking_number);
  }
  const pkgs = order.packages;
  if (Array.isArray(pkgs)) {
    for (const p of pkgs) {
      if (p && typeof p === 'object') {
        const t = String((p as Record<string, unknown>).tracking_number || '');
        if (t) return t;
      }
    }
  }
  return '';
}

export function extractLineItems(order: Record<string, unknown>): Record<string, unknown>[] {
  const raw = order.line_items || order.item_list || order.order_line_list || [];
  return Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
}

export function mapLineItem(li: Record<string, unknown>): Record<string, unknown> {
  const skuId = String(li.sku_id || li.id || '');
  const sellerSku = String(li.seller_sku || '').trim();
  const skuName = String(li.sku_name || '').trim();
  const productName = String(li.product_name || skuName || 'TikTok item');
  const image = String(
    li.sku_image || li.sku_image_url || li.product_image || li.image || '',
  ).trim();
  const lineId = String(li.order_line_id || li.id || li.line_item_id || '');
  const qty = Number(li.quantity || 1);
  const unitPrice = roundMoney(Number(
    li.sale_price || li.sku_sale_price || li.original_price || li.sku_original_price || 0,
  ));
  return {
    tiktok_sku_id: skuId || null,
    seller_sku: sellerSku || null,
    sku_name: skuName || null,
    sku_image_url: image || null,
    tiktok_line_id: lineId || null,
    product_name: productName,
    quantity: qty,
    unit_price: unitPrice,
  };
}

export function buildFulfillmentHeader(
  order: Record<string, unknown>,
  status: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const addr = extractRecipientAddress(order);
  const packageIds = extractPackageIds(order);
  const shippingType = String(order.shipping_type || order.delivery_option || '').toUpperCase();
  return {
    tiktok_order_status: status,
    shipping_recipient_name: addr.name || null,
    shipping_phone: addr.phone || null,
    shipping_address: addr.address || null,
    shipping_postal_code: addr.postal || null,
    tiktok_package_ids: packageIds.length ? packageIds : null,
    tracking_number: extractTrackingNumber(order) || null,
    tiktok_shipping_type: shippingType || null,
    buyer_name: addr.name || null,
    buyer_address: addr.address || null,
    ...extras,
  };
}

export interface ImportResult {
  action: 'imported' | 'updated' | 'voided' | 'skipped';
  order_id?: number;
  tiktok_order_id: string;
  reason?: string;
}

export async function importTikTokOrder(
  supa: SupabaseClient,
  tiktokOrderId: string,
): Promise<ImportResult> {
  const { accessToken, shopCipher } = await getValidAccessToken(supa);
  const detail = await apiGet(
    '/order/202309/orders',
    { ids: tiktokOrderId },
    accessToken,
    shopCipher,
  );
  const orders = (detail?.orders as Record<string, unknown>[]) || [];
  if (!orders.length) {
    return { action: 'skipped', tiktok_order_id: tiktokOrderId, reason: 'not_found' };
  }
  const order = orders[0];
  const status = normalizeOrderStatus(order);
  if (SKIP_STATUSES.has(status)) {
    return { action: 'skipped', tiktok_order_id: tiktokOrderId, reason: 'unpaid' };
  }
  if (VOID_STATUSES.has(status)) {
    const { data } = await supa.rpc('void_tiktok_sale_order', {
      p_tiktok_order_id: tiktokOrderId,
      p_reason: 'TikTok order cancelled',
    });
    const orderId = data?.id as number | undefined;
    if (orderId && data?.previous_status === 'active') {
      queueSaleVoidMirror(supa, orderId).catch(() => {});
    }
    return { action: 'voided', tiktok_order_id: tiktokOrderId, order_id: orderId };
  }
  if (!IMPORT_STATUSES.has(status)) {
    return { action: 'skipped', tiktok_order_id: tiktokOrderId, reason: `status:${status}` };
  }

  const lineItems = extractLineItems(order);
  const paymentMethod = mapPayment(order);
  const payInfo = order.payment || order.payment_info;
  const grandTotal = roundMoney(Number(
    (payInfo as Record<string, unknown>)?.total_amount || order.total_amount || 0,
  ));
  const { vat } = vatBreakdown(grandTotal, 7);
  const subtotal = roundMoney(grandTotal);

  const items: Record<string, unknown>[] = [];
  for (const li of lineItems) {
    const mapped = mapLineItem(li);
    const productId = await matchProduct(supa, li);
    items.push({
      ...mapped,
      product_id: productId,
      discount1_value: 0,
      discount1_type: 'amount',
      discount2_value: 0,
      discount2_type: 'amount',
    });
  }
  if (!items.length) {
    items.push({
      product_id: null,
      product_name: `TikTok #${tiktokOrderId}`,
      quantity: 1,
      unit_price: grandTotal,
      discount1_value: 0,
      discount1_type: 'amount',
      discount2_value: 0,
      discount2_type: 'amount',
    });
  }

  const saleDate = parseSaleDate(order);
  const fulfillment = buildFulfillmentHeader(order, status);

  const existing = await supa.from('sale_orders')
    .select('id')
    .eq('tiktok_order_id', tiktokOrderId)
    .maybeSingle();

  const header = {
    sale_date: saleDate,
    payment_method: paymentMethod,
    tiktok_payment_method: String(order.payment_method_name || order.payment_method || '') || null,
    subtotal,
    total_after_discount: subtotal,
    grand_total: grandTotal,
    vat_rate: 7,
    vat_amount: vat,
    price_includes_vat: true,
    net_received_pending: false,
    notes: `TikTok ${tiktokOrderId}`,
    tiktok_order_id: tiktokOrderId,
    ...fulfillment,
  };

  const { data, error } = await supa.rpc('import_tiktok_sale_order', {
    p_header: header,
    p_items: items,
  });
  if (error) throw new Error(error.message);

  return {
    action: existing?.id ? 'updated' : 'imported',
    tiktok_order_id: tiktokOrderId,
    order_id: data?.id,
  };
}

function mapPayment(order: Record<string, unknown>): string {
  const method = String(order.payment_method_name || order.payment_method || '').toLowerCase();
  if (method.includes('cod') || method.includes('cash')) return 'cod';
  return 'transfer';
}

async function matchProduct(
  supa: SupabaseClient,
  li: Record<string, unknown>,
): Promise<number | null> {
  const skuId = String(li.sku_id || li.id || '');
  const sellerSku = String(li.seller_sku || li.sku_name || '').trim();
  const productName = String(li.product_name || li.sku_name || '');

  if (skuId) {
    const { data: mapped } = await supa.from('tiktok_product_mappings')
      .select('product_id')
      .eq('tiktok_sku_id', skuId)
      .maybeSingle();
    if (mapped?.product_id) return mapped.product_id;
  }

  if (sellerSku) {
    const { data: byBarcode } = await supa.from('products')
      .select('id')
      .eq('barcode', sellerSku)
      .limit(1)
      .maybeSingle();
    if (byBarcode?.id) return byBarcode.id;
  }

  const { data: products } = await supa.from('products')
    .select('id, name, model_code')
    .limit(5000);
  if (!products?.length) return null;

  // SKU-aware auto-match: TikTok seller_sku is the bare model code; POS
  // appends a distributor suffix (DR/VDF/UDF). Only auto-assign when the
  // best candidate is an auto-tier (exact / whitelisted suffix) AND it is
  // clearly ahead of the runner-up — otherwise two distributor variants
  // of the same code could silently pick the wrong product. Lower-tier
  // (generic prefix / fuzzy) matches are left unmatched on purpose so they
  // surface in the "จับคู่สินค้า" queue for one-click confirmation.
  let best: { id: number; score: number; auto: boolean } | null = null;
  let runnerUp = 0;
  if (sellerSku) {
    for (const p of products) {
      const byName = skuMatchTier(sellerSku, p.name || '');
      const byCode = skuMatchTier(sellerSku, p.model_code || '');
      const m = byCode.score > byName.score ? byCode : byName;
      if (m.score <= 0) continue;
      if (!best || m.score > best.score) {
        runnerUp = best?.score ?? 0;
        best = { id: p.id, score: m.score, auto: m.auto };
      } else if (m.score > runnerUp) {
        runnerUp = m.score;
      }
    }
    if (best?.auto && best.score - runnerUp >= 0.04) return best.id;
  }

  // Fallback: fuzzy product-name match (kept strict to avoid wrong stock).
  if (!productName) return null;
  let fuzzyBest: { id: number; score: number } | null = null;
  for (const p of products) {
    const score = Math.max(
      similarityScore(productName, p.name || ''),
      similarityScore(productName, p.model_code || ''),
    );
    if (score >= 0.92 && (!fuzzyBest || score > fuzzyBest.score)) {
      fuzzyBest = { id: p.id, score };
    }
  }
  return fuzzyBest?.id ?? null;
}

/**
 * Search orders within a time window, following page_token until exhausted.
 * `field` chooses create_time vs update_time so status changes get re-synced.
 */
export async function searchOrdersPaged(
  supa: SupabaseClient,
  hours: number,
  field: 'create_time' | 'update_time' = 'create_time',
  maxPages = 20,
): Promise<string[]> {
  const { accessToken, shopCipher } = await getValidAccessToken(supa);
  const timeGe = Math.floor((Date.now() - hours * 3600 * 1000) / 1000);
  const ids = new Set<string>();
  let pageToken = '';
  // Resilient: return whatever we collected if a page fails (never throw).
  for (let page = 0; page < maxPages; page++) {
    try {
      const query: Record<string, string | number> = { page_size: 100 };
      if (pageToken) query.page_token = pageToken;
      const data = await apiPost(
        '/order/202309/orders/search',
        query,
        accessToken,
        shopCipher,
        {
          sort_field: field,
          sort_order: 'DESC',
          [`${field}_ge`]: timeGe,
        },
      );
      const orders = (data?.orders || data?.order_list || []) as Record<string, unknown>[];
      for (const o of orders) {
        const id = String(o.id || o.order_id || '');
        if (id) ids.add(id);
      }
      pageToken = String(data?.next_page_token || '');
      if (!pageToken || !orders.length) break;
    } catch (_e) {
      break;
    }
  }
  return [...ids];
}

/** Union of orders by both create_time and update_time windows. */
export async function searchRecentOrders(supa: SupabaseClient, hours = 24): Promise<string[]> {
  const settled = await Promise.allSettled([
    searchOrdersPaged(supa, hours, 'create_time'),
    searchOrdersPaged(supa, hours, 'update_time'),
  ]);
  const ids = new Set<string>();
  for (const s of settled) {
    if (s.status === 'fulfilled') s.value.forEach((id) => ids.add(id));
  }
  return [...ids];
}

/**
 * Search by TikTok order_status (ที่จะจัดส่ง / จัดส่งแล้ว ฯลฯ).
 * Each status searched independently — one failing status won't abort the rest.
 */
export async function searchOrdersByStatus(
  supa: SupabaseClient,
  statuses: string[],
  hours = 720,
  maxPages = 20,
  { useTimeFilter = true }: { useTimeFilter?: boolean } = {},
): Promise<string[]> {
  const { accessToken, shopCipher } = await getValidAccessToken(supa);
  const timeGe = Math.floor((Date.now() - hours * 3600 * 1000) / 1000);
  const ids = new Set<string>();
  for (const status of statuses) {
    let pageToken = '';
    for (let page = 0; page < maxPages; page++) {
      try {
        const query: Record<string, string | number> = { page_size: 100 };
        if (pageToken) query.page_token = pageToken;
        const body: Record<string, unknown> = {
          order_status: status,
          sort_field: 'create_time',
          sort_order: 'DESC',
        };
        if (useTimeFilter) body.create_time_ge = timeGe;
        const data = await apiPost(
          '/order/202309/orders/search',
          query,
          accessToken,
          shopCipher,
          body,
        );
        const orders = (data?.orders || data?.order_list || []) as Record<string, unknown>[];
        for (const o of orders) {
          const id = String(o.id || o.order_id || '');
          if (id) ids.add(id);
        }
        pageToken = String(data?.next_page_token || '');
        if (!pageToken || !orders.length) break;
      } catch (_e) {
        break; // move on to next status
      }
    }
  }
  return [...ids];
}

/** Statuses that count as "ที่จะจัดส่ง" — รอจัดส่ง + รอเข้ารับ (+ ส่งบางส่วน) */
export const TO_SHIP_STATUSES = ['AWAITING_SHIPMENT', 'AWAITING_COLLECTION', 'PARTIALLY_SHIPPING'];

/**
 * Order discovery for a poll, prioritised so important orders import first:
 *   1. awaiting (ที่จะจัดส่ง) — always refreshed
 *   2. in-transit / awaiting collection
 *   3. recent by create/update time
 * Returns { awaiting, others } so the caller can force-update awaiting only.
 */
export async function discoverPollOrders(
  supa: SupabaseClient,
  hours = 168,
): Promise<{ awaiting: string[]; others: string[] }> {
  const settled = await Promise.allSettled([
    searchOrdersByStatus(supa, TO_SHIP_STATUSES, hours, 50, { useTimeFilter: false }),
    searchOrdersByStatus(
      supa,
      ['IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'ON_HOLD', 'CANCELLED'],
      hours,
      50,
      { useTimeFilter: false },
    ),
    searchRecentOrders(supa, hours),
  ]);
  const awaiting = settled[0].status === 'fulfilled' ? settled[0].value : [];
  const awaitingSet = new Set(awaiting);
  const others = new Set<string>();
  for (let i = 1; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === 'fulfilled') {
      s.value.forEach((id) => { if (!awaitingSet.has(id)) others.add(id); });
    }
  }
  return { awaiting, others: [...others] };
}

/**
 * POS rows still marked "ที่จะจัดส่ง" but no longer returned by TikTok's
 * awaiting search — force re-import so tiktok_order_status catches up.
 */
export async function discoverStaleToShipInDb(supa: SupabaseClient): Promise<string[]> {
  const { data, error } = await supa.from('sale_orders')
    .select('tiktok_order_id')
    .eq('channel', 'tiktok')
    .in('status', ['active', 'pending'])
    .in('tiktok_order_status', TO_SHIP_STATUSES)
    .not('tiktok_order_id', 'is', null);
  if (error) throw error;
  return (data || [])
    .map((r) => String((r as { tiktok_order_id: unknown }).tiktok_order_id))
    .filter(Boolean);
}

/** Fetch fresh order detail from TikTok (for shipping labels). */
export async function fetchTikTokOrderDetail(
  supa: SupabaseClient,
  tiktokOrderId: string,
): Promise<Record<string, unknown>> {
  const { accessToken, shopCipher } = await getValidAccessToken(supa);
  const detail = await apiGet(
    '/order/202309/orders',
    { ids: tiktokOrderId },
    accessToken,
    shopCipher,
  );
  const orders = (detail?.orders as Record<string, unknown>[]) || [];
  if (!orders.length) throw new Error('Order not found on TikTok');
  return orders[0];
}
