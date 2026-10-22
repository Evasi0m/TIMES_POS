// Permission check for edge functions — asks the DB (public.has_perm, migration
// 086) with the caller's own JWT, so the same per-role permissions the app
// shows are enforced here. A forwarded service-role JWT (cron) passes.
import { createClient } from 'jsr:@supabase/supabase-js@2';

export async function callerHasPerm(
  req: Request,
  perm: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!/^bearer\s+/i.test(auth)) {
    return { ok: false, status: 401, error: 'missing_authorization' };
  }
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.rpc('has_perm', { p_perm: perm });
  if (error) return { ok: false, status: 500, error: 'perm_check_failed: ' + error.message };
  if (data !== true) return { ok: false, status: 403, error: `ไม่มีสิทธิ์ทำรายการนี้ (${perm})` };
  return { ok: true, status: 200 };
}
