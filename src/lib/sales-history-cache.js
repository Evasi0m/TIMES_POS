// Session cache for SalesView — keyed by date/channel/void filter.
// Survives component remount when switching POS tabs.

import { fetchAll } from './sb-paginate.js';
import { startOfDayBangkok, endOfDayBangkok } from './date.js';
import { ECOMMERCE_CHANNELS, excludePendingTikTok } from './ecommerce-channels.js';
import { fetchReceiveCostTimeline } from './receive-cost.js';
import { fetchVoidStockStatusMap } from './sale-void-stock-status.js';
import { applyDiscounts } from './money.js';
import { saleLineSku, saleLineSearchText, saleLineIsSubstitution } from './sale-line-display.js';
import {
  SALE_ORDER_LIST_SELECT,
  SALE_ORDER_ITEM_SUMMARY_SELECT,
} from './sale-query-select.js';

/** @typedef {{ orders: object[], orderSummary: object, voidStockStatus: object, fetchedAt: number, _itemsByOrder: Record<number, object[]>, _recvMap: object, _prodMap: object }} SalesHistoryBundle */

/** @type {Map<string, SalesHistoryBundle>} */
const _cacheByKey = new Map();
/** @type {Map<string, Promise<{ bundle: SalesHistoryBundle | null, error: Error | null }>>} */
const _loadingByKey = new Map();
/** @type {string | null} */
let _activeFilterKey = null;

function normalizeCostToGross(snapCost, latestRecvPrice) {
  const c = Number(snapCost) || 0;
  const r = Number(latestRecvPrice) || 0;
  if (c <= 0 || r <= 0) return c;
  if (Math.abs(c - r) < 0.5) return c;
  if (Math.abs(c - r / 1.07) < 0.5) return r;
  if (Math.abs(c - r * 1.07) < 0.5) return r;
  return c;
}

export function buildSalesFilterKey({ from, to, channel, excludeVoided }) {
  return `${from}_${to}_${channel}_${excludeVoided}`;
}

export function getCachedFilterKey() {
  return _activeFilterKey;
}

export function getCachedSalesHistoryBundle(filterKey) {
  return _cacheByKey.get(filterKey) ?? null;
}

/**
 * Build per-order summary for list rows (profit, SKU label, search blob).
 * @param {object[]} ordersList
 * @param {Record<number, object[]>} itemsByOrder
 * @param {object} recvMap
 * @param {Record<number, number>} prodMap
 */
export function buildOrderSummary(ordersList, itemsByOrder, recvMap, prodMap) {
  const summary = {};
  for (const o of ordersList) {
    const lines = itemsByOrder[o.id] || [];
    const lineRevenues = lines.map((it) => applyDiscounts(
      it.unit_price, it.quantity,
      it.discount1_value, it.discount1_type,
      it.discount2_value, it.discount2_type,
    ));
    const subtotalCalc = lineRevenues.reduce((s, x) => s + x, 0);
    const revenueBase = (ECOMMERCE_CHANNELS.has(o.channel) && o.net_received != null)
      ? Number(o.net_received)
      : Number(o.grand_total) || 0;
    const ratio = subtotalCalc > 0 ? revenueBase / subtotalCalc : 1;
    const saleTs = new Date(o.sale_date).getTime();
    let totalProfit = 0;
    let costApprox = false;
    lines.forEach((it, idx) => {
      const qty = Number(it.quantity) || 0;
      const lineRev = lineRevenues[idx] * ratio;
      let unitCost = 0;
      if (it.cost_price != null) {
        const snap = Number(it.cost_price) || 0;
        const list = it.product_id ? recvMap[it.product_id] : null;
        const peer = (list && list.length) ? list.find((r) => r.date <= saleTs) : null;
        unitCost = normalizeCostToGross(snap, peer ? peer.unit_price : 0);
      } else if (it.product_id) {
        const list = recvMap[it.product_id];
        if (list && list.length) {
          const found = list.find((r) => r.date <= saleTs);
          if (found) unitCost = found.unit_price;
          else { unitCost = prodMap[it.product_id] || 0; costApprox = true; }
        } else {
          unitCost = prodMap[it.product_id] || 0;
          costApprox = true;
        }
      }
      totalProfit += lineRev - unitCost * qty;
    });
    const productLabel = lines.length === 0 ? '—'
      : lines.length === 1 ? saleLineSku(lines[0])
        : `${saleLineSku(lines[0])} +${lines.length - 1}`;
    summary[o.id] = {
      productLabel,
      allProductNames: lines.map((l) => saleLineSearchText(l)),
      profit: (o.status === 'voided' || o.net_received_pending) ? 0 : totalProfit,
      itemCount: lines.length,
      costApprox,
      hasSubstitution: o.has_substitution ?? lines.some((l) => saleLineIsSubstitution(l)),
    };
  }
  return summary;
}

function recomputeOrderSummaryEntry(order, itemsByOrder, recvMap, prodMap) {
  const partial = buildOrderSummary([order], itemsByOrder, recvMap, prodMap);
  return partial[order.id] ?? null;
}

