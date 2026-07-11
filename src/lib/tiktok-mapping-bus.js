// Cross-view invalidation when a TikTok mapping is persisted (same browser tab).

const mappingChangeSubs = new Set();

/** Subscribe to mapping changes; listener(productId) fires after successful persist. */
export function subscribeTiktokMappingChanges(listener) {
  if (typeof listener !== 'function') return () => {};
  mappingChangeSubs.add(listener);
  return () => { mappingChangeSubs.delete(listener); };
}

export function notifyTiktokMappingChanged(productId) {
  if (productId == null) return;
  for (const fn of mappingChangeSubs) {
    try { fn(productId); } catch (err) {
      console.warn('[TikTok mapping] change listener failed:', err);
    }
  }
}
