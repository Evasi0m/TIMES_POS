// Copy plain text to the clipboard. Falls back to a hidden textarea +
// execCommand for older iOS Safari / non-secure contexts.

/** "1200.5" → "1,201" — thousands separator, no decimals. */
export function formatCopyPrice(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
