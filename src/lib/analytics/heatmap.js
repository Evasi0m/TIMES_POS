// Hour-of-day × Day-of-week heatmap bucketing.
//
// Input:  sale_orders rows with { sale_date: timestamptz, revenue: number }
//         (revenue is already computed by the caller — net_received for
//         e-commerce, grand_total for in-store — keeping this module
//         channel-agnostic.)
// Output: a 7×24 matrix where rows are Sunday..Saturday (0..6 = Mon..Sun
//         in the Bangkok-business-week convention) and columns are hours
//         0..23 in **Bangkok time**. Cell value = sum of revenue.
//
// Why Bangkok time here?
//   The heatmap is used to plan staff shifts and promotions — "Saturday
//   evenings sell best" only makes sense if Saturday means what the owner
//   thinks it means. Converting once at the library boundary means the
//   rest of the code stays naive about TZ.

const BANGKOK_OFFSET_MIN = 7 * 60;

/** Week-day order used by the UI: 0=Mon, 1=Tue, …, 6=Sun (Thai convention). */
export const WEEKDAY_LABELS_TH = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

/** Shift a Date to Bangkok wall-clock components without touching TZ libs. */
function bangkokParts(d) {
  // Reject missing / falsy inputs up front. Note that `new Date(null)`
  // silently yields the epoch (1970-01-01), so null must be filtered
  // BEFORE the Date constructor — otherwise it lands in Thu 07:00.
  if (d == null || d === '') return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  // Shift UTC epoch by Bangkok's offset, then read the fields as UTC —
  // the result *is* Bangkok wall clock. Local TZ is irrelevant here, so
  // tests behave identically on a Bangkok laptop and a UTC CI runner.
  const shifted = new Date(t.getTime() + BANGKOK_OFFSET_MIN * 60000);
  // getUTCDay: 0=Sun..6=Sat — remap to 0=Mon..6=Sun (Thai business week).
  const rawDow = shifted.getUTCDay();
  const dow = rawDow === 0 ? 6 : rawDow - 1;
  return { dow, hour: shifted.getUTCHours() };
}

/**
 * Bucket rows into a 7×24 matrix of revenue totals.
 *
 * @param {Array<{sale_date: string|Date, revenue: number}>} rows
 * @returns {{
 *   matrix: number[][],   // [dow][hour] = revenue
 *   maxCell: number,      // for color-scale normalization
 *   total:   number       // cross-check against the dashboard
 * }}
 */
export function buildHeatmap(rows) {
  const matrix = Array.from({ length: 7 }, () => Array(24).fill(0));
  let maxCell = 0;
  let total = 0;

  for (const r of rows || []) {
    const p = bangkokParts(r.sale_date);
    if (!p) continue;
    const v = Number(r.revenue) || 0;
    matrix[p.dow][p.hour] += v;
    total += v;
    if (matrix[p.dow][p.hour] > maxCell) maxCell = matrix[p.dow][p.hour];
  }

  return { matrix, maxCell, total };
}

/**
 * Busiest cell helper for summary text.
 * Returns { dow, hour, revenue } of the single highest cell, or null if
 * the heatmap is empty.
 */
export function peakCell({ matrix }) {
  let best = { dow: -1, hour: -1, revenue: 0 };
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (matrix[d][h] > best.revenue) {
        best = { dow: d, hour: h, revenue: matrix[d][h] };
      }
    }
  }
  return best.revenue > 0 ? best : null;
}
