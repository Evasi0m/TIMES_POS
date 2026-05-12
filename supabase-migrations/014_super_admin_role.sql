-- 014_super_admin_role.sql
-- Introduces a 3-tier role system:
--   super_admin  — full access + can manage users (create / delete / change role)
--   admin        — full app access EXCEPT certain settings tabs and the
--                  "anomalies" dashboard view (gated client-side; nothing
--                  server-side stops them from reading those tables — these
--                  are UX hides, not security boundaries)
--   visitor      — read-only; previously called "cashier". The visitor can
--                  see the products list but cannot open the editor, cannot
--                  create sales/returns/receives. Server-side RLS still
--                  permits SELECT (everyone in the app needs to read the
--                  catalog), and the existing admin_write policies from 005
--                  continue to block all writes.
--
-- Migration plan:
--   1. Rename existing 'cashier' rows → 'visitor' (preserves all current
--      cashier accounts as visitors with no privilege change).
--   2. Add public.is_super_admin() helper.
--   3. Keep public.is_admin() returning true for BOTH 'admin' AND
--      'super_admin' so the existing admin_write policies in 005 continue
--      to work without modification — super_admin is a strict superset
--      of admin's DB permissions.
--   4. Update the default in auth_role() from 'cashier' → 'visitor' so
--      newly-created users without an explicit role default to the most
--      restricted role.
--
-- Idempotent: safe to re-run.

-- ====================================================================
-- 1. Migrate existing user metadata: cashier → visitor
-- ====================================================================
-- super_admin role is set manually by the operator after this migration
-- (see README). admin roles stay as 'admin'. Anyone with no role gets
-- the new default 'visitor'.
UPDATE auth.users
SET raw_app_meta_data =
  jsonb_set(
    COALESCE(raw_app_meta_data, '{}'::jsonb),
    '{app_role}',
    '"visitor"'::jsonb,
    true
  )
WHERE COALESCE(raw_app_meta_data->>'app_role', 'cashier') = 'cashier';

-- ====================================================================
-- 2. Replace auth_role() — default flips from 'cashier' to 'visitor'
-- ====================================================================
CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'app_role'),
    (SELECT raw_app_meta_data ->> 'app_role'
       FROM auth.users WHERE id = auth.uid()),
    'visitor'
  );
$$;

REVOKE ALL ON FUNCTION public.auth_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_role() TO authenticated;

-- ====================================================================
-- 3. is_admin() — now matches BOTH 'admin' and 'super_admin'.
--    Existing RLS policies from 005 keep working unchanged because
--    super_admin still satisfies is_admin().
-- ====================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.auth_role() IN ('admin', 'super_admin');
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ====================================================================
-- 4. is_super_admin() — strict match for the new top role.
--    Used by the admin-users edge function to gate user-management RPC
--    access. Never use this in tables — admin_write should keep using
--    is_admin() so admins continue to get full DB write privileges.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.auth_role() = 'super_admin';
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

-- ====================================================================
-- 5. Post-migration steps (manual, do once):
-- ====================================================================
-- a) Promote the owner account to super_admin:
--      UPDATE auth.users
--      SET raw_app_meta_data =
--        COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"app_role":"super_admin"}'
--      WHERE email = 'YOUR_OWNER_EMAIL@example.com';
--    Then sign out and sign back in so the JWT carries the new role.
--
-- b) The admin-users edge function (deployed separately) handles all
--    further user creation. It verifies the caller is super_admin via
--    public.is_super_admin() before accepting any mutation.
