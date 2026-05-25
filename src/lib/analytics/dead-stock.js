// Dead-stock = สินค้าที่ยังมีใน stock แต่ไม่ขายมานานเกิน threshold.
//
// Pure: caller fetches products + builds lastSoldMap (product_id → latest
// sale_date). We just filter + sort + attach the "มูลค่าจม" (opportunity
// cost = cost_price × current_stock).

const MS_PER_DAY = 86400000;

/**
 * @param {Array<{id, name, current_stock, cost_price}>} products
 * @param {Map<number, string|Date>} lastSoldMap   product_id → last sale date
 * @param {{ thresholdDays?: number, now?: number }} opts
 * @returns {Array<{
 *   id, name, current_stock, cost_price,
 *   last_sold_at: string|null,
 *   days_since_sold: number,            // Infinity = never sold
 *   locked_value: number                // cost_price × current_stock
 * }>} — sorted by locked_value desc (biggest opportunity cost first)
 */
export function deadStockReport(products, lastSoldMap, { thresholdDays = 60, now = Date.now() } = {}) {
  const out = [];
  for (const p of products || []) {
    const stock = Number(p.current_stock) || 0;
    if (stock <= 0) continue;
    const last = lastSoldMap?.get(p.id);
    const lastTs = last ? new Date(last).getTime() : null;
    const days = lastTs ? Math.floor((now - lastTs) / MS_PER_DAY) : Infinity;
    if (days < thresholdDays) continue;
    const cost = Number(p.cost_price) || 0;
    out.push({
      id: p.id,
      name: p.name,
      current_stock: stock,
      cost_price: cost,
      last_sold_at: last ? new Date(last).toISOString() : null,
      days_since_sold: days,
      locked_value: cost * stock,
    });
  }
  // Biggest opportunity cost first — that's what the owner wants to see.
  out.sort((a, b) => b.locked_value - a.locked_value);
  return out;
}
