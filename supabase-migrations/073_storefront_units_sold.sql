-- 073_storefront_units_sold.sql
-- POS gross units sold cache for TIMES_SHOP badge (all channels, no double-count).

ALTER TABLE public.storefront_products
  ADD COLUMN IF NOT EXISTS units_sold integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS units_sold_synced_at timestamptz;

COMMENT ON COLUMN public.storefront_products.units_sold IS
  'Cached gross sold qty from POS sale_order_items (all channels mapped to this SKU).';
COMMENT ON COLUMN public.storefront_products.units_sold_synced_at IS
  'Last refresh_storefront_units_sold() run.';

CREATE INDEX IF NOT EXISTS idx_sale_order_items_tiktok_sku_id
  ON public.sale_order_items (tiktok_sku_id)
  WHERE tiktok_sku_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sale_order_items_product_id
  ON public.sale_order_items (product_id)
  WHERE product_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.refresh_storefront_units_sold()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_service boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
  v_updated integer;
BEGIN
  IF NOT v_is_service THEN
    RAISE EXCEPTION 'service_role only' USING ERRCODE = '42501';
  END IF;

  WITH sales AS (
    SELECT
      sp.tiktok_sku_id,
      COALESCE(SUM(soi.quantity), 0)::integer AS cnt
    FROM public.storefront_products sp
    LEFT JOIN public.sale_order_items soi ON (
      soi.tiktok_sku_id = sp.tiktok_sku_id
      OR (
        sp.pos_product_id IS NOT NULL
        AND soi.product_id = sp.pos_product_id
        AND (soi.tiktok_sku_id IS NULL OR soi.tiktok_sku_id <> sp.tiktok_sku_id)
      )
    )
    LEFT JOIN public.sale_orders so ON so.id = soi.sale_order_id
      AND so.status = 'active'
      AND (so.channel <> 'tiktok' OR so.confirmed_at IS NOT NULL)
    WHERE sp.deleted_at IS NULL
    GROUP BY sp.tiktok_sku_id
  )
  UPDATE public.storefront_products sp
  SET
    units_sold = sales.cnt,
    units_sold_synced_at = now(),
    updated_at = now()
  FROM sales
  WHERE sp.tiktok_sku_id = sales.tiktok_sku_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_storefront_units_sold() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_storefront_units_sold() TO service_role;
