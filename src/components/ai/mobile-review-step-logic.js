import {
  firstAttentionRowIndex,
  nextAttentionRowIndex,
  isRowComplete,
} from './bill-review-shared.js';

/** Row to work on after completing the current one (attention order, wraps). */
export function pickNextRowAfterComplete(rows, activeIndex, tiktokMirrorEnabled = false) {
  if (!rows?.length || activeIndex < 0) return null;
  const nextIdx = nextAttentionRowIndex(rows, activeIndex, tiktokMirrorEnabled);
  if (nextIdx >= 0 && nextIdx !== activeIndex) return rows[nextIdx];
  return null;
}

/** First row that still needs attention, or null if all complete. */
export function pickFirstAttentionRow(rows, tiktokMirrorEnabled = false) {
  const idx = firstAttentionRowIndex(rows, tiktokMirrorEnabled);
  return idx >= 0 ? rows[idx] : null;
}

export { isRowComplete };
