// Shared TikTok catalog + mappings + POS stocks for receive mirror (manual + bulk).
import { useCallback, useEffect, useRef, useState } from 'react';
import { mapError } from '../lib/error-map.js';
import { filterTikTokSkusByTerm } from '../lib/tiktok-receive-match.js';
import {
  fetchPosStocks,
  fetchTikTokMappings,
  catalogCapWarning,
  loadTikTokFullCatalog,
  subscribeTiktokMappingChanges,
} from '../lib/tiktok-inventory-sync.js';

// The shop's full active TikTok catalog is small enough (~2k SKUs) to pull once
// and match locally — exactly how TikTokConfirmPanel filters a preloaded POS
// catalog on the sales side. TikTok's catalog keyword search IGNORES the
// seller_sku filter (it returns the same first page for any term), so per-line
// server search never finds models on later pages. An empty query, by contrast,
// pages the whole catalog — so we load it all and filter in the browser.
//
// NOTE: the edge function caps at TIKTOK_CATALOG_MAX_PAGES × 50 listings
// (1000). When the shop goes past it, loadError carries a warning so the cut
// is visible instead of silently missing SKUs.

function productIdsFromLines(lines) {
  return [...new Set((lines || []).map(l => l.product_id).filter(Boolean))];
}

function lineProductSignature(lines) {
  return productIdsFromLines(lines).sort().join('|');
}

export function useTikTokMirrorCatalog({ enabled, mirrorEnabled = enabled, lines }) {
  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [mappingsByProductId, setMappingsByProductId] = useState({});
  const [stocksByProductId, setStocksByProductId] = useState({});
  const [loadError, setLoadError] = useState(null);
  const catalogRef = useRef([]);
  const linesRef = useRef(lines);
  const catalogReqIdRef = useRef(0);
  const mapReqIdRef = useRef(0);
  linesRef.current = lines;

  const productSig = lineProductSignature(lines);

  // ── Load the full active TikTok catalog once per enable ──────────────────
  const loadCatalog = useCallback(async () => {
    if (!enabled) {
      catalogRef.current = [];
      setCatalog([]);
      setLoadError(null);
      setCatalogLoading(false);
      return;
    }
    const reqId = ++catalogReqIdRef.current;
    setCatalogLoading(true);
    setLoadError(null);
    try {
      const { skus: full, catalog: stats } = await loadTikTokFullCatalog();
      if (reqId !== catalogReqIdRef.current) return;
      catalogRef.current = full;
      setCatalog(full);
      if (!full.length) {
        setLoadError('ไม่พบสินค้าใน TikTok Shop — ตรวจการเชื่อมต่อ / scope Product');
      } else {
        const capWarn = catalogCapWarning(stats);
        if (capWarn) setLoadError(capWarn);
      }
    } catch (e) {
      if (reqId === catalogReqIdRef.current) {
        catalogRef.current = [];
        setCatalog([]);
        setLoadError(mapError(e));
      }
    } finally {
      if (reqId === catalogReqIdRef.current) setCatalogLoading(false);
    }
  }, [enabled]);

  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  // ── Load mappings + POS stocks for the current receive lines ─────────────
  useEffect(() => {
    if (!mirrorEnabled) {
      setMappingsByProductId({});
      setStocksByProductId({});
      return;
    }
    const ids = productIdsFromLines(linesRef.current);
    if (!ids.length) {
      setMappingsByProductId({});
      setStocksByProductId({});
      return;
    }
    const reqId = ++mapReqIdRef.current;
    (async () => {
      try {
        const [mappings, stocks] = await Promise.all([
          fetchTikTokMappings(ids),
          fetchPosStocks(ids),
        ]);
        if (reqId !== mapReqIdRef.current) return;
        const mapByProduct = {};
        for (const m of mappings) {
          if (m.product_id) mapByProduct[m.product_id] = m;
        }
        setMappingsByProductId(mapByProduct);
        setStocksByProductId(stocks);
      } catch (e) {
        if (reqId === mapReqIdRef.current) {
          console.warn('[useTikTokMirrorCatalog] mappings/stocks failed:', mapError(e));
        }
      }
    })();
  }, [mirrorEnabled, productSig]);

  // Local search over the preloaded catalog (no API round-trip per keystroke).
  const searchCatalog = useCallback(async (query, opts = {}) => {
    const q = (query || '').trim();
    const base = catalogRef.current;
    if (!q) return base;
    return filterTikTokSkusByTerm(q, base, { minScore: 0.5, limit: opts.limit ?? 50 });
  }, []);

  const refreshMappings = useCallback(async (productIds) => {
    const ids = [...new Set((productIds || []).filter(Boolean))];
    if (!ids.length) return {};
    const mappings = await fetchTikTokMappings(ids);
    const patch = {};
    for (const m of mappings) {
      if (m.product_id) patch[m.product_id] = m;
    }
    // Drop ids that no longer have a mapping (unlinked / moved away) so their
    // badge disappears instead of showing the old SKU.
    setMappingsByProductId(prev => {
      const next = { ...prev, ...patch };
      for (const id of ids) {
        if (!patch[id]) delete next[id];
      }
      return next;
    });
    return patch;
  }, []);

  useEffect(() => {
    if (!mirrorEnabled) return undefined;
    const unsub = subscribeTiktokMappingChanges((productId) => {
      const pid = Number(productId);
      const watched = productIdsFromLines(linesRef.current);
      if (watched.includes(pid) || watched.includes(productId)) {
        refreshMappings([pid || productId]).catch(() => {});
      }
    });
    return unsub;
  }, [mirrorEnabled, refreshMappings]);

  return {
    catalog,
    catalogLoading,
    mappingsByProductId,
    stocksByProductId,
    loadError,
    searchCatalog,
    refreshMappings,
    reloadCatalog: loadCatalog,
  };
}
