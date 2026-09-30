// Page-number helpers for list paging.

export function pageCount(total, pageSize) {
  return Math.max(1, Math.ceil((Number(total) || 0) / pageSize));
}

/**
 * Page buttons to show: always first + last, a window around the current
 * page, and 'gap' markers where pages are skipped. `current` is 0-based.
 * e.g. (current 5 of 12) → [0,'gap',4,5,6,'gap',11]
 */
export function pageItems(current, count, radius = 1) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const set = new Set([0, count - 1]);
  for (let i = current - radius; i <= current + radius; i++) {
    if (i > 0 && i < count - 1) set.add(i);
  }
  // Keep the window a steady width near the ends.
  if (current <= radius + 1) for (let i = 1; i <= radius * 2 + 1; i++) set.add(i);
  if (current >= count - radius - 2) for (let i = count - radius * 2 - 2; i < count - 1; i++) set.add(i);
  const sorted = [...set].filter((i) => i >= 0 && i < count).sort((a, b) => a - b);
  const out = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(p - sorted[i - 1] === 2 ? p - 1 : 'gap');
    out.push(p);
  });
  return out;
}
