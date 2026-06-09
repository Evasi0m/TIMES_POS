// One-click app update — compares the compile-time build id against
// dist/version.json (written at build time, never precached by the SW).
//
// Flow:
//   checkForUpdate()  → fetch ./version.json (cache: no-store)
//   applyAppUpdate()  → reg.update(), SKIP_WAITING on waiting worker,
//                       wait for controllerchange (≤5s), reload
//   fallback          → manualReset() when no waiting worker (stuck SW)

/* global __APP_BUILD_ID__ */

export const APP_BUILD_ID =
  typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';

const SNOOZE_KEY = 'pos.appUpdate.snoozedUntil';
const SNOOZE_MS = 30 * 60 * 1000;
const DEFAULT_POLL_MS = 5 * 60 * 1000;

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
  const res = await fetch('./version.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`version.json HTTP ${res.status}`);
  const data = await res.json();
  const id = data.buildId ?? data.version ?? null;
  if (!id) throw new Error('version.json missing buildId');
  return String(id);
}

function waitForControllerChange(timeoutMs = 5000) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      resolve(false);
      return;
    }
    let done = false;
    const finish = (changed) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(changed);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => finish(true),
      { once: true },
    );
  });
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
    setState({ error: msg });
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
 * @param {{ manualReset?: () => Promise<unknown> }} [opts]
 */
export async function applyAppUpdate(opts = {}) {
  const { manualReset } = opts;

  if (!(await canApplyUpdateSafely())) {
    return { ok: false, reason: 'cancelled' };
  }

  setState({ status: 'applying', error: null });

  try {
    let reg = _registration;
    if (!reg && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      reg = await navigator.serviceWorker.getRegistration();
    }

    if (reg) {
      await reg.update();
      const waiting = reg.waiting;
      if (waiting) {
        waiting.postMessage({ type: 'SKIP_WAITING' });
        await waitForControllerChange(5000);
        location.reload();
        return { ok: true };
      }
    }

    if (typeof manualReset === 'function') {
      await manualReset();
      return { ok: true };
    }

    location.reload();
    return { ok: true };
  } catch (e) {
    const msg = e?.message || String(e);
    setState({ status: 'error', error: msg });

    if (typeof manualReset === 'function') {
      try {
        await manualReset();
        return { ok: true, fallback: true };
      } catch (resetErr) {
        return { ok: false, error: resetErr?.message || msg };
      }
    }

    return { ok: false, error: msg };
  }
}

/** Poll version.json + subscribe to window focus. Returns cleanup fn. */
export function startUpdatePolling(intervalMs = DEFAULT_POLL_MS) {
  checkForUpdate().catch(() => {});
  const timer = setInterval(() => {
    checkForUpdate().catch(() => {});
  }, intervalMs);
  const onFocus = () => { checkForUpdate().catch(() => {}); };
  window.addEventListener('focus', onFocus);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', onFocus);
  };
}
