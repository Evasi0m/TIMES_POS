-- 088_bigseller_export.sql
-- Export POS stock changes that BigSeller cannot see, as Manual Stock-In /
-- Stock-Out Excel files (BigSeller has no write API).
--
--   bigseller_skus           Merchant SKU list (admin upload, replaced whole).
--   bigseller_sku_map        POS product → Merchant SKU (tiktok / prefix / manual).
--   bigseller_export_batches One row per export; to_movement_id is the cursor,
--                            so a movement is never exported twice. Rows are
--                            kept as jsonb so an old batch can be re-downloaded.
--
-- Which movements count (channel filter, SKU resolution, netting) is decided
-- in the app: src/lib/bigseller-export.js. The RPCs only fetch and record.
--
-- Permission: 'products.bigseller_export' (admin on by default, super admin
-- always). Guards registered in rpc_perm_guards → apply_perm_guards() (086).
--
-- Idempotent.

-- ====================================================================
-- 1. Tables
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.bigseller_skus (
  merchant_sku text PRIMARY KEY,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bigseller_sku_map (
  product_id   bigint PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  merchant_sku text NOT NULL,
  source       text NOT NULL CHECK (source IN ('tiktok', 'prefix', 'manual')),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bigseller_export_batches (
  id                bigserial PRIMARY KEY,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid DEFAULT auth.uid(),
  created_by_email  text,
  from_movement_id  bigint NOT NULL,   -- exclusive: movements with id > this
  to_movement_id    bigint NOT NULL,   -- inclusive
  in_rows           int NOT NULL DEFAULT 0,
  out_rows          int NOT NULL DEFAULT 0,
  unresolved_count  int NOT NULL DEFAULT 0,
  filename_in       text,
  filename_out      text,
  rows_in           jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{sku, qty, unit_cost}]
  rows_out          jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{sku, qty}]
  unresolved        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{product_id, name, net}]
  CHECK (to_movement_id >= from_movement_id)
);
CREATE INDEX IF NOT EXISTS idx_bigseller_batches_to ON public.bigseller_export_batches(to_movement_id DESC);

-- ====================================================================
-- 2. RLS — read with the permission; writes only through the RPCs below
-- ====================================================================
ALTER TABLE public.bigseller_skus           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bigseller_sku_map        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bigseller_export_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bigseller_skus_read ON public.bigseller_skus;
CREATE POLICY bigseller_skus_read ON public.bigseller_skus
  FOR SELECT TO authenticated USING ((SELECT public.has_perm('products.bigseller_export')));

DROP POLICY IF EXISTS bigseller_sku_map_read ON public.bigseller_sku_map;
CREATE POLICY bigseller_sku_map_read ON public.bigseller_sku_map
  FOR SELECT TO authenticated USING ((SELECT public.has_perm('products.bigseller_export')));

DROP POLICY IF EXISTS bigseller_batches_read ON public.bigseller_export_batches;
CREATE POLICY bigseller_batches_read ON public.bigseller_export_batches
  FOR SELECT TO authenticated USING ((SELECT public.has_perm('products.bigseller_export')));

REVOKE ALL ON public.bigseller_skus, public.bigseller_sku_map, public.bigseller_export_batches FROM anon;
GRANT SELECT ON public.bigseller_skus, public.bigseller_sku_map, public.bigseller_export_batches TO authenticated;

-- ====================================================================
-- 3. RPCs
-- ====================================================================

-- Replace the whole Merchant SKU list (admin upload). Returns the new count.
CREATE OR REPLACE FUNCTION public.bigseller_replace_skus(p_skus text[])
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  IF p_skus IS NULL OR cardinality(p_skus) = 0 THEN
    RAISE EXCEPTION 'รายการ SKU ว่าง' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.bigseller_skus WHERE true;
  INSERT INTO public.bigseller_skus (merchant_sku)
  SELECT DISTINCT trim(s) FROM unnest(p_skus) s WHERE NULLIF(trim(s), '') IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Save resolved / manual SKU choices: [{product_id, merchant_sku, source}].
-- A 'manual' row is never overwritten by an automatic one.
CREATE OR REPLACE FUNCTION public.bigseller_set_sku_map(p_rows jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int;
BEGIN
  INSERT INTO public.bigseller_sku_map (product_id, merchant_sku, source, updated_at)
  SELECT (r->>'product_id')::bigint, trim(r->>'merchant_sku'), r->>'source', now()
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) r
   WHERE NULLIF(trim(r->>'merchant_sku'), '') IS NOT NULL
  ON CONFLICT (product_id) DO UPDATE SET
    merchant_sku = EXCLUDED.merchant_sku,
    source       = EXCLUDED.source,
    updated_at   = now()
  WHERE bigseller_sku_map.source <> 'manual' OR EXCLUDED.source = 'manual';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Cursor state: last exported movement id (NULL on first run) + current max.
