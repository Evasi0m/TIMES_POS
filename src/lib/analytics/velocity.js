// Product sales velocity + days-of-stock-left.
//
// Pure math: caller is responsible for fetching the sale_order_items rows
// and the current stock snapshot. Separating pure logic from Supabase
// access means we can unit-test edge cases (brand-new product, sporadic
// sales, seasonal items) without mocking the DB.

const MS_PER_DAY = 86400000;

/**
 * Aggregate sale_order_items into per-product daily velocity over the last
 * `windowDays` (default 30) relative to `now`.
 *
 * Input row shape: { product_id, quantity, sale_date }
 * Output: Map<product_id, { totalQty, daysCovered, avgPerDay }>
 *
 * `daysCovered` is min(windowDays, days-since-first-sale-in-window) so
 * brand-new products don't look slower than they really are.
 */
export function velocityByProduct(rows, { now = Date.now(), windowDays = 30 } = {}) {
  const cutoff = now - windowDays * MS_PER_DAY;
  const map = new Map();
  for (const r of rows || []) {
    const t = r.sale_date ? new Date(r.sale_date).getTime() : NaN;
    if (!Number.isFinite(t) || t < cutoff) continue;
    const pid = r.product_id;
    if (pid == null) continue;
    let acc = map.get(pid);
    if (!acc) { acc = { totalQty: 0, firstTs: t, lastTs: t }; map.set(pid, acc); }
    acc.totalQty += Number(r.quantity) || 0;
    if (t < acc.firstTs) acc.firstTs = t;
    if (t > acc.lastTs)  acc.lastTs  = t;
  }

  const out = new Map();
  for (const [pid, acc] of map) {
    const ageDays = Math.max(1, Math.ceil((now - acc.firstTs) / MS_PER_DAY));
    const daysCovered = Math.min(windowDays, ageDays);
    out.set(pid, {
      totalQty: acc.totalQty,
      daysCovered,
      avgPerDay: acc.totalQty / daysCovered,
    });
  }
  return out;
}

/**
 * Days of stock left = currentStock / avgPerDay. Returns Infinity when
 * velocity is 0 (never sold in window → "ไม่มีความต้องการ").
 */
export function daysOfStockLeft(currentStock, avgPerDay) {
  const stock = Number(currentStock) || 0;
  const v = Number(avgPerDay) || 0;
  if (v <= 0) return Infinity;
  return stock / v;
}
