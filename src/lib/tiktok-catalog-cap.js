// Pure: no Supabase import, so it is unit-testable on any Node.

/** Thai warning when the catalog is at / near the load cap, else null. */
export function catalogCapWarning(catalog) {
  if (!catalog) return null;
  const max = Number(catalog.max_products) || 0;
  const total = Number(catalog.total ?? catalog.products) || 0;
  if (catalog.truncated || (max && total > max)) {
    const count = !catalog.truncated && total ? `${total}` : `เกิน ${max}`;
    return `TikTok มี ${count} listing เกินเพดาน ${max} — บางรุ่นจะค้น/จับคู่ไม่เจอ ต้องขยายเพดานใน tiktok-products-search`;
  }
  if (max && total >= max * 0.8) {
    return `TikTok มี ${total} listing ใกล้เพดาน ${max} แล้ว — ควรขยายเพดานก่อนเกิน`;
  }
  return null;
}
