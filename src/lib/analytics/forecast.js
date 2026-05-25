// Reorder quantity suggestion based on velocity + target coverage.
//
// Formula (deliberately simple — owner understands it, can second-guess it):
//   targetStock     = avgPerDay × targetWeeks × 7
//   suggestedReorder = max(0, ceil(targetStock - currentStock))
//
// Safety: if velocity is 0 (product never sold in window) we return 0 —
// don't suggest reordering dead stock. If velocity is "high" (>2/day) we
// nudge the suggestion up by a buffer so the shop doesn't stock out
// mid-week while a new receive batch is in transit.

const DAYS_PER_WEEK = 7;

/**
 * @param {{
 *   avgPerDay:     number,   // from velocity.js
 *   currentStock:  number,
 *   targetWeeks:   number,   // default 6 weeks (agreed with owner)
 *   bufferFrac:    number,   // fraction buffer for fast movers, default 0.15
 * }} opts
 * @returns {{
 *   avgPerDay:        number,
 *   daysOfStockLeft:  number,   // Infinity when avgPerDay = 0
 *   targetStock:      number,
 *   suggestedReorder: number,
 * }}
 */
export function reorderSuggestion({
  avgPerDay,
  currentStock,
  targetWeeks = 6,
  bufferFrac = 0.15,
} = {}) {
  const v = Math.max(0, Number(avgPerDay) || 0);
  const stock = Math.max(0, Number(currentStock) || 0);

  if (v <= 0) {
    return {
      avgPerDay: 0,
      daysOfStockLeft: Infinity,
      targetStock: 0,
      suggestedReorder: 0,
    };
  }

  // Fast movers (avg > 2 / day) get a 15% buffer so they don't run out
  // between receiving batches.
  const buffer = v > 2 ? bufferFrac : 0;
  const targetStock = Math.ceil(v * targetWeeks * DAYS_PER_WEEK * (1 + buffer));
  const suggestedReorder = Math.max(0, targetStock - stock);

  return {
    avgPerDay: v,
    daysOfStockLeft: stock / v,
    targetStock,
    suggestedReorder,
  };
}