CREATE OR REPLACE FUNCTION public.bigseller_export_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'last_to_movement_id', (SELECT max(to_movement_id) FROM public.bigseller_export_batches),
    'max_movement_id',     (SELECT COALESCE(max(id), 0) FROM public.stock_movements)
  );
$$;

-- Last movement id created before a moment (first-run start point by date).
CREATE OR REPLACE FUNCTION public.bigseller_movement_id_before(p_at timestamptz)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(max(id), 0) FROM public.stock_movements WHERE created_at < p_at;
$$;

-- Movements in (p_from, p_to] with the order channel for sale / return moves.
CREATE OR REPLACE FUNCTION public.bigseller_export_movements(p_from bigint, p_to bigint)
RETURNS TABLE (
  id         bigint,
  product_id bigint,
  qty_delta  int,
  reason     text,
  ref_table  text,
  channel    text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.product_id, m.qty_delta::int, m.reason, m.ref_table,
         CASE m.ref_table
           WHEN 'sale_orders'   THEN so.channel
           WHEN 'return_orders' THEN ro.channel
         END AS channel,
         m.created_at
    FROM public.stock_movements m
    LEFT JOIN public.sale_orders   so ON m.ref_table = 'sale_orders'   AND so.id = m.ref_id
    LEFT JOIN public.return_orders ro ON m.ref_table = 'return_orders' AND ro.id = m.ref_id
   WHERE m.id > p_from AND m.id <= p_to
   ORDER BY m.id;
$$;

-- Record an export. p_from must equal the last batch's to_movement_id (or be
-- the first batch), so two admins can't export the same range twice.
CREATE OR REPLACE FUNCTION public.bigseller_record_batch(
  p_from         bigint,
  p_to           bigint,
  p_rows_in      jsonb,
  p_rows_out     jsonb,
  p_unresolved   jsonb,
  p_filename_in  text,
  p_filename_out text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_last bigint;
  v_id   bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('bigseller_export_batches'));
  SELECT max(to_movement_id) INTO v_last FROM public.bigseller_export_batches;
  IF v_last IS NOT NULL AND p_from <> v_last THEN
    RAISE EXCEPTION 'มีการ export ช่วงนี้ไปแล้ว (ล่าสุดถึง movement %) — โหลดใหม่แล้วลองอีกครั้ง', v_last
      USING ERRCODE = '40001';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'ช่วง movement ไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bigseller_export_batches (
    created_by, created_by_email, from_movement_id, to_movement_id,
    in_rows, out_rows, unresolved_count, filename_in, filename_out,
    rows_in, rows_out, unresolved
  ) VALUES (
    auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()), p_from, p_to,
    jsonb_array_length(COALESCE(p_rows_in, '[]'::jsonb)),
    jsonb_array_length(COALESCE(p_rows_out, '[]'::jsonb)),
    jsonb_array_length(COALESCE(p_unresolved, '[]'::jsonb)),
    p_filename_in, p_filename_out,
    COALESCE(p_rows_in, '[]'::jsonb), COALESCE(p_rows_out, '[]'::jsonb), COALESCE(p_unresolved, '[]'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bigseller_replace_skus(text[])               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bigseller_set_sku_map(jsonb)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bigseller_export_state()                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bigseller_movement_id_before(timestamptz)    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bigseller_export_movements(bigint, bigint)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bigseller_record_batch(bigint, bigint, jsonb, jsonb, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bigseller_replace_skus(text[])               TO authenticated;
GRANT EXECUTE ON FUNCTION public.bigseller_set_sku_map(jsonb)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.bigseller_export_state()                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.bigseller_movement_id_before(timestamptz)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.bigseller_export_movements(bigint, bigint)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.bigseller_record_batch(bigint, bigint, jsonb, jsonb, jsonb, text, text) TO authenticated;

-- ====================================================================
-- 4. Permission key + guards
-- ====================================================================
UPDATE public.role_permissions
   SET permissions = permissions || '{"products.bigseller_export": true}'::jsonb,
       updated_at  = now()
 WHERE role = 'admin' AND NOT (permissions ? 'products.bigseller_export');

INSERT INTO public.rpc_perm_guards (fn_name, perm, arg_name, arg_perms) VALUES
  ('bigseller_replace_skus',       'products.bigseller_export', NULL, NULL),
  ('bigseller_set_sku_map',        'products.bigseller_export', NULL, NULL),
  ('bigseller_export_state',       'products.bigseller_export', NULL, NULL),
  ('bigseller_movement_id_before', 'products.bigseller_export', NULL, NULL),
  ('bigseller_export_movements',   'products.bigseller_export', NULL, NULL),
  ('bigseller_record_batch',       'products.bigseller_export', NULL, NULL)
ON CONFLICT (fn_name) DO UPDATE SET perm = EXCLUDED.perm;

SELECT public.apply_perm_guards();
