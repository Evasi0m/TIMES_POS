// One-click app update — compares compile-time build id against dist/version.json.
// Mandatory gate: when available, AppUpdateGate blocks UI until user updates.

/* global __APP_BUILD_ID__, __RELEASE_PATCH_ID__ */

import { runtimeFetch } from './runtime-fetch.js';
import { clearSwAndCaches, hardReload } from './sw-self-heal.js';
import { fetchUpdateLog, getPatchesSince } from './update-log.js';

export const APP_BUILD_ID =
  typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';

export const RELEASE_PATCH_ID =
  typeof __RELEASE_PATCH_ID__ !== 'undefined' ? __RELEASE_PATCH_ID__ : '';

const DEFAULT_POLL_MS = 60 * 1000;
const STALE_AFTER_RESET_KEY = 'pos.appUpdate.staleAfterReset';
const PENDING_POLL_MS = 2000;

/** @type {ServiceWorkerRegistration | null} */
let _registration = null;

/** @type {{
 *   status: 'idle'|'available'|'applying'|'error',
 *   remoteBuildId: string|null,
 *   releasePatchId: string|null,
 *   patches: object[],
 *   pendingWork: { cart: number, queue: number },
 *   error: string|null,
 * }} */
let _state = {
  status: 'idle',
  remoteBuildId: null,
  releasePatchId: null,
  patches: [],
  pendingWork: { cart: 0, queue: 0 },
  error: null,
};

const listeners = new Set();
let _pendingPollTimer = null;

function emit() {
  for (const cb of listeners) {
    try { cb(_state); } catch { /* ignore */ }
  }
}

function setState(partial) {
  _state = { ..._state, ...partial };
  emit();
}

export function onUpdateStateChange(cb) {
  listeners.add(cb);
  try { cb(_state); } catch { /* ignore */ }
  return () => listeners.delete(cb);
}

export function setSwRegistration(registration) {
  _registration = registration ?? null;
}

export function isUpdateAvailable(local, remote) {
  if (!remote || typeof remote !== 'string') return false;
  if (!local || typeof local !== 'string' || local === 'dev') return true;
  return local !== remote;
}

async function fetchRemoteVersion() {
  const res = await runtimeFetch('version.json');
  if (!res.ok) throw new Error(`version.json HTTP ${res.status}`);
  const data = await res.json();
  const id = data.buildId ?? data.version ?? null;
  if (!id) throw new Error('version.json missing buildId');
  return {
    buildId: String(id),
    releasePatchId: data.releasePatchId ? String(data.releasePatchId) : null,
    builtAt: data.builtAt ?? null,
  };
}

async function getQueueCount() {
  if (typeof window === 'undefined' || typeof window._listQueuedSales !== 'function') {
    return 0;
  }
  try {
    const rows = await window._listQueuedSales();
    return Array.isArray(rows) ? rows.length : 0;
  } catch {
    return 0;
  }
}

function getCartCount() {
  const ctx =
    typeof window !== 'undefined' && typeof window._getApplyUpdateContext === 'function'
      ? window._getApplyUpdateContext()
      : { cartCount: 0 };
  return Number(ctx?.cartCount) || 0;
}

/** @returns {Promise<{ cart: number, queue: number, blocked: boolean }>} */
export async function getPendingWork() {
  const cart = getCartCount();
  const queue = await getQueueCount();
  return { cart, queue, blocked: cart > 0 || queue > 0 };
}

function startPendingWorkPoll() {
  if (_pendingPollTimer) return;
  const tick = async () => {
    if (_state.status !== 'available') return;
    const pending = await getPendingWork();
    if (
      pending.cart !== _state.pendingWork.cart
      || pending.queue !== _state.pendingWork.queue
    ) {
      setState({ pendingWork: { cart: pending.cart, queue: pending.queue } });
    }
  };
  tick();
  _pendingPollTimer = setInterval(tick, PENDING_POLL_MS);
}

function stopPendingWorkPoll() {
  if (_pendingPollTimer) {
    clearInterval(_pendingPollTimer);
    _pendingPollTimer = null;
  }
}

async function resolveReleasePatches(remotePatchId) {
  try {
    const log = await fetchUpdateLog();
    return getPatchesSince(log, RELEASE_PATCH_ID || null, remotePatchId);
  } catch {
    return [];
  }
}

