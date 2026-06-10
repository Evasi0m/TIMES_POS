// Read-only TikTok product mappings for POS / catalog badge display.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTikTokMappings, getTikTokConnectionStatus } from '../lib/tiktok-inventory-sync.js';

function idsSignature(productIds) {
  return [...new Set((productIds || []).filter(Boolean))].sort((a, b) => a - b).join('|');
}

export function useTikTokProductMappings(productIds, { enabled = true } = {}) {
  const [connected, setConnected] = useState(false);
  const [mappingsByProductId, setMappingsByProductId] = useState({});
  const [loading, setLoading] = useState(false);
  const reqIdRef = useRef(0);

  const sig = useMemo(() => idsSignature(productIds), [productIds]);
  const ids = useMemo(
    () => sig ? sig.split('|').map(n => Number(n)).filter(n => Number.isFinite(n)) : [],
    [sig],
  );

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      setMappingsByProductId({});
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const st = await getTikTokConnectionStatus();
        if (cancel) return;
        const ok = !!st?.connected;
        setConnected(ok);
        if (!ok) {
          setMappingsByProductId({});
          return;
        }
      } catch {
        if (!cancel) {
          setConnected(false);
          setMappingsByProductId({});
        }
        return;
      }
    })();
    return () => { cancel = true; };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !connected || !ids.length) {
      setMappingsByProductId({});
      setLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    let cancel = false;
    (async () => {
      try {
        const rows = await fetchTikTokMappings(ids);
        if (cancel || reqId !== reqIdRef.current) return;
        const map = {};
        for (const row of rows || []) {
          if (row?.product_id != null) map[row.product_id] = row;
        }
        setMappingsByProductId(map);
      } catch {
        if (!cancel && reqId === reqIdRef.current) setMappingsByProductId({});
      } finally {
        if (!cancel && reqId === reqIdRef.current) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [enabled, connected, sig, ids]);

  return { connected, mappingsByProductId, loading };
}
