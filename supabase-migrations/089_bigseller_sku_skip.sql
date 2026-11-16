-- 089_bigseller_sku_skip.sql
-- BigSeller export: mark a product "ไม่ส่ง BigSeller" (e.g. batteries that have
-- no SKU there) so it stops showing up as unresolved every batch.
--
--   bigseller_sku_map.source = 'skip' with merchant_sku NULL.
--   bigseller_set_sku_map accepts skip rows; bigseller_clear_sku_map undoes.
--
-- Super admin only, like 088. Idempotent.

ALTER TABLE public.bigseller_sku_map ALTER COLUMN merchant_sku DROP NOT NULL;

ALTER TABLE public.bigseller_sku_map DROP CONSTRAINT IF EXISTS bigseller_sku_map_source_check;
ALTER TABLE public.bigseller_sku_map
  ADD CONSTRAINT bigseller_sku_map_source_check
  CHECK (source IN ('tiktok', 'prefix', 'manual', 'skip'));

ALTER TABLE public.bigseller_sku_map DROP CONSTRAINT IF EXISTS bigseller_sku_map_skip_null;
ALTER TABLE public.bigseller_sku_map
  ADD CONSTRAINT bigseller_sku_map_skip_null
  CHECK ((source = 'skip') = (merchant_sku IS NULL));

-- Save choices: [{product_id, merchant_sku, source}]. 'skip' rows carry no SKU.
-- A 'manual' or 'skip' row is never overwritten by an automatic one.
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
  SELECT (r->>'product_id')::bigint,
         CASE WHEN r->>'source' = 'skip' THEN NULL ELSE trim(r->>'merchant_sku') END,
         r->>'source', now()
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) r
   WHERE r->>'source' = 'skip' OR NULLIF(trim(r->>'merchant_sku'), '') IS NOT NULL
  ON CONFLICT (product_id) DO UPDATE SET
    merchant_sku = EXCLUDED.merchant_sku,
    source       = EXCLUDED.source,
    updated_at   = now()
  WHERE bigseller_sku_map.source NOT IN ('manual', 'skip')
     OR EXCLUDED.source IN ('manual', 'skip');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Forget a saved choice (undo "ไม่ส่ง BigSeller" or a manual SKU).
CREATE OR REPLACE FUNCTION public.bigseller_clear_sku_map(p_product_id bigint)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.bigseller_sku_map WHERE product_id = p_product_id;
$$;

REVOKE ALL ON FUNCTION public.bigseller_set_sku_map(jsonb)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bigseller_clear_sku_map(bigint)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bigseller_set_sku_map(jsonb)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.bigseller_clear_sku_map(bigint) TO authenticated;

INSERT INTO public.rpc_perm_guards (fn_name, perm, arg_name, arg_perms) VALUES
  ('bigseller_set_sku_map',   'products.bigseller_export', NULL, NULL),
  ('bigseller_clear_sku_map', 'products.bigseller_export', NULL, NULL)
ON CONFLICT (fn_name) DO UPDATE SET perm = EXCLUDED.perm;

SELECT public.apply_perm_guards();
