-- 003_rls_audit.sql
-- Read-only diagnostic. Run this in the SQL editor BEFORE applying 004.
-- It surfaces tables that have RLS disabled or no policies — those are the
-- ones an authenticated/anon JWT can currently read or write freely.
--
-- Look for:
--   * rls_enabled = false   → an attacker with the anon key (which is in index.html)
--                              can read or write the table
--   * policy_count = 0       → RLS is on but nothing allows access; the table is
--                              effectively read-only locked even for legit users.
--                              You probably want at least one policy from 004.
--   * write_policy_count = 0 → only SELECT is allowed; insert/update/delete blocked.

-- 1) Per-table RLS status + policy counts
SELECT
  c.relname                                         AS table_name,
  c.relrowsecurity                                  AS rls_enabled,
  c.relforcerowsecurity                             AS rls_forced,
  COALESCE(p.policy_count, 0)                       AS policy_count,
  COALESCE(p.select_policy_count, 0)                AS select_policy_count,
  COALESCE(p.write_policy_count, 0)                 AS write_policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN (
  SELECT
    schemaname, tablename,
    COUNT(*)                                                          AS policy_count,
    COUNT(*) FILTER (WHERE cmd IN ('SELECT', 'ALL'))                  AS select_policy_count,
    COUNT(*) FILTER (WHERE cmd IN ('INSERT','UPDATE','DELETE','ALL')) AS write_policy_count
  FROM pg_policies
  GROUP BY schemaname, tablename
) p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY rls_enabled ASC, policy_count ASC, c.relname;

-- 2) Existing policies (for review)
-- Uncomment to inspect:
-- SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename, policyname;

-- 3) RPC functions exposed to anon / authenticated
-- Uncomment to inspect what an anon caller could invoke:
-- SELECT n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS args,
--        r.rolname AS granted_to
-- FROM pg_proc p
-- JOIN pg_namespace n  ON n.oid = p.pronamespace
-- JOIN pg_proc_acl_view a ON a.proid = p.oid -- pseudo, see information_schema.role_routine_grants
-- WHERE n.nspname = 'public';
