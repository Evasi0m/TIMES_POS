// One-click app update — compares the compile-time build id against
// dist/version.json (written at build time, never precached by the SW).
//
// Flow:
//   checkForUpdate()  → fetch version.json (cache-busted)
//   applyAppUpdate()  → reg.update() (best-effort), clearSwAndCaches(),
//                       hardReload() — always bypasses SW precache + CDN

/* global __APP_BUILD_ID__ */

import { runtimeFetch } from './runtime-fetch.js';
import { clearSwAndCaches, hardReload } from './sw-self-heal.js';

export const APP_BUILD_ID =
  typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';

const SNOOZE_KEY = 'pos.appUpdate.snoozedUntil';
const SNOOZE_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 60 * 1000;
const STALE_AFTER_RESET_KEY = 'pos.appUpdate.staleAfterReset';

/** @type {import('vite-plugin-pwa').RegisterSWOptions extends never ? ServiceWorkerRegistration : ServiceWorkerRegistration | null} */
let _registration = null;

/** @type {{ status: 'idle'|'available'|'applying'|'error', remoteBuildId: string|null, error: string|null }} */
let _state = { status: 'idle', remoteBuildId: null, error: null };

const listeners = new Set();

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
  if (!local || typeof local !== 'string') return true;
  return local !== remote;
}

function isSnoozed() {
  try {
    const until = localStorage.getItem(SNOOZE_KEY);
    if (!until) return false;
    return Date.now() < new Date(until).getTime();
  } catch {
    return false;
  }
}

async function fetchRemoteBuildId() {
  const res = await runtimeFetch('version.json');
  if (!res.ok) throw new Error(`version.json HTTP ${res.status}`);
  const data = await res.json();
  const id = data.buildId ?? data.version ?? null;
  if (!id) throw new Error('version.json missing buildId');
  return String(id);
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

/** Confirm when cart or offline queue has pending work. */
export async function canApplyUpdateSafely() {
  const ctx =
    typeof window !== 'undefined' && typeof window._getApplyUpdateContext === 'function'
      ? window._getApplyUpdateContext()
      : { cartCount: 0 };
  const cartCount = Number(ctx?.cartCount) || 0;
  const queueCount = await getQueueCount();

  if (cartCount <= 0 && queueCount <= 0) return true;

  const parts = [];
  if (cartCount > 0) parts.push(`ตะกร้ามี ${cartCount} รายการ`);
  if (queueCount > 0) parts.push(`มีบิลคิวออฟไลน์ ${queueCount} รายการ`);

  return window.confirm(
    `มีงานค้างอยู่ (${parts.join(', ')})\n\n` +
      'อัปเดตตอนนี้จะรีโหลดหน้า — ข้อมูลที่ยังไม่ได้บันทึกอาจหาย\n\n' +
      'ต้องการอัปเดตเลยหรือไม่?',
  );
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
    const remote = await fetchRemoteBuildId();
    if (isUpdateAvailable(APP_BUILD_ID, remote)) {
      setState({
        status: 'error',
        remoteBuildId: remote,
        error: 'เซิร์ฟเวอร์ยัง serve เวอร์ชันเก่า — รอ 1–2 นาทีแล้วกดอัปเดตอีกครั้ง',
      });
    }
  } catch { /* ignore */ }
}

export async function checkForUpdate() {
  if (isSnoozed()) {
    setState({ status: 'idle', remoteBuildId: null, error: null });
    return { available: false, snoozed: true };
  }

  try {
    const remote = await fetchRemoteBuildId();
    const available = isUpdateAvailable(APP_BUILD_ID, remote);
    setState({
      status: available ? 'available' : 'idle',
      remoteBuildId: remote,
      error: null,
    });
    return { available, remoteBuildId: remote };
  } catch (e) {
    const msg = e?.message || String(e);
    setState({ status: 'error', error: msg });
    return { available: false, error: msg };
  }
}

export function snoozeUpdate() {
  try {
    localStorage.setItem(
      SNOOZE_KEY,
      new Date(Date.now() + SNOOZE_MS).toISOString(),
    );
  } catch { /* ignore */ }
  setState({ status: 'idle', remoteBuildId: null, error: null });
}

/**
 * Hard reset + cache-busted reload so one click always fetches fresh shell.
 */
export async function applyAppUpdate() {
  if (!(await canApplyUpdateSafely())) {
    setState({ status: 'available', error: null });
    return { ok: false, reason: 'cancelled' };
  }

  setState({ status: 'applying', error: null });

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
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onVis);
  };
}
