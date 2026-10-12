// Open the shared "จับคู่ TikTok" editor from any page.
//
// The editor host (TikTokMappingEditorHost) is mounted once in the App shell,
// only for admin / super_admin. Badges call openTikTokMappingEditor(); when no
// host is registered (visitor) the badge stays a plain, non-clickable mark.

let opener = null;
const subs = new Set();

function emit() {
  for (const fn of subs) {
    try { fn(); } catch { /* listener errors never break the bus */ }
  }
}

/** Host registers its open function; returns unregister. */
export function registerTikTokMappingEditor(fn) {
  opener = typeof fn === 'function' ? fn : null;
  emit();
  return () => {
    if (opener === fn) {
      opener = null;
      emit();
    }
  };
}

export function canOpenTikTokMappingEditor() {
  return !!opener;
}

export function subscribeTikTokMappingEditor(listener) {
  subs.add(listener);
  return () => { subs.delete(listener); };
}

/** Returns true when the editor opened. */
export function openTikTokMappingEditor(productId) {
  if (!opener || productId == null) return false;
  opener(productId);
  return true;
}
