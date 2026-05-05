// Offline write queue backed by IndexedDB. Used by POSView when the
// network is down: instead of failing the sale, we stash the payload and
// drain the queue when the browser fires `online`.
//
// API:
//   queueSale(payload)           → add a sale to the queue (returns local id)
//   listQueuedSales()            → all pending sales
//   drainQueue(sb, onProgress)   → try to send each pending sale via the
//                                  given Supabase client, removing on success
//   onQueueChange(cb)            → subscribe to queue length changes
//
// The queue stores raw RPC payloads (header + items), not opaque blobs, so
// they remain inspectable / fixable by hand if anything ever breaks.

const DB_NAME = 'times-pos-offline';
const DB_VERSION = 1;
const STORE = 'sales';

let _dbPromise = null;
function db() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

const listeners = new Set();
function notify(len) { listeners.forEach((cb) => { try { cb(len); } catch {} }); }

export function onQueueChange(cb) {
  listeners.add(cb);
  // Fire once so the caller has a baseline.
  count().then(notify).catch(() => {});
  return () => listeners.delete(cb);
}

// Drain status — visible to the OfflineBanner so a stuck queue isn't silent.
//   { state: 'idle'|'draining'|'error',
//     lastError: string|null,   // Thai-mapped if mapError() was used by caller
//     lastDrainAt: ISO|null }
let _drainState = { state: 'idle', lastError: null, lastDrainAt: null };
const stateListeners = new Set();
function notifyState() {
  stateListeners.forEach((cb) => { try { cb(_drainState); } catch {} });
}
export function getDrainState() { return _drainState; }
export function onDrainStateChange(cb) {
  stateListeners.add(cb);
  try { cb(_drainState); } catch {}
  return () => stateListeners.delete(cb);
}

async function count() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueSale(payload) {
  const d = await db();
  const id = await new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add({
      payload,
      queuedAt: new Date().toISOString(),
    });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  notify(await count());
  return id;
}

export async function listQueuedSales() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function remove(id) {
  const d = await db();
  await new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });
  notify(await count());
}

/**
 * Try to send every queued sale via the given Supabase client. Stops at
 * the first non-network error so we don't infinitely retry a malformed
 * payload (the user can inspect it via listQueuedSales).
 *
 * Updates the drain-state pub/sub so the OfflineBanner can show progress
 * and surface errors instead of looping "กำลัง sync…" forever.
 *
 * @param {object} sb         Supabase client
 * @param {Function} mapErr   optional err → Thai-friendly string; default
 *                            uses err.message verbatim
 * @returns {{sent:number, failed:number, lastError:string|null}}
 */
export async function drainQueue(sb, mapErr) {
  _drainState = { state: 'draining', lastError: null, lastDrainAt: _drainState.lastDrainAt };
  notifyState();

  const fmt = typeof mapErr === 'function' ? mapErr : (e) => String(e?.message || e);
  const items = await listQueuedSales();
  let sent = 0;
  let failed = 0;
  let lastError = null;

  for (const item of items) {
    try {
      const { error } = await sb.rpc('create_sale_order_with_items', item.payload);
      if (error) throw error;
      await remove(item.id);
      sent++;
    } catch (e) {
      failed++;
      lastError = fmt(e);
      // Stop draining on the first hard failure so a malformed payload
      // doesn't keep retrying forever. Network errors don't count — those
      // mean "still offline, try again later".
      const isNetwork = /Failed to fetch|NetworkError|TypeError/i.test(String(e?.message || e));
      if (!isNetwork) break;
    }
  }

  _drainState = {
    state: failed > 0 ? 'error' : 'idle',
    lastError,
    lastDrainAt: new Date().toISOString(),
  };
  notifyState();
  return { sent, failed, lastError };
}

/** Manually drop a single queued sale by id (escape hatch for malformed payloads). */
export async function deleteQueuedSale(id) {
  await remove(id);
  _drainState = { ..._drainState, lastError: null, state: 'idle' };
  notifyState();
}