function waitForInstalling(reg, timeoutMs = 3000) {
  if (!reg?.installing) return Promise.resolve();
  return new Promise((resolve) => {
    const worker = reg.installing;
    const timer = setTimeout(resolve, timeoutMs);
    worker.addEventListener('statechange', () => {
      if (worker.state !== 'installing') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}

async function triggerSwUpdateCheck() {
  try {
    let reg = _registration;
    if (!reg && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      reg = await navigator.serviceWorker.getRegistration();
    }
    if (!reg) return;
    await Promise.race([
      reg.update().then(() => waitForInstalling(reg)),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch { /* best-effort */ }
}

/** After hard reload, warn once if CDN still serves the old build. */
export async function checkStaleAfterReset() {
  try {
    if (sessionStorage.getItem(STALE_AFTER_RESET_KEY) !== '1') return;
    sessionStorage.removeItem(STALE_AFTER_RESET_KEY);
    const remote = await fetchRemoteVersion();
    if (isUpdateAvailable(APP_BUILD_ID, remote.buildId)) {
      const patches = await resolveReleasePatches(remote.releasePatchId);
      const pending = await getPendingWork();
      setState({
        status: 'error',
        remoteBuildId: remote.buildId,
        releasePatchId: remote.releasePatchId,
        patches,
        pendingWork: { cart: pending.cart, queue: pending.queue },
        error: 'เซิร์ฟเวอร์ยัง serve เวอร์ชันเก่า — รอ 1–2 นาทีแล้วกดอัปเดตอีกครั้ง',
      });
    }
  } catch { /* ignore */ }
}

export async function checkForUpdate() {
  try {
    const remote = await fetchRemoteVersion();
    const available = isUpdateAvailable(APP_BUILD_ID, remote.buildId);

    if (!available) {
      stopPendingWorkPoll();
      setState({
        status: 'idle',
        remoteBuildId: null,
        releasePatchId: null,
        patches: [],
        pendingWork: { cart: 0, queue: 0 },
        error: null,
      });
      return { available: false, remoteBuildId: remote.buildId };
    }

    const patches = await resolveReleasePatches(remote.releasePatchId);
    const pending = await getPendingWork();
    setState({
      status: 'available',
      remoteBuildId: remote.buildId,
      releasePatchId: remote.releasePatchId,
      patches,
      pendingWork: { cart: pending.cart, queue: pending.queue },
      error: null,
    });
    startPendingWorkPoll();
    return { available: true, remoteBuildId: remote.buildId, patches };
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn('[app-update] check failed:', msg);
    return { available: false, error: msg };
  }
}

/**
 * Hard reset + cache-busted reload so one click always fetches fresh shell.
 */
export async function applyAppUpdate() {
  const pending = await getPendingWork();
  if (pending.blocked) {
    setState({
      status: 'available',
      pendingWork: { cart: pending.cart, queue: pending.queue },
      error: null,
    });
    return { ok: false, reason: 'pending_work' };
  }

  setState({ status: 'applying', error: null });
  stopPendingWorkPoll();

  try {
    await triggerSwUpdateCheck();
    try { sessionStorage.setItem(STALE_AFTER_RESET_KEY, '1'); } catch { /* ignore */ }
    await clearSwAndCaches();
    hardReload();
    return { ok: true };
  } catch (e) {
    const msg = e?.message || String(e);
    setState({ status: 'error', error: msg });
    try {
      await clearSwAndCaches();
      hardReload();
      return { ok: true, fallback: true };
    } catch (resetErr) {
      return { ok: false, error: resetErr?.message || msg };
    }
  }
}

/** Poll version.json + subscribe to focus/visibility. Returns cleanup fn. */
export function startUpdatePolling(intervalMs = DEFAULT_POLL_MS, onPoll) {
  const poll = () => {
    checkForUpdate().catch(() => {});
    onPoll?.();
  };
  poll();
  const timer = setInterval(poll, intervalMs);
  const onFocus = () => { poll(); };
  window.addEventListener('focus', onFocus);
  const onVis = () => {
    if (document.visibilityState === 'visible') poll();
  };
  document.addEventListener('visibilitychange', onVis);
  return () => {
    clearInterval(timer);
    stopPendingWorkPoll();
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVis);
  };
}
