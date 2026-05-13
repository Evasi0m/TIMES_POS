// Service-worker self-heal — protects users from a broken SW that got
// installed in a previous build and is now intercepting fetches in a
// stuck/wrong way (the May 2026 "stuck offline" incident root cause).
//
// Strategy:
//   1. After 3s of page load, check whether navigator.serviceWorker.controller
//      is active.
//   2. If yes, do a HEAD request to ./sw.js (relative, same scope) — if it
//      returns non-200 the SW URL itself is broken (subpath / 404 / CDN
//      misconfig) and the SW we have is necessarily stale.
//   3. Also message the controller asking for its SW_VERSION. If no reply
//      within 2s OR version is a value we explicitly know to be broken,
//      treat it as broken.
//   4. On "broken" verdict: unregister ALL service worker registrations,
//      clear the caches API, reload ONCE. Use a localStorage flag so we
//      never reload-loop.
//
// What we deliberately DO NOT do:
//   - Clear IndexedDB — that holds the offline sale queue (real money!).
//   - Sign the user out — auth session is in storage adapter, leave it.
//   - Run on every load — only after we have evidence something is wrong.

const HEAL_FLAG = 'pos.sw.healed.at';        // ISO timestamp of last heal
const HEAL_COOLDOWN_MS = 60 * 60 * 1000;     // don't heal more than 1x/hour

// SW versions that are known to be broken — when one of these answers
// GET_VERSION we force-unregister immediately. Add to this list whenever
// a deploy turns out to have a bad SW so existing clients self-recover.
const KNOWN_BAD_VERSIONS = new Set([
  // (empty for now — the previous bug never set a version at all, which
  // we handle via "no reply within 2s")
]);

function recentlyHealed() {
  try {
    const t = localStorage.getItem(HEAL_FLAG);
    if (!t) return false;
    return (Date.now() - new Date(t).getTime()) < HEAL_COOLDOWN_MS;
  } catch { return false; }
}

function markHealed() {
  try { localStorage.setItem(HEAL_FLAG, new Date().toISOString()); } catch {}
}

async function askControllerVersion(controller, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve({ ok: true, version: e.data?.version });
    };
    try {
      controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, reason: 'postMessage-threw', error: String(e) });
    }
  });
}

async function swFileReachable() {
  // Use the registration's scriptURL via the resolved registration,
  // falling back to a relative ./sw.js so we never accidentally probe
  // origin-root on a subpath deploy (which was the original bug).
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const url = reg?.active?.scriptURL || './sw.js';
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

async function fullUnregister() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
  } catch {}
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
  } catch {}
}

/**
 * Run once on app boot. Safe to call multiple times — guarded by the
 * 1-hour cooldown so it can't reload-loop.
 *
 * @param {object}  opts
 * @param {number} [opts.delayMs=3000]   wait before probing (let normal
 *                                       traffic finish first)
 * @param {boolean}[opts.force=false]    skip the cooldown (used by the
 *                                       manual reset button in Settings)
 * @returns {Promise<{healed:boolean, reason?:string}>}
 */
export async function runSelfHeal(opts = {}) {
  const { delayMs = 3000, force = false } = opts;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { healed: false, reason: 'no-sw-api' };
  }
  if (!force && recentlyHealed()) return { healed: false, reason: 'cooldown' };

  await new Promise((r) => setTimeout(r, delayMs));

  const controller = navigator.serviceWorker.controller;
  // No controller → either first visit (SW will install fresh) or user
  // already cleared. Either way nothing to heal.
  if (!force && !controller) return { healed: false, reason: 'no-controller' };

  // Probe 1: is sw.js even reachable at its scriptURL?
  const file = await swFileReachable();
  // Probe 2: does the controller respond with a current version?
  const ver = controller
    ? await askControllerVersion(controller)
    : { ok: false, reason: 'no-controller' };

  // eslint-disable-next-line no-console
  console.info('[sw-heal] probe', { file, ver });

  // Decide whether to heal.
  //   - sw.js HEAD returned 404 / network error → SW URL broken
  //   - controller never replied within 2s → likely the pre-version SW
  //     (or a frozen one) that we want to evict
  //   - version is on the known-bad list → evict
  const swFileBroken = !file.ok && file.status !== 0;
  // status 0 means the HEAD itself failed (CORS / offline) — don't punish
  // the user for being offline. Only act on a confirmed non-OK status.
  const noVersionReply = !ver.ok && ver.reason === 'timeout';
  const versionBad = ver.ok && KNOWN_BAD_VERSIONS.has(ver.version);

  const shouldHeal = force || swFileBroken || noVersionReply || versionBad;
  if (!shouldHeal) return { healed: false, reason: 'healthy' };

  // eslint-disable-next-line no-console
  console.warn('[sw-heal] healing — file:', file, 'ver:', ver);
  markHealed();
  await fullUnregister();
  // Hard reload to fetch a fresh sw.js + boot without the bad controller.
  // Use replace() so the heal doesn't pollute history.
  location.replace(location.href);
  return { healed: true };
}

/** Manual escape hatch used by the Settings "ล้าง cache" button. Bypasses
 *  the cooldown and DOES NOT touch the offline sale queue (IndexedDB). */
export async function manualReset() {
  return runSelfHeal({ delayMs: 0, force: true });
}