async function loadBundleFromNetwork(sb, { from, to, channel, excludeVoided }) {
  const { data, error } = await fetchAll((fromIdx, toIdx) => {
    let q = excludePendingTikTok(sb.from('sale_orders').select(SALE_ORDER_LIST_SELECT))
      .gte('sale_date', startOfDayBangkok(from))
      .lte('sale_date', endOfDayBangkok(to))
      .order('sale_date', { ascending: false })
      .range(fromIdx, toIdx);
    if (channel) q = q.eq('channel', channel);
    if (excludeVoided) q = q.eq('status', 'active');
    return q;
  });

  if (error) return { bundle: null, error };

  const ordersList = data || [];
  let orderSummary = {};
  let itemsByOrder = {};
  let recvMap = {};
  let prodMap = {};

  if (ordersList.length) {
    const orderIds = ordersList.map((o) => o.id);
    const { data: itemsData, error: itemsErr } = await fetchAll((fromIdx, toIdx) =>
      sb.from('sale_order_items').select(SALE_ORDER_ITEM_SUMMARY_SELECT)
        .in('sale_order_id', orderIds).range(fromIdx, toIdx),
    );
    if (itemsErr) return { bundle: null, error: itemsErr };

    const items = itemsData || [];
    const pids = [...new Set(items.map((i) => i.product_id).filter(Boolean))];

    if (pids.length) {
      const { map, error: recvErr } = await fetchReceiveCostTimeline(
        sb, pids, endOfDayBangkok(to),
      );
      if (!recvErr) recvMap = map;
    }

    if (pids.length) {
      const { data: prods } = await fetchAll((fromIdx, toIdx) =>
        sb.from('products').select('id, cost_price').in('id', pids).range(fromIdx, toIdx),
      );
      (prods || []).forEach((p) => { prodMap[p.id] = Number(p.cost_price) || 0; });
    }

    items.forEach((it) => { (itemsByOrder[it.sale_order_id] ||= []).push(it); });
    orderSummary = buildOrderSummary(ordersList, itemsByOrder, recvMap, prodMap);
  }

  let voidStockStatus = {};
  const voidedIds = ordersList.filter((o) => o.status === 'voided').map((o) => o.id);
  if (voidedIds.length) {
    try {
      voidStockStatus = await fetchVoidStockStatusMap(sb, voidedIds);
    } catch {
      voidStockStatus = {};
    }
  }

  const bundle = {
    orders: ordersList,
    orderSummary,
    voidStockStatus,
    fetchedAt: Date.now(),
    _itemsByOrder: itemsByOrder,
    _recvMap: recvMap,
    _prodMap: prodMap,
  };
  return { bundle, error: null };
}

/**
 * @returns {Promise<{ bundle: SalesHistoryBundle | null, error: Error | null, fromCache: boolean, filterKey: string }>}
 */
export async function getSalesHistoryBundle(sb, { from, to, channel, excludeVoided, force = false } = {}) {
  const filterKey = buildSalesFilterKey({ from, to, channel, excludeVoided });

  if (!force && _cacheByKey.has(filterKey)) {
    _activeFilterKey = filterKey;
    return {
      bundle: _cacheByKey.get(filterKey),
      error: null,
      fromCache: true,
      filterKey,
    };
  }

  if (!force && _loadingByKey.has(filterKey)) {
    const res = await _loadingByKey.get(filterKey);
    return { ...res, fromCache: false, filterKey };
  }

  if (force) {
    _cacheByKey.delete(filterKey);
  }

  const promise = loadBundleFromNetwork(sb, { from, to, channel, excludeVoided }).then((res) => {
    _loadingByKey.delete(filterKey);
    if (res.error) return res;
    _cacheByKey.set(filterKey, res.bundle);
    _activeFilterKey = filterKey;
    return res;
  });

  _loadingByKey.set(filterKey, promise);
  const res = await promise;
  return { ...res, fromCache: false, filterKey };
}

/** Patch one order in the cached bundle for the given (or active) filter key. */
export function patchOrderInCache(orderId, partial, { filterKey } = {}) {
  const key = filterKey ?? _activeFilterKey;
  if (!key) return false;
  const entry = _cacheByKey.get(key);
  if (!entry) return false;

  const idx = entry.orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return false;

  const updated = { ...entry.orders[idx], ...partial };
  entry.orders[idx] = updated;

  const lines = entry._itemsByOrder[orderId] || [];
  const summaryEntry = recomputeOrderSummaryEntry(
    updated,
    { [orderId]: lines },
    entry._recvMap,
    entry._prodMap,
  );
  if (summaryEntry) {
    entry.orderSummary[orderId] = summaryEntry;
  }
  return true;
}

/** Remove one order from cache (e.g. after void when excludeVoided=true). */
export function removeOrderFromCache(orderId, { filterKey } = {}) {
  const key = filterKey ?? _activeFilterKey;
  if (!key) return false;
  const entry = _cacheByKey.get(key);
  if (!entry) return false;
  entry.orders = entry.orders.filter((o) => o.id !== orderId);
  delete entry.orderSummary[orderId];
  delete entry._itemsByOrder[orderId];
  delete entry.voidStockStatus[orderId];
  return true;
}

export function invalidateSalesHistoryCache(filterKey) {
  if (filterKey) {
    _cacheByKey.delete(filterKey);
    _loadingByKey.delete(filterKey);
    if (_activeFilterKey === filterKey) _activeFilterKey = null;
    return;
  }
  _cacheByKey.clear();
  _loadingByKey.clear();
  _activeFilterKey = null;
}

/** @internal Test-only reset */
export function _resetSalesHistoryCacheForTests() {
  invalidateSalesHistoryCache();
}
