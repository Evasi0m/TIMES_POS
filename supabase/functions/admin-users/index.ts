// admin-users — User-management edge function for super_admin only.
//
// Why an edge function: creating/deleting auth users and editing
// app_metadata require the service_role key, which CANNOT live in the
// browser. This function runs in Deno on Supabase's edge with the key
// in env, and verifies the *caller* is a super_admin via the JWT they
// forward in the Authorization header.
//
// Actions (all POST JSON):
//   { "action":"list" }                                            → list users + roles + MFA state
//   { "action":"create", "email":..., "password":..., "role":...,
//     "mfa_required": true|false }                                  → new user
//   { "action":"update_role", "user_id":..., "role":... }          → change role
//   { "action":"delete", "user_id":... }                           → delete user
//   { "action":"set_mfa_required", "user_id":..., "required": bool} → toggle "force MFA" flag
//   { "action":"reset_mfa", "user_id":... }                        → unenroll all TOTP factors (user re-enrolls on next login)
//
// Allowed roles: 'super_admin', 'admin', 'visitor'.
//
// verify_jwt = true at deploy time. We additionally check that the
// caller's app_role === 'super_admin' before processing any action.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ROLES = new Set(['super_admin', 'admin', 'visitor']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// Service-role client — full DB + auth admin powers. NEVER expose any
// of its responses unfiltered to clients; we sanitize what we return.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Pull `app_role` out of app_metadata, defaulting to 'visitor' when absent
// so the UI never has to guard against undefined.
const roleOf = (u: { app_metadata?: { app_role?: string } } | null | undefined) =>
  (u?.app_metadata?.app_role as string | undefined) ?? 'visitor';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')   return json({ ok: false, error: 'method_not_allowed' }, 405);

  // 1) Verify caller is super_admin. We trust the JWT verification done
  //    by the Supabase platform (verify_jwt=true) but still need to read
  //    the role out of it. Use a request-scoped client that forwards the
  //    user's JWT — its is_super_admin() RPC reflects that user's claims.
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return json({ ok: false, error: 'missing_authorization' }, 401);
  }
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: rpc, error: rpcErr } = await userClient.rpc('is_super_admin');
  if (rpcErr) return json({ ok: false, error: 'auth_check_failed: ' + rpcErr.message }, 500);
  if (rpc !== true) return json({ ok: false, error: 'forbidden' }, 403);

  // 2) Parse body.
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }
  const action = String(body.action || '');

  try {
    switch (action) {
      case 'list': {
        // listUsers paginates 50 at a time — fetch up to 200 (anyone running
        // a small POS shop has well under that). Bumping later is trivial.
        // We also surface `mfa_required` (operator-set policy) and
        // `has_totp` (user has actually enrolled at least one verified TOTP
        // factor) so the UI can show accurate badges.
        const out: Array<{
          id: string; email: string | null; role: string;
          created_at: string; last_sign_in_at: string | null;
          mfa_required: boolean; has_totp: boolean;
        }> = [];
        let page = 1;
        for (;;) {
          const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
          if (error) return json({ ok: false, error: 'list_failed: ' + error.message }, 500);
          for (const u of data.users) {
            // `factors` is included on the admin user object — filter to
            // verified TOTP only since unverified enroll attempts shouldn't
            // count as "has MFA set up".
            // deno-lint-ignore no-explicit-any
            const factors = (u as any).factors as Array<{ factor_type?: string; status?: string }> | undefined;
            const hasTotp = Array.isArray(factors)
              && factors.some(f => f.factor_type === 'totp' && f.status === 'verified');
            const meta = u.app_metadata ?? {};
            out.push({
              id: u.id,
              email: u.email ?? null,
              role: roleOf(u),
              created_at: u.created_at,
              last_sign_in_at: u.last_sign_in_at ?? null,
              mfa_required: meta.mfa_required === true,
              has_totp: hasTotp,
            });
          }
          if (data.users.length < 50 || page >= 4) break;
          page += 1;
        }
        return json({ ok: true, users: out });
      }

      case 'create': {
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const role = String(body.role || 'visitor');
        if (!email || !password) return json({ ok: false, error: 'email_password_required' }, 400);
        if (password.length < 6) return json({ ok: false, error: 'password_too_short' }, 400);
        if (!ALLOWED_ROLES.has(role)) return json({ ok: false, error: 'invalid_role' }, 400);

        // Optional: super_admin can flag the user as "must enroll TOTP on
        // first login". Defaults to false; the UI defaults to true for
        // visitor + admin to encourage MFA usage.
        const mfaRequired = body.mfa_required === true;
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,            // skip the confirm email — operator vouched for them
          app_metadata: { app_role: role, mfa_required: mfaRequired },
        });
        if (error) return json({ ok: false, error: 'create_failed: ' + error.message }, 400);
        return json({
          ok: true,
          user: {
            id: data.user!.id,
            email: data.user!.email,
            role,
            created_at: data.user!.created_at,
            last_sign_in_at: null,
          },
        });
      }

      case 'update_role': {
        const userId = String(body.user_id || '');
        const role   = String(body.role || '');
        if (!userId)                  return json({ ok: false, error: 'user_id_required' }, 400);
        if (!ALLOWED_ROLES.has(role)) return json({ ok: false, error: 'invalid_role' }, 400);

        // Fetch current metadata so we MERGE rather than overwrite — keeps
        // any unrelated app_metadata fields (telegram bindings, etc.) intact.
        const { data: existing, error: getErr } = await admin.auth.admin.getUserById(userId);
        if (getErr || !existing.user) return json({ ok: false, error: 'user_not_found' }, 404);

        const merged = { ...(existing.user.app_metadata ?? {}), app_role: role };
        const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: merged });
        if (error) return json({ ok: false, error: 'update_failed: ' + error.message }, 400);
        return json({ ok: true });
      }

      case 'delete': {
        const userId = String(body.user_id || '');
        if (!userId) return json({ ok: false, error: 'user_id_required' }, 400);

        // Block super_admin from deleting themselves — that's a footgun
        // (could lock the org out if there's only one super_admin).
        const { data: { user: caller } } = await userClient.auth.getUser();
        if (caller && caller.id === userId) {
          return json({ ok: false, error: 'cannot_delete_self' }, 400);
        }

        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) return json({ ok: false, error: 'delete_failed: ' + error.message }, 400);
        return json({ ok: true });
      }

      case 'set_mfa_required': {
        const userId = String(body.user_id || '');
        const required = body.required === true;
        if (!userId) return json({ ok: false, error: 'user_id_required' }, 400);
        const { data: existing, error: getErr } = await admin.auth.admin.getUserById(userId);
        if (getErr || !existing.user) return json({ ok: false, error: 'user_not_found' }, 404);
        const merged = { ...(existing.user.app_metadata ?? {}), mfa_required: required };
        const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: merged });
        if (error) return json({ ok: false, error: 'update_failed: ' + error.message }, 400);
        return json({ ok: true });
      }

      case 'reset_mfa': {
        // Unenroll every MFA factor on the user — they'll be forced to
        // re-enroll on next login (only when mfa_required is true, or if
        // they choose to re-enroll voluntarily). Useful when a user
        // changes phones / loses their authenticator app.
        const userId = String(body.user_id || '');
        if (!userId) return json({ ok: false, error: 'user_id_required' }, 400);

        // listFactors returns ALL factors regardless of status; we delete
        // them one-by-one (no bulk endpoint exists). Errors on individual
        // factors are surfaced but don't halt the rest.
        // deno-lint-ignore no-explicit-any
        const { data: factors, error: listErr } = await (admin.auth.admin as any).mfa.listFactors({ userId });
        if (listErr) return json({ ok: false, error: 'list_factors_failed: ' + listErr.message }, 500);
        const errs: string[] = [];
        for (const f of (factors?.factors ?? [])) {
          // deno-lint-ignore no-explicit-any
          const { error: delErr } = await (admin.auth.admin as any).mfa.deleteFactor({ userId, id: f.id });
          if (delErr) errs.push(`${f.id}: ${delErr.message}`);
        }
        if (errs.length) return json({ ok: false, error: 'delete_factor_failed: ' + errs.join('; ') }, 500);
        return json({ ok: true, removed: factors?.factors?.length ?? 0 });
      }

      default:
        return json({ ok: false, error: 'unknown_action' }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: 'internal: ' + ((e as Error).message ?? String(e)) }, 500);
  }
});
