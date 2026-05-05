// Browser online/offline tracking + a tiny pub/sub for React components
// that don't want to import a hook (the legacy main.jsx still uses
// React.useEffect via the global `React` shim).
//
// React-friendly version: useOnlineStatus() in src/lib/online-status.jsx
// (added when components are split out in Phase 4).

let _online = typeof navigator !== 'undefined' ? navigator.onLine : true;
const subs = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('online',  () => { _online = true;  subs.forEach((cb) => cb(true)); });
  window.addEventListener('offline', () => { _online = false; subs.forEach((cb) => cb(false)); });
}

export const isOnline = () => _online;

export function onOnlineChange(cb) {
  subs.add(cb);
  // Fire immediately so the caller has the current value.
  try { cb(_online); } catch {}
  return () => subs.delete(cb);
}
