-- 055_tiktok_sale_mirror.sql — mirror POS stock → TikTok after sale / void / edit
--
-- receive_order_id column stores ref order id for all ops:
--   receive/void → receive_orders.id
--   sale/sale_void/sale_edit → sale_orders.id

ALTER TABLE public.tiktok_inventory_sync_log
  DROP CONSTRAINT IF EXISTS tiktok_inventory_sync_log_sync_operation_check;

ALTER TABLE public.tiktok_inventory_sync_log
  ADD CONSTRAINT tiktok_inventory_sync_log_sync_operation_check
  CHECK (sync_operation IN ('receive', 'void', 'sale', 'sale_void', 'sale_edit'));

-- ── log sync (service_role + admin; sale ops) ───────────────────────────────
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
  IF NOT v_is_service AND (auth.uid() IS NULL OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  IF v_op NOT IN ('receive', 'void', 'sale', 'sale_void', 'sale_edit') THEN
    RAISE EXCEPTION 'Invalid sync_operation: %', v_op USING ERRCODE = '22023';
  END IF;

  -- sale_edit may run multiple times per bill — always log + allow re-sync
  IF p_status = 'success' AND v_op <> 'sale_edit' THEN
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

-- ── targets for sale void mirror (sale success, sale_void not yet done) ───
CREATE OR REPLACE FUNCTION public.get_tiktok_sale_mirror_targets(
  p_sale_order_id bigint,
  p_product_ids bigint[] DEFAULT NULL
)
RETURNS TABLE (
  product_id bigint,
  tiktok_sku_id text,
  tiktok_product_id text,
  warehouse_id text,
  seller_sku text,
  tiktok_product_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT DISTINCT ON (l.product_id)
    l.product_id,
    COALESCE(m.tiktok_sku_id, l.tiktok_sku_id) AS tiktok_sku_id,
    m.tiktok_product_id,
    m.warehouse_id,
    m.seller_sku,
    m.tiktok_product_name
  FROM public.tiktok_inventory_sync_log l
  LEFT JOIN public.tiktok_product_mappings m
    ON m.product_id = l.product_id AND COALESCE(m.sync_enabled, true)
  WHERE l.receive_order_id = p_sale_order_id
    AND l.sync_operation = 'sale'
    AND l.status = 'success'
    AND l.product_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.tiktok_inventory_sync_log v
       WHERE v.receive_order_id = l.receive_order_id
         AND v.product_id = l.product_id
         AND v.sync_operation = 'sale_void'
         AND v.status = 'success'
    )
    AND (p_product_ids IS NULL OR l.product_id = ANY(p_product_ids))
  ORDER BY l.product_id, l.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_tiktok_sale_mirror_targets(bigint, bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tiktok_sale_mirror_targets(bigint, bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tiktok_sale_mirror_targets(bigint, bigint[]) TO service_role;
