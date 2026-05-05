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
 * Returns { sent, failed }.
 */
export async function drainQueue(sb, onProgress = () => {}) {
  const items = await listQueuedSales();
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const { error } = await sb.rpc('create_sale_order_with_items', item.payload);
      if (error) throw error;
      await remove(item.id);
      sent++;
      onProgress({ sent, failed, remaining: items.length - sent - failed });
    } catch (e) {
      failed++;
      // Stop draining on the first hard failure — keeps logs readable
      // and lets the user fix the underlying issue (e.g. RLS, schema).
      const isNetwork = /Failed to fetch|NetworkError|TypeError/i.test(String(e?.message || e));
      if (!isNetwork) break;
    }
  }
  return { sent, failed };
}
