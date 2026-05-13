// recent-receives.js — duplicate-bill guard for receive flows.
//
// PROBLEM: a user enters a CMG bill, then a week later opens the bill
// again (paper bill on the counter looks similar) and re-enters the
// same lines. Stock gets double-counted; supplier_invoice_no may even
// collide if it was filled in. The cost is a real inventory drift that
// only shows up in reports days later.
//
// MITIGATION: surface a small warning badge on any line whose product
// was ALREADY received in the last 7 days. The badge is non-blocking
// (user might legitimately receive the same SKU twice) but visible
// enough to make the user pause and check the bill.
//
// Window choice: 7 days matches the typical CMG bill processing cycle
// — anything older than that is almost certainly a separate shipment;
// anything within is suspicious.
//
// API:
//   useRecentReceivesMap() → { map, refresh }
//     - `map`: Map<product_id, { lastDate, supplier, invoice }> | null
//       (null while initial load is in-flight; callers may render the
//       badge optimistically by `?? new Map()` if they prefer.)
//     - `refresh()`: re-runs the query. Call after a batch save so
//       just-entered bills appear in the duplicate-guard for any
//       subsequent batch in the same session. Without this, the map
//       is stamped on mount and stays stale across batches — exactly
//       the case the badge is supposed to catch.
//     - Excludes voided receive_orders — those never happened from
//       inventory's perspective.

import { useCallback, useEffect, useRef, useState } from 'react';
import { sb } from './supabase-client.js';
import { fetchAll } from './sb-paginate.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function useRecentReceivesMap() {
  const [map, setMap] = useState(null); // null = loading, Map = ready
  // Cancellation token for in-flight loads — bumps on every refresh()
  // so a stale earlier load can't overwrite a newer result.
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    const myReqId = ++reqIdRef.current;
    const cutoffISO = new Date(Date.now() - SEVEN_DAYS_MS).toISOString();
    // !inner forces the join filter to also act as a row filter —
    // without it, supabase-js returns receive_order_items rows whose
    // joined receive_orders is null when the filter mismatches.
    const { data, error } = await fetchAll((fromIdx, toIdx) =>
      sb.from('receive_order_items')
        .select('product_id, receive_orders!inner(id, receive_date, supplier_name, supplier_invoice_no, voided_at)')
        .gte('receive_orders.receive_date', cutoffISO)
        .is('receive_orders.voided_at', null)
        .range(fromIdx, toIdx)
    );
    if (reqIdRef.current !== myReqId) return; // a newer refresh took over
    if (error) {
      // Swallow + log — the badge is purely advisory, never block
      // the receive flow if the query fails.
      console.warn('[recent-receives] load failed:', error);
      setMap(new Map());
      return;
    }
    const m = new Map();
    for (const r of (data || [])) {
      const pid = r.product_id;
      const date = r.receive_orders?.receive_date;
      if (!pid || !date) continue;
      const prev = m.get(pid);
      if (!prev || new Date(date).getTime() > new Date(prev.lastDate).getTime()) {
        m.set(pid, {
          lastDate: date,
          supplier: r.receive_orders?.supplier_name || '',
          invoice: r.receive_orders?.supplier_invoice_no || '',
        });
      }
    }
    setMap(m);
  }, []);

  // R4 fix: bump reqIdRef on unmount so any in-flight load resolves
  // into the `myReqId !== reqIdRef.current` branch and skips its
  // `setMap` call. Without this, navigating away from a view that
  // mounted this hook produces a React setState-on-unmounted-component
  // warning whenever the load is slow.
  useEffect(() => {
    load();
    return () => { reqIdRef.current++; };
  }, [load]);

  return { map, refresh: load };
}

// ─── Helper used by the badge component ──────────────────────────────
// Returns whole-day diff between `now` and `dateStr`. Same-day → 0,
// yesterday → 1, etc. We use floor() rather than round() because "1
// day ago" reads more honestly than "0 days ago" for a 12h gap.
export function daysAgoFrom(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}
