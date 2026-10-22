-- 086_role_permissions.sql
-- Editable per-role permissions + a new 'staff' role.
--
--   super_admin → everything, always (not stored, not editable).
--   admin / staff / visitor → a jsonb map of permission keys in
--     public.role_permissions, edited by the super admin from the app
--     (การตั้งค่า user → สิทธิ์ตามบทบาท). Keys mirror src/lib/permissions.js.
--
-- Enforcement (so hiding a button in the app is never the only guard):
--   1. public.has_perm('a|b') — true when the caller's role has any listed key.
--      service_role (edge functions) and internal sessions (pg_cron, SQL
--      editor) always pass.
--   2. RPC guards — every RPC the app calls is wrapped: the original body is
--      renamed to <name>__impl (no longer callable by users) and <name>
--      becomes a thin wrapper that runs require_perm() first. Bodies are not
--      copied, so no column can be dropped by accident (cf. 029).
--      Legacy is_admin()/is_super_admin() checks inside those bodies are
--      satisfied while the wrapper runs (transaction-local flag), so a key
--      granted to staff/visitor really works.
--   3. RLS — table policies rewritten around has_perm(). This also closes
--      the old gap where any logged-in user could UPDATE sale_orders /
--      return_orders / stock_movements directly through the REST API.
--
-- ⚠️ A later migration that CREATE OR REPLACEs a guarded function replaces
--    the wrapper and drops its guard. End such a migration with:
--        SELECT public.apply_perm_guards();
--    It re-wraps the new body (and discards the stale __impl).
--    Check with: SELECT * FROM public.perm_guard_status;
--
-- Idempotent.

-- ====================================================================
-- 1. role_permissions
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role             text PRIMARY KEY CHECK (role IN ('admin', 'staff', 'visitor')),
  permissions      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  updated_by_email text
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_permissions_read ON public.role_permissions;
CREATE POLICY role_permissions_read ON public.role_permissions
  FOR SELECT TO authenticated USING (true);
-- No write policy: only set_role_permissions() (super admin) writes.
REVOKE ALL ON public.role_permissions FROM anon;
GRANT SELECT ON public.role_permissions TO authenticated;

-- Defaults = what each role could do before this migration
-- (mirrors DEFAULT_ROLE_PERMISSIONS in src/lib/permissions.js).
INSERT INTO public.role_permissions (role, permissions) VALUES
('admin', '{
  "view.pos": true, "view.products": true, "view.customer_price": true,
  "view.sales": true, "view.receive": true, "view.return": true,
  "view.dashboard": true, "view.ecommerce": true,
  "pos.sell": true, "pos.tiktok_confirm": true, "pos.tiktok_resolve": true,
  "sales.edit": true, "sales.void": true, "sales.tax_invoice": true, "sales.net_received": true,
  "products.view_cost": true, "products.edit": true, "products.delete": false,
  "products.stock_adjust": false, "products.export": true, "products.tiktok_mapping": true,
  "receive.create": true, "receive.void": true, "receive.edit": false, "receive.claim_edit": true,
  "receive.docs": true,
  "return.create": true, "return.edit": true, "return.void": true, "return.credit_note": true,
  "dashboard.expenses": true, "dashboard.anomalies": false,
  "ecommerce.sync": true, "ecommerce.ship": true, "ecommerce.invoices": true,
  "ecommerce.returns": true, "ecommerce.matching": false, "ecommerce.stock_reconcile": false,
  "settings.shop": true, "settings.paylater": false, "settings.customer_price": false,
  "settings.ai": false, "settings.telegram": false, "settings.tiktok": true,
  "audit.view": false
}'::jsonb),
('staff', '{
  "view.pos": true, "view.products": true, "view.customer_price": true,
  "view.sales": true, "view.return": true, "view.ecommerce": true
}'::jsonb),
('visitor', '{
  "view.products": true, "view.customer_price": true
}'::jsonb)
ON CONFLICT (role) DO NOTHING;

