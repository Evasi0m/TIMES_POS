// Thin wrapper over Supabase Realtime (`sb.channel().on('postgres_changes', …)`).
//
// Why not use sb.channel() directly in each view?
//   - Every view needs the same reconnect/dedupe plumbing.
//   - Subscribing a table twice (once from ProductsView, once from
//     DashboardView) should NOT open two separate channels — Supabase bills
//     + rate-limits per-connection. We multiplex onto one channel per table.
//   - Mobile browsers disconnect Realtime when the tab backgrounds; we want
//     a single place to log reconnects so we can debug "ทำไมไม่อัปเดต".
//
// Public surface:
//   subscribeTable(sb, table, onChange) → unsubscribe()
//     onChange(payload) fires on INSERT/UPDATE/DELETE of `public.<table>`.
//     payload shape is Supabase-native:
//       { eventType, new, old, schema, table, commit_timestamp }
//
// Debouncing / batching is the caller's job (see use-realtime-invalidate.js).
// This module only dedupes subscriptions and hides channel bookkeeping.

const SCHEMA = 'public';

// table → { channel, listeners:Set<fn>, refCount:number }
const registry = new Map();

/**
 * Subscribe to postgres changes on `public.<table>`. Returns an
 * unsubscribe fn. Calling it decrements the refcount; the underlying
 * Realtime channel is removed when refCount hits 0.
 */
export function subscribeTable(sb, table, onChange) {
  if (!sb || typeof sb.channel !== 'function') {
    // Safeguard: in a test env without the Supabase client, no-op.
    return () => {};
  }

  let entry = registry.get(table);
  if (!entry) {
    const listeners = new Set();
    const channelName = `rt:${table}`;
    const channel = sb.channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: SCHEMA, table },
        (payload) => {
          // Fan out to all current listeners. Wrap each in try/catch so one
          // bad handler can't break others.
          for (const fn of listeners) {
            try { fn(payload); } catch (err) {
              // eslint-disable-next-line no-console
              console.error(`[realtime] listener for "${table}" threw:`, err);
            }
          }
        }
      )
      .subscribe((status) => {
        // Useful for debugging "stale data" reports from the field.
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // eslint-disable-next-line no-console
          console.debug(`[realtime] ${table}: ${status}`);
        }
      });
    entry = { channel, listeners, refCount: 0 };
    registry.set(table, entry);
  }

  entry.listeners.add(onChange);
  entry.refCount += 1;

  return () => {
    entry.listeners.delete(onChange);
    entry.refCount -= 1;
    if (entry.refCount <= 0) {
      try { sb.removeChannel(entry.channel); } catch { /* ignore */ }
      registry.delete(table);
    }
  };
}

/** Test-only: reset internal registry (used by unit tests). */
export function _resetRegistry() {
  registry.clear();
}
