-- 052_tiktok_inventory_sync_service_role.sql
-- Edge Function tiktok-inventory-update uses service_role (auth.uid() IS NULL).
-- log_tiktok_inventory_sync previously required is_admin() → log silently failed,
-- TikTok updated but no row in tiktok_inventory_sync_log → void mirror skipped.

CREATE OR REPLACE FUNCTION public.log_tiktok_inventory_sync(
  p_receive_order_id  bigint,
  p_product_id        bigint,
  p_tiktok_sku_id     text,
  p_pos_stock_after   int,
  p_tiktok_qty_before int,
  p_tiktok_qty_after  int,
  p_status            text,
  p_error_message     text DEFAULT NULL,
  p_sync_operation    text DEFAULT 'receive'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing bigint;
  v_op text := COALESCE(NULLIF(trim(p_sync_operation), ''), 'receive');
  v_is_service boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
BEGIN
  -- service_role (Edge Functions) or logged-in admin
  IF NOT v_is_service AND (auth.uid() IS NULL OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  IF v_op NOT IN ('receive', 'void') THEN
    RAISE EXCEPTION 'Invalid sync_operation: %', v_op USING ERRCODE = '22023';
  END IF;

  IF p_status = 'success' THEN
    SELECT id INTO v_existing
      FROM public.tiktok_inventory_sync_log
     WHERE receive_order_id = p_receive_order_id
       AND product_id = p_product_id
       AND sync_operation = v_op
       AND status = 'success'
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true);
    END IF;
  END IF;

  INSERT INTO public.tiktok_inventory_sync_log (
    receive_order_id, product_id, tiktok_sku_id,
    pos_stock_after, tiktok_qty_before, tiktok_qty_after,
    status, error_message, sync_operation, created_by
  ) VALUES (
    p_receive_order_id, p_product_id, p_tiktok_sku_id,
    p_pos_stock_after, p_tiktok_qty_before, p_tiktok_qty_after,
    p_status, p_error_message, v_op, auth.uid()
  );

  RETURN jsonb_build_object('ok', true, 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.log_tiktok_inventory_sync(bigint, bigint, text, int, int, int, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_tiktok_inventory_sync(bigint, bigint, text, int, int, int, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_tiktok_inventory_sync(bigint, bigint, text, int, int, int, text, text, text) TO service_role;

-- Edge also upserts mapping after mirror; allow service_role there too.
CREATE OR REPLACE FUNCTION public.upsert_tiktok_inventory_mapping(
  p_tiktok_sku_id      text,
  p_product_id         bigint,
  p_tiktok_product_id  text,
  p_seller_sku         text DEFAULT NULL,
  p_tiktok_product_name text DEFAULT NULL,
  p_warehouse_id       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(p_tiktok_sku_id), '') IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'tiktok_sku_id and product_id required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tiktok_product_mappings (
    tiktok_sku_id, product_id, seller_sku, tiktok_product_name,
    tiktok_product_id, warehouse_id, sync_enabled, updated_at
  ) VALUES (
    trim(p_tiktok_sku_id), p_product_id, p_seller_sku, p_tiktok_product_name,
    p_tiktok_product_id, p_warehouse_id, true, now()
  )
  ON CONFLICT (tiktok_sku_id) DO UPDATE SET
    product_id          = EXCLUDED.product_id,
    seller_sku          = COALESCE(EXCLUDED.seller_sku, tiktok_product_mappings.seller_sku),
    tiktok_product_name = COALESCE(EXCLUDED.tiktok_product_name, tiktok_product_mappings.tiktok_product_name),
    tiktok_product_id   = COALESCE(EXCLUDED.tiktok_product_id, tiktok_product_mappings.tiktok_product_id),
    warehouse_id        = COALESCE(EXCLUDED.warehouse_id, tiktok_product_mappings.warehouse_id),
    sync_enabled        = true,
    updated_at          = now();

  RETURN jsonb_build_object('ok', true, 'tiktok_sku_id', trim(p_tiktok_sku_id));
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_tiktok_inventory_mapping(text, bigint, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_tiktok_inventory_mapping(text, bigint, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_tiktok_inventory_mapping(text, bigint, text, text, text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.tiktok_inventory_already_synced(bigint, bigint, text) TO service_role;
