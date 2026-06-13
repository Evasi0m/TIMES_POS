// Re-authenticate current user before sensitive export actions.

import { sb } from './supabase-client.js';
import { mapError } from './error-map.js';

/** sessionStorage key — reopen export modal after ProductsView remount. */
export const PRODUCTS_EXPORT_PENDING_KEY = 'products_export_pending';

/**
 * Verify password for the currently logged-in user via edge function.
 * Does NOT refresh the browser session (avoids MFA gate / modal state loss).
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export async function verifyCurrentUserPassword(password, email) {
  const trimmedEmail = String(email || '').trim().toLowerCase();
  const pwd = String(password || '');
  if (!trimmedEmail || !pwd) {
    return { ok: false, message: 'กรุณากรอกรหัสผ่าน' };
  }

  const { data, error } = await sb.functions.invoke('verify-export-password', {
    body: { password: pwd },
  });

  if (error) {
    return { ok: false, message: mapError(error, { context: 'login' }) };
  }
  if (data?.ok) return { ok: true };

  const errLike = { message: data?.message || data?.error || 'invalid_password' };
  return { ok: false, message: mapError(errLike, { context: 'login' }) };
}

/** Display name for export metadata — metadata.full_name or email local-part. */
export function exporterDisplayName(user) {
  const metaName = user?.user_metadata?.full_name;
  if (metaName && String(metaName).trim()) return String(metaName).trim();
  const email = user?.email || '';
  const local = email.split('@')[0] || email;
  return local || 'unknown';
}
