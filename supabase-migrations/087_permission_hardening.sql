-- 087_permission_hardening.sql
-- Follow-up to 086 (review findings + an audit of who can touch stock).
--
-- 1. Internal stock helpers were executable by every signed-in user, so
--    anyone could call adjust_stock() over the REST API and set any
--    product's stock. They are only meant to be called from inside other
--    functions (all SECURITY DEFINER) or by edge functions (service role).
--      adjust_stock, _manual_adjust_one_product, dedupe_tiktok_order_lines,
--      reconcile_pos_stock_from_tiktok
-- 2. confirm_web_sale_order (Web Shop confirm, dashboard-created) gets the
--    same guard as the other confirm RPCs.
-- 3. products: one write policy covered INSERT/UPDATE/DELETE, so
--    products.edit allowed REST deletes and stock edits that should need
--    products.delete / products.stock_adjust. Split per command, and a
--    trigger refuses any direct current_stock change from an API user —
--    stock moves only through the guarded RPCs (stock_movements audit).
--
-- Idempotent.

-- ====================================================================
-- 1. Internal stock helpers: service role only
-- ====================================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS ident
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('adjust_stock', '_manual_adjust_one_product',
                         'dedupe_tiktok_order_lines', 'reconcile_pos_stock_from_tiktok')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.ident);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.ident);
  END LOOP;
END $$;

-- ====================================================================
-- 2. Guard the Web Shop confirm
-- ====================================================================
INSERT INTO public.rpc_perm_guards (fn_name, perm)
VALUES ('confirm_web_sale_order', 'pos.sell')
ON CONFLICT (fn_name) DO UPDATE SET perm = EXCLUDED.perm;

SELECT * FROM public.apply_perm_guards() WHERE fn_name = 'confirm_web_sale_order';

-- ====================================================================
-- 3. products: per-command policies + no direct stock edits
-- ====================================================================
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'products' AND cmd <> 'SELECT' LOOP
    EXECUTE format('DROP POLICY %I ON public.products', pol.policyname);
  END LOOP;
END $$;

-- New products start at 0 stock (the receive flow adds stock through the RPC).
CREATE POLICY perm_insert ON public.products FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.has_perm('products.edit|receive.create'))
              AND COALESCE(current_stock, 0) = 0);

CREATE POLICY perm_update ON public.products FOR UPDATE TO authenticated
  USING ((SELECT public.has_perm('products.edit')))
  WITH CHECK ((SELECT public.has_perm('products.edit')));

-- Real deletes go through delete_product() (products.delete). The AI bulk
-- receive may roll back products it just created: never stocked, no history.
CREATE POLICY perm_delete ON public.products FOR DELETE TO authenticated
  USING (
    (SELECT public.has_perm('receive.create'))
    AND COALESCE(current_stock, 0) = 0
    AND NOT EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.product_id = products.id)
  );

CREATE OR REPLACE FUNCTION public.tg_products_stock_via_rpc_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.current_stock IS DISTINCT FROM OLD.current_stock
     AND auth.uid() IS NOT NULL
     AND COALESCE(auth.jwt() ->> 'role', '') = 'authenticated'
     AND COALESCE(current_setting('app.perm_guard_ok', true), '') <> 'on' THEN
    RAISE EXCEPTION 'แก้สต็อกตรงไม่ได้ — ใช้ปรับสต็อก / รับเข้า / ขาย เพื่อให้มีประวัติ'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_stock_via_rpc_only ON public.products;
CREATE TRIGGER trg_products_stock_via_rpc_only
  BEFORE UPDATE OF current_stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_products_stock_via_rpc_only();

NOTIFY pgrst, 'reload schema';
