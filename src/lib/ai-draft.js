// Persist an in-progress "รับเข้า ×10" review batch to IndexedDB so an
// accidental tab close / refresh / navigation doesn't throw away minutes
// of resolving rows. We store the parsed+edited bills (including the
// base64 image so the thumbnail/zoom survive) but NOT the product catalog
// (re-fetched on restore) or the ObjectURL previewUrls (regenerated from
// base64). Everything is best-effort: a failure here must never break the
// scan flow, so every call is wrapped and swallows errors.

const DB_NAME = 'times_pos_ai';
const STORE = 'draft';
const KEY = 'bulk_receive';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no-idb')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save (overwrite) the current draft. `data` is structured-clonable. */
export async function saveDraft(data) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...data, savedAt: Date.now() }, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close?.();
    return { ok: true, error: null };
  } catch (e) {
    console.warn('[ai-draft] save failed:', e);
    return { ok: false, error: e };
  }
}

/** Load the saved draft, or null if none / on any error. */
export async function loadDraft() {
  try {
    const db = await openDb();
    const out = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
    db.close?.();
    return out;
  } catch (e) {
    console.warn('[ai-draft] load failed:', e);
    return null;
  }
}

/** Remove the saved draft. */
export async function clearDraft() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close?.();
  } catch (e) {
    console.warn('[ai-draft] clear failed:', e);
  }
}

/** Decode a base64 data URL / raw base64 string into a Blob for preview URLs. */
export function base64ToBlob(base64, mime = 'image/jpeg') {
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
