-- 065_tiktok_stock_reconcile.sql
-- TikTok ↔ POS stock reconciliation: audit reason + sync op + POS adjust RPC.

-- ── stock_movements: allow stock_reconcile ───────────────────────────────────
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reason_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason = ANY (ARRAY[
    'sale'::text,
    'sale_void'::text,
    'sale_edit'::text,
    'receive'::text,
    'receive_void'::text,
    'return_in'::text,
    'return_void'::text,
    'manual_adjust'::text,
    'initial'::text,
    'supplier_claim'::text,
    'supplier_claim_void'::text,
    'stock_reconcile'::text
  ]));

-- ── tiktok_inventory_sync_log: sync_operation reconcile ─────────────────────
ALTER TABLE public.tiktok_inventory_sync_log
  DROP CONSTRAINT IF EXISTS tiktok_inventory_sync_log_sync_operation_check;

ALTER TABLE public.tiktok_inventory_sync_log
  ADD CONSTRAINT tiktok_inventory_sync_log_sync_operation_check
  CHECK (sync_operation IN (
    'receive', 'void', 'sale', 'sale_void', 'sale_edit', 'return', 'return_void', 'reconcile'
  ));

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

  IF v_op NOT IN ('receive', 'void', 'sale', 'sale_void', 'sale_edit', 'return', 'return_void', 'reconcile') THEN
    RAISE EXCEPTION 'Invalid sync_operation: %', v_op USING ERRCODE = '22023';
  END IF;

  -- sale_edit + reconcile are repeatable (no idempotency guard).
  IF p_status = 'success' AND v_op NOT IN ('sale_edit', 'reconcile') THEN
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

-- ── Adjust POS stock to match TikTok (super admin only) ─────────────────────
CREATE OR REPLACE FUNCTION public.reconcile_pos_stock_from_tiktok(
  p_batch_id bigint,
  p_items    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_item   jsonb;
  v_pid    bigint;
  v_target int;
  v_before int;
  v_curr   int;
  v_delta  int;
  v_applied int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_is_service boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
BEGIN
  IF NOT v_is_service AND (auth.uid() IS NULL OR NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only super admin can reconcile stock' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := NULLIF(v_item->>'product_id', '')::bigint;
    v_target := GREATEST(0, COALESCE((v_item->>'target_qty')::int, 0));
    v_before := COALESCE((v_item->>'tiktok_qty_before')::int, 0);

    IF v_pid IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', null, 'error', 'missing product_id'
      ));
      CONTINUE;
    END IF;

    SELECT current_stock INTO v_curr FROM public.products WHERE id = v_pid;
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_pid, 'error', 'product not found'
      ));
      CONTINUE;
    END IF;

    v_delta := v_target - v_curr;
    IF v_delta = 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    BEGIN
      PERFORM public.adjust_stock(
        p_id       => v_pid,
        qty_delta  => v_delta,
        p_reason   => 'stock_reconcile',
        p_ref_table=> 'tiktok_stock_reconcile',
        p_ref_id   => p_batch_id
      );
      v_applied := v_applied + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_pid,
        'error', SQLERRM,
        'target_qty', v_target,
        'pos_before', v_curr,
        'tiktok_qty_before', v_before
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'applied', v_applied,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_pos_stock_from_tiktok(bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_pos_stock_from_tiktok(bigint, jsonb) TO authenticated;
