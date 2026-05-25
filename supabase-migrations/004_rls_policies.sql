-- 004_rls_policies.sql
-- Enables RLS and applies "authenticated users only" baseline policies
-- on every table the TIMES POS app reads/writes.
--
-- This is the MINIMUM viable security posture: only a logged-in user can
-- touch any row. It does NOT segregate data by shop / store / cashier — it
-- assumes a single-tenant deployment (one shop = one database).
--
-- For role-based restrictions (e.g. cashier shouldn't see P&L), see 005 and
-- the role-aware policies below.
--
-- Idempotent: each policy is dropped + recreated.

-- ====================================================================
-- 1. ENABLE RLS on every public-schema table the client touches
-- ====================================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products', 'brands', 'categories',
    'sale_orders', 'sale_order_items',
    'receive_orders', 'receive_order_items',
    'supplier_claim_orders', 'supplier_claim_order_items',
    'return_orders', 'return_order_items',
    'stock_movements', 'shop_settings'
  ] LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ====================================================================
-- 2. Baseline policy: authenticated can read/write
-- ====================================================================
-- Helper macro: attaches a "authenticated full access" policy to a table.
-- Tighten per role in 005 (e.g. cashier cannot DELETE products, etc.).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products', 'brands', 'categories',
    'sale_orders', 'sale_order_items',
    'receive_orders', 'receive_order_items',
    'supplier_claim_orders', 'supplier_claim_order_items',
    'return_orders', 'return_order_items',
    'stock_movements', 'shop_settings'
  ] LOOP
    -- Drop any prior baseline policy with our name to keep this script idempotent.
    EXECUTE format('DROP POLICY IF EXISTS authenticated_read  ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_write ON public.%I', t);

    -- SELECT for any logged-in user
    EXECUTE format(
      'CREATE POLICY authenticated_read ON public.%I FOR SELECT TO authenticated USING (true)',
      t
    );
    -- INSERT/UPDATE/DELETE for any logged-in user (baseline; see 005 for role gates)
    EXECUTE format(
      'CREATE POLICY authenticated_write ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- ====================================================================
-- 3. Make sure anon role has NO direct table access
-- ====================================================================
-- The anon key in index.html is intended only to bootstrap login
-- (sb.auth.signInWithPassword). After that, the user's JWT carries the
-- 'authenticated' role and policies above kick in.
--
-- Without this revoke, an anon JWT could SELECT * FROM products before logging in.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Note: Supabase grants USAGE on the public schema to anon by default;
-- leave that alone, we only revoke object-level access.

-- ====================================================================
-- 4. Re-grant to authenticated (in case Supabase defaults were changed)
-- ====================================================================
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- For tables created in the future, set defaults so we don't have to remember:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
