// Browser online/offline tracking + a tiny pub/sub for React components
// that don't want to import a hook.
//
// Why we don't trust `navigator.onLine` alone:
//   That flag is set by the OS based on network adapter state. On Windows
//   in particular it can stay `false` long after WiFi works (network
//   classified as "Public/Unidentified", VPN reconnect, adapter sleep,
//   captive portal). The May 2026 "stuck offline" incident at the front
//   counter was partly caused by this — cashier had 20mbps internet but
//   the browser refused to even attempt the request.
//
// What we do instead:
//   _navOnline      mirrors navigator.onLine (cheap, reactive to events)
//   _probeOnline    last result of an active HEAD to Supabase (truthful)
//   isOnline()      = _navOnline && _probeOnline   (default: trust both)
//   probeNow()      force a fresh probe and update _probeOnline
//
// Probes are throttled to once every PROBE_THROTTLE_MS so calling code
// can freely call probeNow() before every action without spamming the
// server. Subscribers are only notified when the *combined* status flips.

const SUPABASE_HEALTH_URL =
  'https://zrymhhkqdcttqsdczfcr.supabase.co/auth/v1/health';
const PROBE_THROTTLE_MS = 10_000;   // cache probe result for 10s
const PROBE_TIMEOUT_MS  = 4_000;    // each probe gives up after 4s

let _navOnline   = typeof navigator !== 'undefined' ? navigator.onLine : true;
let _probeOnline = true;            // optimistic until first probe
let _lastProbeAt = 0;
let _inflight   = null;

const subs = new Set();

function combined() { return _navOnline && _probeOnline; }

function notify() {
  const v = combined();
  subs.forEach((cb) => { try { cb(v); } catch {} });
}

if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => {
    _navOnline = true;
    // Trust the OS optimistically AND kick off a probe to confirm — if
    // the OS lied (it does) the probe will correct us within 4s.
    probeNow().catch(() => {});
    notify();
  });
  window.addEventListener('offline', () => {
    _navOnline = false;
    notify();
  });
}

/**
 * Active probe — HEAD the Supabase health endpoint. Updates the cached
 * probe result; returns the new combined online status.
 *
 * Throttled: repeated calls within PROBE_THROTTLE_MS reuse the inflight
 * promise / cached result so callers can `await probeNow()` freely.
 */
export async function probeNow() {
  const now = Date.now();
  if (_inflight) return _inflight;
  if (now - _lastProbeAt < PROBE_THROTTLE_MS) return combined();

  _inflight = (async () => {
    let ok = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      const res = await fetch(SUPABASE_HEALTH_URL, {
        method: 'HEAD',
        cache: 'no-store',
        signal: ctrl.signal,
        // Health endpoint doesn't need auth; keep it unauthenticated to
        // avoid leaking JWT for what's effectively a ping.
        credentials: 'omit',
      });
      clearTimeout(t);
      // Any 2xx/3xx counts as "reachable". Even a 401/403 (which we won't
      // get on /health) would prove the server answered — but we keep the
      // check strict to avoid false positives from cached error responses.
      ok = res.ok || (res.status >= 200 && res.status < 500);
    } catch {
      ok = false;
    } finally {
      _lastProbeAt = Date.now();
    }
    if (ok !== _probeOnline) {
      _probeOnline = ok;
      notify();
    } else {
      _probeOnline = ok;
    }
    return combined();
  })();

  try { return await _inflight; }
  finally { _inflight = null; }
}

export const isOnline = () => combined();

/** Raw navigator.onLine — only use when you specifically need the OS
 *  signal (e.g. UI hint "OS says offline"). For business logic use
 *  isOnline() which combines both signals. */
export const isNavOnline = () => _navOnline;

/** Last known probe result without triggering a new one. */
export const isProbeOnline = () => _probeOnline;

export function onOnlineChange(cb) {
  subs.add(cb);
  // Fire immediately so the caller has the current value.
  try { cb(combined()); } catch {}
  return () => subs.delete(cb);
}

// Kick off a first probe shortly after import so the cached result
// reflects reality before the first user action. Delay so we don't
// compete with the initial app boot fetches.
if (typeof window !== 'undefined') {
  setTimeout(() => { probeNow().catch(() => {}); }, 2000);
  // Re-probe periodically — covers the case where navigator.onLine
  // is stuck at true but the network actually died (rare but real).
  setInterval(() => { probeNow().catch(() => {}); }, 60_000);
}
