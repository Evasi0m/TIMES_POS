import { useEffect, useRef } from 'react';
import { subscribeTable } from './realtime-bus.js';

/**
 * Debounced invalidation scheduler with optional minimum interval between fires.
 * Exported for unit tests — production code uses via useRealtimeInvalidate.
 */
export function createDebouncedInvalidate({ debounceMs = 300, minIntervalMs = 0, onInvalidate }) {
  let timer = null;
  let lastFireAt = 0;

  const fire = () => {
    timer = null;
    const now = Date.now();
    const wait = minIntervalMs > 0 ? minIntervalMs - (now - lastFireAt) : 0;
    if (wait > 0) {
      timer = setTimeout(fire, wait);
      return;
    }
    lastFireAt = Date.now();
    try { onInvalidate?.(); } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[realtime] onInvalidate threw:', err);
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, debounceMs);
  };

  const dispose = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return { schedule, dispose };
}

/**
 * Subscribe to postgres changes on one or more tables and call
 * `onInvalidate()` after a short debounce. Intended for "a row changed
 * somewhere, re-run the view's loader" — NOT for surgical state patching.
 *
 * Why debounced:
 *   - A bulk CSV import of 500 products fires 500 events. Re-running the
 *     loader once at the end is plenty.
 *   - A POS sale writes sale_orders + N sale_order_items in one
 *     transaction — we want one loader run, not N+1.
 *
 * Why not specific per-row patching:
 *   - The views already have loaders that query + join + aggregate. Keeping
 *     the re-query path as the source of truth means realtime can't drift
 *     from the initial-load render. Small perf cost, huge correctness win.
 *
 * Arguments:
 *   sb            Supabase client (passed in so lib is framework-agnostic)
 *   tables        string | string[]  names under public.*
 *   onInvalidate  () => void (fired after the idle window)
 *   options.debounceMs    default 300
 *   options.minIntervalMs default 0 — minimum ms between consecutive fires
 *   options.enabled       default true — flip false to pause without unsubscribing
 *                         every dependency change (useful when the view hides)
 */
export function useRealtimeInvalidate(sb, tables, onInvalidate, options = {}) {
  const { debounceMs = 300, minIntervalMs = 0, enabled = true } = options;

  // Keep onInvalidate stable across renders without re-subscribing.
  const cbRef = useRef(onInvalidate);
  useEffect(() => { cbRef.current = onInvalidate; }, [onInvalidate]);

  // Normalize to sorted array for a stable dep key.
  const list = Array.isArray(tables) ? tables : [tables];
  const key = [...list].sort().join('|');

  useEffect(() => {
    if (!enabled) return;
    const { schedule, dispose } = createDebouncedInvalidate({
      debounceMs,
      minIntervalMs,
      onInvalidate: () => cbRef.current?.(),
    });

    const unsubs = list.map((t) => subscribeTable(sb, t, schedule));
    return () => {
      dispose();
      unsubs.forEach((u) => u && u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, key, debounceMs, minIntervalMs, enabled]);
}