-- ====================================================================
-- 2. Role helpers
-- ====================================================================
-- Legacy role checks pass while a perm-guarded RPC is running (flag set by
-- the wrapper, transaction-local, restored on exit). Outside a guarded RPC
-- they behave exactly as before. Clients cannot set this flag: set_config
-- is not exposed through the API.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.auth_role() IN ('admin', 'super_admin')
      OR COALESCE(current_setting('app.perm_guard_ok', true), '') = 'on';
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.auth_role() = 'super_admin'
      OR COALESCE(current_setting('app.perm_guard_ok', true), '') = 'on';
$$;

-- Strict owner check that ignores the guard flag (user + permission admin).
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT auth.uid() IS NOT NULL AND public.auth_role() = 'super_admin';
$$;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

CREATE OR REPLACE FUNCTION public.has_perm(p_perm text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text;
  v_key  text;
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') = 'service_role' THEN
    RETURN true;
  END IF;
  -- No JWT and not an API session → pg_cron / SQL editor / migrations.
  IF auth.jwt() IS NULL AND session_user NOT IN ('authenticator', 'anon', 'authenticated') THEN
    RETURN true;
  END IF;
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  v_role := public.auth_role();
  IF v_role = 'super_admin' THEN RETURN true; END IF;
  IF v_role = 'cashier' THEN v_role := 'visitor'; END IF;

  FOREACH v_key IN ARRAY string_to_array(COALESCE(p_perm, ''), '|') LOOP
    v_key := trim(v_key);
    CONTINUE WHEN v_key = '';
    IF EXISTS (
      SELECT 1 FROM public.role_permissions rp
       WHERE rp.role = v_role
         AND jsonb_typeof(rp.permissions -> v_key) = 'boolean'
         AND (rp.permissions ->> v_key)::boolean
    ) THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.has_perm(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_perm(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.require_perm(p_perm text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_perm(p_perm) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ทำรายการนี้ (%)', p_perm
      USING ERRCODE = '42501', HINT = 'ขอให้ Super Admin เปิดสิทธิ์ในหน้า สิทธิ์ตามบทบาท';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.require_perm(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_perm(text) TO authenticated, service_role;

-- The caller's role + permission map, for the app.
CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text;
  v_perms jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;
  v_role := public.auth_role();
  IF v_role = 'cashier' THEN v_role := 'visitor'; END IF;
  IF v_role = 'super_admin' THEN
    RETURN jsonb_build_object('role', v_role, 'all', true, 'permissions', '{}'::jsonb);
  END IF;
  SELECT permissions INTO v_perms FROM public.role_permissions WHERE role = v_role;
  RETURN jsonb_build_object('role', v_role, 'all', false,
                            'permissions', COALESCE(v_perms, '{}'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_permissions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_permissions() TO authenticated;

-- Super admin edits one role's map. Only boolean values are kept.
CREATE OR REPLACE FUNCTION public.set_role_permissions(p_role text, p_permissions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean jsonb;
BEGIN
  IF NOT public.is_owner() THEN
    RAISE EXCEPTION 'เฉพาะ Super Admin แก้สิทธิ์ได้' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('admin', 'staff', 'visitor') THEN
    RAISE EXCEPTION 'แก้สิทธิ์ role % ไม่ได้', p_role USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_permissions) <> 'object' THEN
    RAISE EXCEPTION 'permissions ต้องเป็น object' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO v_clean
    FROM jsonb_each(p_permissions)
   WHERE jsonb_typeof(value) = 'boolean' AND key ~ '^[a-z_]+\.[a-z_]+$';

  INSERT INTO public.role_permissions (role, permissions, updated_at, updated_by, updated_by_email)
  VALUES (p_role, v_clean, now(), auth.uid(), auth.jwt() ->> 'email')
  ON CONFLICT (role) DO UPDATE SET
    permissions      = EXCLUDED.permissions,
    updated_at       = now(),
    updated_by       = EXCLUDED.updated_by,
    updated_by_email = EXCLUDED.updated_by_email;

  RETURN jsonb_build_object('role', p_role, 'permissions', v_clean);
END;
$$;
REVOKE ALL ON FUNCTION public.set_role_permissions(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_role_permissions(text, jsonb) TO authenticated;

-- ====================================================================
-- 3. RPC guards
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.rpc_perm_guards (
  fn_name   text PRIMARY KEY,
  perm      text NOT NULL,          -- 'a|b' = any of
  arg_name  text,                   -- optional: pick the perm by this argument…
  arg_perms jsonb                   -- …value → perm (falls back to `perm`)
);
ALTER TABLE public.rpc_perm_guards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rpc_perm_guards FROM anon, authenticated;

-- Stock-changing actions: the TikTok mirror lookups run after any of them.
WITH stock_ops AS (
  SELECT 'pos.sell|pos.tiktok_confirm|pos.tiktok_resolve|sales.edit|sales.void|receive.create|receive.void|receive.edit|return.create|return.void|products.stock_adjust|products.tiktok_mapping|ecommerce.stock_reconcile|settings.tiktok'::text AS p
), any_view AS (
  SELECT 'view.pos|view.products|view.sales|view.receive|view.return|view.ecommerce|view.dashboard'::text AS p
)
INSERT INTO public.rpc_perm_guards (fn_name, perm, arg_name, arg_perms)
SELECT * FROM (VALUES
  ('create_sale_order_with_items',     'pos.sell', NULL, NULL),
  ('create_stock_movement_with_items', 'receive.create', 'p_kind',
     '{"receive": "receive.create", "claim": "receive.create", "return": "return.create"}'::jsonb),
  ('void_sale_order',                  'sales.void', NULL, NULL),
  ('edit_sale_order',                  'sales.edit', NULL, NULL),
  ('issue_tax_invoice_for_order',      'sales.tax_invoice|ecommerce.invoices', NULL, NULL),
  ('void_receive_order',               'receive.void', NULL, NULL),
  ('void_supplier_claim',              'receive.void', NULL, NULL),
  ('delete_receive_line',              'receive.edit', NULL, NULL),
  ('edit_receive_order',               'receive.edit', NULL, NULL),
  ('issue_purchase_doc_for_receive',   'receive.docs', NULL, NULL),
  ('issue_claim_doc_for_claim',        'receive.docs', NULL, NULL),
  ('void_return_order',                'return.void', NULL, NULL),
  ('issue_credit_note_for_return',     'return.credit_note', NULL, NULL),
  ('delete_product',                   'products.delete', NULL, NULL),
  ('manual_adjust_product_stock',      'products.stock_adjust', NULL, NULL),
  ('bulk_manual_adjust_product_stock', 'products.stock_adjust', NULL, NULL),
  ('log_stock_export',                 'products.export', NULL, NULL),
  ('confirm_tiktok_sale_order',        'pos.tiktok_confirm', NULL, NULL),
  ('confirm_tiktok_stock_resolution',  'pos.tiktok_resolve', NULL, NULL),
  ('create_tiktok_credit_note',        'ecommerce.returns', NULL, NULL),
  ('link_tiktok_item_to_product',      'ecommerce.matching', NULL, NULL),
  ('relink_tiktok_by_mapping',         'ecommerce.matching', NULL, NULL),
  ('upsert_tiktok_inventory_mapping',  'products.tiktok_mapping|ecommerce.matching|pos.tiktok_confirm|receive.create', NULL, NULL),
  ('clear_tiktok_product_image',       'products.tiktok_mapping|ecommerce.matching|settings.tiktok', NULL, NULL),
  ('reset_polluted_tiktok_images',     'settings.tiktok', NULL, NULL),
  ('backfill_tiktok_product_images',   'settings.tiktok|settings.ai', NULL, NULL),
  ('get_tiktok_unmatched_items',       'ecommerce.matching', NULL, NULL),
  ('get_pending_tiktok_orders',        'view.pos|view.ecommerce', NULL, NULL),
  ('get_pending_tiktok_stock_resolutions', 'view.pos|view.ecommerce', NULL, NULL),
  ('get_tiktok_cancel_return_meta',    'view.pos|view.ecommerce', NULL, NULL),
  ('get_tiktok_health',                'settings.tiktok|view.ecommerce', NULL, NULL)
) v
UNION ALL
SELECT f, (SELECT p FROM any_view), NULL, NULL
  FROM unnest(ARRAY['get_tiktok_connection_status', 'get_tiktok_mappings_for_products']) f
UNION ALL
SELECT f, (SELECT p FROM stock_ops), NULL, NULL
  FROM unnest(ARRAY['get_tiktok_void_mirror_targets', 'get_tiktok_sale_mirror_targets',
                    'get_tiktok_return_void_mirror_targets', 'get_bills_needing_sale_mirror_resync']) f
ON CONFLICT (fn_name) DO UPDATE SET
  perm = EXCLUDED.perm, arg_name = EXCLUDED.arg_name, arg_perms = EXCLUDED.arg_perms;

-- A guard wrapper's body sets the guard flag and calls <name>__impl.
CREATE OR REPLACE FUNCTION public._is_perm_wrapper(p_oid oid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT p.prosrc LIKE '%app.perm_guard_ok%'
     AND p.prosrc LIKE '%' || p.proname || '__impl(%'
    FROM pg_proc p WHERE p.oid = p_oid;
$$;
REVOKE ALL ON FUNCTION public._is_perm_wrapper(oid) FROM PUBLIC, anon, authenticated;

-- Wrap one function (every overload). Safe to re-run.
CREATE OR REPLACE FUNCTION public.apply_perm_guard(p_fn text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  g        public.rpc_perm_guards%ROWTYPE;
  r        record;
  v_impl   text := p_fn || '__impl';
  v_call   text;
  v_check  text;
  v_run    text;
  v_decl   text;
  v_tail   text;
  n        int := 0;
BEGIN
  SELECT * INTO g FROM public.rpc_perm_guards WHERE fn_name = p_fn;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no rpc_perm_guards row for %', p_fn;
  END IF;

  -- Public name: a wrapper is dropped (rebuilt below); a real body becomes
  -- the impl, replacing any stale impl with the same arguments. Detected by
  -- body, not comment: CREATE OR REPLACE keeps the old comment.
  FOR r IN
    SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS ident,
           public._is_perm_wrapper(p.oid) AS is_wrapper
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = p_fn
  LOOP
    IF r.is_wrapper THEN
      EXECUTE format('DROP FUNCTION public.%I(%s)', p_fn, r.ident);
    ELSE
      EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s)', v_impl, r.ident);
      EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', p_fn, r.ident, v_impl);
    END IF;
  END LOOP;

  IF g.arg_name IS NOT NULL THEN
    v_check := format('PERFORM public.require_perm(COALESCE(%L::jsonb ->> (%I)::text, %L));',
                      g.arg_perms::text, g.arg_name, g.perm);
  ELSE
    v_check := format('PERFORM public.require_perm(%L);', g.perm);
  END IF;

  FOR r IN
    SELECT p.oid, p.pronargs, p.proargnames, p.proargmodes, p.proretset,
           pg_get_function_identity_arguments(p.oid) AS ident,
           pg_get_function_arguments(p.oid)          AS args,
           pg_get_function_result(p.oid)             AS result
      FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = v_impl
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', v_impl, r.ident);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', v_impl, r.ident);

    IF r.proargmodes IS NULL THEN
      SELECT string_agg(format('%1$I => %1$I', r.proargnames[i]), ', ' ORDER BY i) INTO v_call
        FROM generate_series(1, r.pronargs) i;
    ELSE
      SELECT string_agg(format('%1$I => %1$I', r.proargnames[i]), ', ' ORDER BY i) INTO v_call
        FROM generate_series(1, array_length(r.proargmodes, 1)) i
       WHERE r.proargmodes[i] IN ('i', 'b');
    END IF;
    v_call := COALESCE(v_call, '');

    v_decl := 'v__prev text;';
    IF r.proretset THEN
      v_run  := format('RETURN QUERY SELECT * FROM public.%I(%s);', v_impl, v_call);
      v_tail := 'RETURN;';
    ELSIF r.result = 'void' THEN
      v_run  := format('PERFORM public.%I(%s);', v_impl, v_call);
      v_tail := 'RETURN;';
    ELSE
      v_decl := v_decl || format(' v__res %s;', r.result);
      v_run  := format('v__res := public.%I(%s);', v_impl, v_call);
      v_tail := 'RETURN v__res;';
    END IF;

    EXECUTE format($f$
      CREATE FUNCTION public.%1$I(%2$s)
      RETURNS %3$s
      LANGUAGE plpgsql
      VOLATILE
      SECURITY DEFINER
      SET search_path = public, auth
      AS $body$
      DECLARE %4$s
      BEGIN
        %5$s
        v__prev := current_setting('app.perm_guard_ok', true);
        PERFORM set_config('app.perm_guard_ok', 'on', true);
        %6$s
        PERFORM set_config('app.perm_guard_ok', COALESCE(v__prev, ''), true);
        %7$s
      END;
      $body$
    $f$, p_fn, r.args, r.result, v_decl, v_check, v_run, v_tail);

    EXECUTE format('COMMENT ON FUNCTION public.%I(%s) IS %L', p_fn, r.ident, 'perm-guard: ' || g.perm);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', p_fn, r.ident);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', p_fn, r.ident);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_perm_guard(text) FROM PUBLIC, anon, authenticated;

-- Wrap everything listed in rpc_perm_guards. Missing functions are skipped.
CREATE OR REPLACE FUNCTION public.apply_perm_guards()
RETURNS TABLE (fn_name text, wrapped int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  g record;
BEGIN
  FOR g IN SELECT x.fn_name FROM public.rpc_perm_guards x ORDER BY x.fn_name LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                WHERE ns.nspname = 'public'
                  AND p.proname IN (g.fn_name, g.fn_name || '__impl')) THEN
      fn_name := g.fn_name;
      wrapped := public.apply_perm_guard(g.fn_name);
    ELSE
      fn_name := g.fn_name;
      wrapped := 0;
      RAISE NOTICE 'perm guard: function % not found, skipped', g.fn_name;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_perm_guards() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.perm_guard_status AS
SELECT g.fn_name, g.perm,
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                WHERE ns.nspname = 'public' AND p.proname = g.fn_name
                  AND public._is_perm_wrapper(p.oid)) AS guarded,
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
                WHERE ns.nspname = 'public' AND p.proname = g.fn_name
                  AND NOT public._is_perm_wrapper(p.oid)) AS unguarded_body
  FROM public.rpc_perm_guards g;
REVOKE ALL ON public.perm_guard_status FROM anon, authenticated;

SELECT * FROM public.apply_perm_guards();

-- ====================================================================
-- 4. RLS around has_perm()
-- ====================================================================
-- Every policy on these tables is replaced, so the result does not depend
-- on what older migrations or the dashboard left behind. `(SELECT …)` makes
-- Postgres evaluate has_perm once per query, not per row.
CREATE OR REPLACE FUNCTION pg_temp.reset_policies(p_table text, p_read text, p_write text, p_write_cmds text[] DEFAULT ARRAY['INSERT', 'UPDATE', 'DELETE'])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  pol record;
  cmd text;
BEGIN
  IF to_regclass('public.' || p_table) IS NULL THEN
    RAISE NOTICE 'table % not found, skipped', p_table;
    RETURN;
  END IF;
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', p_table);
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = p_table LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, p_table);
  END LOOP;
  IF p_read IS NOT NULL THEN
    EXECUTE format('CREATE POLICY perm_read ON public.%I FOR SELECT TO authenticated USING (%s)', p_table, p_read);
  END IF;
  IF p_write IS NOT NULL THEN
    FOREACH cmd IN ARRAY p_write_cmds LOOP
      IF cmd = 'INSERT' THEN
        EXECUTE format('CREATE POLICY perm_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)', p_table, p_write);
      ELSIF cmd = 'UPDATE' THEN
        EXECUTE format('CREATE POLICY perm_update ON public.%1$I FOR UPDATE TO authenticated USING (%2$s) WITH CHECK (%2$s)', p_table, p_write);
      ELSIF cmd = 'DELETE' THEN
        EXECUTE format('CREATE POLICY perm_delete ON public.%I FOR DELETE TO authenticated USING (%s)', p_table, p_write);
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- Catalog: anyone reads; writes for product editors and receivers (the AI
-- bulk receive creates new products).
SELECT pg_temp.reset_policies(t, 'true', $$(SELECT public.has_perm('products.edit|receive.create'))$$)
  FROM unnest(ARRAY['products', 'brands', 'categories']) t;
SELECT pg_temp.reset_policies(t, 'true',
  $$(SELECT public.has_perm('products.edit|products.tiktok_mapping|settings.ai|settings.tiktok'))$$)
  FROM unnest(ARRAY['product_images', 'product_image_jobs']) t;

SELECT pg_temp.reset_policies('shop_settings', 'true',
  $$(SELECT public.has_perm('settings.shop|settings.paylater|settings.customer_price'))$$, ARRAY['UPDATE']);
SELECT pg_temp.reset_policies('suppliers', 'true',
  $$(SELECT public.has_perm('receive.create|receive.edit'))$$);

-- Bills: read for everyone signed in; written only through guarded RPCs,
-- except three direct header updates the app makes: "ยอดที่ได้รับจริง" on
-- sale_orders, and the header edit of a return / supplier-claim bill.
SELECT pg_temp.reset_policies('sale_orders', 'true',
  $$(SELECT public.has_perm('sales.net_received'))$$, ARRAY['UPDATE']);
SELECT pg_temp.reset_policies('return_orders', 'true',
  $$(SELECT public.has_perm('return.edit'))$$, ARRAY['UPDATE']);
SELECT pg_temp.reset_policies('supplier_claim_orders', 'true',
  $$(SELECT public.has_perm('receive.claim_edit'))$$, ARRAY['UPDATE']);
SELECT pg_temp.reset_policies(t, 'true', NULL)
  FROM unnest(ARRAY['sale_order_items', 'return_order_items', 'stock_movements',
                    'receive_orders', 'receive_order_items', 'supplier_claim_order_items']) t;

SELECT pg_temp.reset_policies('shop_expenses',
  $$(SELECT public.has_perm('view.dashboard|dashboard.expenses'))$$,
  $$(SELECT public.has_perm('dashboard.expenses'))$$);

-- TikTok
SELECT pg_temp.reset_policies('tiktok_product_mappings',
  $$(SELECT public.has_perm('view.pos|view.products|view.sales|view.receive|view.return|view.ecommerce|view.dashboard'))$$,
  $$(SELECT public.has_perm('products.tiktok_mapping|ecommerce.matching|pos.tiktok_confirm|receive.create'))$$);
SELECT pg_temp.reset_policies('tiktok_return_orders',
  $$(SELECT public.has_perm('view.pos|view.ecommerce'))$$, NULL);
SELECT pg_temp.reset_policies('tiktok_inventory_sync_log',
  $$(SELECT public.has_perm('view.ecommerce|settings.tiktok'))$$, NULL);

-- Settings / secrets
SELECT pg_temp.reset_policies('ai_api_keys',
  $$(SELECT public.has_perm('settings.ai'))$$, $$(SELECT public.has_perm('settings.ai'))$$);
SELECT pg_temp.reset_policies('shop_secrets',
  $$(SELECT public.has_perm('settings.ai|settings.telegram'))$$,
  $$(SELECT public.has_perm('settings.ai|settings.telegram'))$$, ARRAY['UPDATE']);
SELECT pg_temp.reset_policies('ai_usage_log',
  $$(user_id = auth.uid() OR (SELECT public.has_perm('settings.ai')))$$, NULL);

-- Audit trails (written by RPCs only)
SELECT pg_temp.reset_policies('sale_order_edits',
  $$(SELECT public.has_perm('view.sales|audit.view'))$$, NULL);
SELECT pg_temp.reset_policies(t, $$(SELECT public.has_perm('audit.view'))$$, NULL)
  FROM unnest(ARRAY['receive_order_edits', 'deletion_audit', 'stock_export_logs',
                    'stock_manual_adjustments']) t;

NOTIFY pgrst, 'reload schema';

-- Check after running:
--   SELECT * FROM public.perm_guard_status WHERE NOT guarded OR unguarded_body;  -- expect 0 rows
