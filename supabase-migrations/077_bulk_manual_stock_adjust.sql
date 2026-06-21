-- 077_bulk_manual_stock_adjust.sql
-- Bulk manual stock adjust (super admin) + batch_id audit grouping + TikTok manual_adjust sync op.

-- ?? batch_id on audit table ?????????????????????????????????????????????????
ALTER TABLE public.stock_manual_adjustments
  ADD COLUMN IF NOT EXISTS batch_id bigint;

CREATE INDEX IF NOT EXISTS stock_manual_adjustments_batch_id_idx
  ON public.stock_manual_adjustments (batch_id)
  WHERE batch_id IS NOT NULL;

-- ?? Telegram toggle for stock adjust alerts ???????????????????????????????????
ALTER TABLE public.shop_secrets
  ADD COLUMN IF NOT EXISTS stock_adjust_notify_enabled boolean NOT NULL DEFAULT true;

-- ?? tiktok_inventory_sync_log: sync_operation manual_adjust ?????????????????
ALTER TABLE public.tiktok_inventory_sync_log
  DROP CONSTRAINT IF EXISTS tiktok_inventory_sync_log_sync_operation_check;

ALTER TABLE public.tiktok_inventory_sync_log
  ADD CONSTRAINT tiktok_inventory_sync_log_sync_operation_check
  CHECK (sync_operation IN (
    'receive', 'void', 'sale', 'sale_void', 'sale_edit', 'return', 'return_void',
    'reconcile', 'manual_adjust'
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

  IF v_op NOT IN (
    'receive', 'void', 'sale', 'sale_void', 'sale_edit', 'return', 'return_void',
    'reconcile', 'manual_adjust'
  ) THEN
    RAISE EXCEPTION 'Invalid sync_operation: %', v_op USING ERRCODE = '22023';
  END IF;

  -- sale_edit, reconcile, manual_adjust are repeatable (no idempotency guard).
  IF p_status = 'success' AND v_op NOT IN ('sale_edit', 'reconcile', 'manual_adjust') THEN
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
  )
  RETURNING id INTO v_existing;

  RETURN jsonb_build_object('ok', true, 'id', v_existing);
END;
$$;

-- ?? Internal helper: adjust one product (used by single + bulk RPCs) ?????????
CREATE OR REPLACE FUNCTION public._manual_adjust_one_product(
  p_product_id bigint,
  p_target_qty int,
  p_subreason  text,
  p_note       text,
  p_batch_id   bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_subreason   text := trim(coalesce(p_subreason, ''));
  v_note        text := trim(coalesce(p_note, ''));
  v_before      int;
  v_delta       int;
  v_after       int;
  v_audit_id    bigint;
  v_movement_id bigint;
  v_notes       text;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id required' USING ERRCODE = '22023';
  END IF;

  IF p_target_qty IS NULL OR p_target_qty < 0 THEN
    RAISE EXCEPTION 'target_qty must be >= 0' USING ERRCODE = '22023';
  END IF;

  IF v_subreason NOT IN (
    'recording_error', 'physical_count', 'damage_loss', 'legacy_data', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid subreason: %', v_subreason USING ERRCODE = '22023';
  END IF;

  IF v_note = '' THEN
    RAISE EXCEPTION 'note is required' USING ERRCODE = '22023';
  END IF;

  IF v_subreason = 'other' AND char_length(v_note) < 20 THEN
    RAISE EXCEPTION 'note must be at least 20 characters when subreason is other' USING ERRCODE = '22023';
  END IF;

  SELECT current_stock INTO v_before
    FROM public.products
   WHERE id = p_product_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;

  v_delta := p_target_qty - v_before;

  IF v_delta = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'product_id', p_product_id,
      'stock_before', v_before,
      'stock_after', v_before,
      'qty_delta', 0
    );
  END IF;

  v_after := p_target_qty;
  v_notes := '[' || v_subreason || '] ' || v_note;

  INSERT INTO public.stock_manual_adjustments (
    product_id, stock_before, stock_after, qty_delta,
    subreason, note, created_by, batch_id
  ) VALUES (
    p_product_id, v_before, v_after, v_delta,
    v_subreason, v_note, auth.uid(), p_batch_id
  )
  RETURNING id INTO v_audit_id;

  PERFORM public.adjust_stock(
    p_id        => p_product_id,
    qty_delta   => v_delta,
    p_reason    => 'manual_adjust',
    p_ref_table => 'stock_manual_adjustments',
    p_ref_id    => v_audit_id
  );

  SELECT id INTO v_movement_id
    FROM public.stock_movements
   WHERE ref_table = 'stock_manual_adjustments'
     AND ref_id = v_audit_id
     AND product_id = p_product_id
   ORDER BY id DESC
   LIMIT 1;

  IF v_movement_id IS NOT NULL THEN
    UPDATE public.stock_movements
       SET notes = v_notes,
           created_by = auth.uid()
     WHERE id = v_movement_id;

    UPDATE public.stock_manual_adjustments
       SET movement_id = v_movement_id
     WHERE id = v_audit_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'unchanged', false,
    'product_id', p_product_id,
    'audit_id', v_audit_id,
    'movement_id', v_movement_id,
    'stock_before', v_before,
    'stock_after', v_after,
    'qty_delta', v_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION public._manual_adjust_one_product(bigint, int, text, text, bigint) FROM PUBLIC;

-- ?? Single-product RPC (refactored to use helper) ???????????????????????????
CREATE OR REPLACE FUNCTION public.manual_adjust_product_stock(
  p_product_id bigint,
  p_target_qty int,
  p_subreason  text,
  p_note       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_is_service boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
BEGIN
  IF NOT v_is_service AND (auth.uid() IS NULL OR NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only super admin can manually adjust stock' USING ERRCODE = '42501';
  END IF;

  RETURN public._manual_adjust_one_product(
    p_product_id, p_target_qty, p_subreason, p_note, NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manual_adjust_product_stock(bigint, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manual_adjust_product_stock(bigint, int, text, text) TO authenticated;

-- ?? Bulk RPC ??????????????????????????????????????????????????????????????????
CREATE OR REPLACE FUNCTION public.bulk_manual_adjust_product_stock(
  p_batch_id bigint,
  p_subreason  text,
  p_note       text,
  p_items      jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_item       jsonb;
  v_pid        bigint;
  v_target     int;
  v_result     jsonb;
  v_applied    int := 0;
  v_unchanged  int := 0;
  v_errors     jsonb := '[]'::jsonb;
  v_audit_ids  jsonb := '[]'::jsonb;
  v_is_service boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
BEGIN
  IF NOT v_is_service AND (auth.uid() IS NULL OR NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only super admin can manually adjust stock' USING ERRCODE = '42501';
  END IF;

  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'batch_id required' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'p_items max 100 items per batch' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := NULLIF(v_item->>'product_id', '')::bigint;
    v_target := GREATEST(0, COALESCE((v_item->>'target_qty')::int, 0));

    IF v_pid IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', null, 'error', 'missing product_id'
      ));
      CONTINUE;
    END IF;

    BEGIN
      v_result := public._manual_adjust_one_product(
        v_pid, v_target, p_subreason, p_note, p_batch_id
      );

      IF COALESCE((v_result->>'unchanged')::boolean, false) THEN
        v_unchanged := v_unchanged + 1;
      ELSE
        v_applied := v_applied + 1;
        IF v_result->>'audit_id' IS NOT NULL THEN
          v_audit_ids := v_audit_ids || jsonb_build_array((v_result->>'audit_id')::bigint);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'product_id', v_pid,
        'error', SQLERRM,
        'target_qty', v_target
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'applied', v_applied,
    'unchanged', v_unchanged,
    'errors', v_errors,
    'audit_ids', v_audit_ids
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_manual_adjust_product_stock(bigint, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bulk_manual_adjust_product_stock(bigint, text, text, jsonb) TO authenticated;
