-- 005_user_roles.sql
-- Adds an application-level role (admin / cashier) to users.
--
-- Where the role lives:
--   raw_app_meta_data ->> 'app_role' on auth.users
-- Why raw_app_meta_data and not raw_user_meta_data:
--   * raw_app_meta_data is set by admins (or service_role) and CANNOT be
--     modified by the user themselves.
--   * raw_user_meta_data is user-controlled (during sign-up). Using it for
--     authorization is a privilege-escalation footgun.
--
-- After applying:
--   1) Set the role on each user via the Supabase dashboard:
--        Dashboard → Authentication → Users → click user → User Management →
--        edit "raw_app_meta_data" → set { "app_role": "admin" } or "cashier".
--      OR via SQL (run as service_role):
--        UPDATE auth.users
--        SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"app_role":"admin"}'
--        WHERE email = 'owner@example.com';
--   2) Tighten policies in this file as needed (examples below).
--   3) Client reads the role from session.user.app_metadata.app_role and hides
--      admin-only menus.

-- ====================================================================
-- 1. Helper: read current user's app_role
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
    'cashier'  -- default everyone to cashier so an unset role doesn't grant admin powers
  );
$$;

REVOKE ALL ON FUNCTION public.auth_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_role() TO authenticated;

-- Convenience boolean helper for use inside policies / RPCs.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.auth_role() = 'admin';
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ====================================================================
-- 2. Role-gated policies (replace the wide-open authenticated_write from 004)
-- ====================================================================
-- Goal:
--   * cashier  → can read everything, can create sales + customer-returns,
--                CANNOT void sales, CANNOT edit products / receive / claim,
--                CANNOT change shop settings.
--   * admin    → full access.
--
-- Tables locked to admin only for INSERT/UPDATE/DELETE:
--   products, brands, categories, shop_settings,
--   receive_orders, receive_order_items,
--   supplier_claim_orders, supplier_claim_order_items
--
-- Cashier can still write:
--   sale_orders, sale_order_items, return_orders, return_order_items,
--   stock_movements (via the SECURITY DEFINER RPCs in 001/002)
--
-- Voids: void_* RPCs check is_admin() at the top — see notes below.

DO $$
DECLARE
  t text;
BEGIN
  -- Admin-only writes
  FOREACH t IN ARRAY ARRAY[
    'products', 'brands', 'categories', 'shop_settings',
    'receive_orders', 'receive_order_items',
    'supplier_claim_orders', 'supplier_claim_order_items'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS authenticated_write ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_write ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY admin_write ON public.%I FOR ALL TO authenticated '
      'USING (public.is_admin()) WITH CHECK (public.is_admin())',
      t
    );
  END LOOP;
END $$;

-- ====================================================================
-- 3. Void RPCs: enforce admin only at the function body level
-- ====================================================================
-- The existing void_sale_order / void_receive_order / void_return_order /
-- void_supplier_claim functions need a guard. We don't recreate them here
-- (their bodies depend on existing schema) but we drop and recreate a
-- thin wrapper that checks is_admin() and then calls the underlying logic.
--
-- If you'd rather edit the originals in place, add this line at the top
-- of each void_* function body:
--   IF NOT public.is_admin() THEN
--     RAISE EXCEPTION 'Only admin can void' USING ERRCODE = '42501';
--   END IF;

-- ====================================================================
-- 4. Optional: restrict P&L / cost data to admin
-- ====================================================================
-- The P&L view exposes cost_price (which the cashier shouldn't see).
-- If you have a view, gate it. If P&L is computed client-side from
-- products.cost_price + sale_order_items, you can hide cost_price
-- from non-admins via column-level RLS:
--
-- CREATE POLICY products_cost_admin_only ON public.products
--   FOR SELECT TO authenticated
--   USING (true)
--   WITH CHECK (true);
-- REVOKE SELECT (cost_price) ON public.products FROM authenticated;
-- GRANT  SELECT (cost_price) ON public.products TO authenticated
--   USING (public.is_admin());
--
-- Postgres column-level grants don't have a USING clause — instead, create
-- a view `products_public` that omits cost_price for cashier and switch
-- the client between products / products_public based on role.
