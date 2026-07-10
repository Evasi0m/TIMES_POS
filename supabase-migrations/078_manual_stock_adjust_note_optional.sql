-- 078_manual_stock_adjust_note_optional.sql
-- Note optional for standard subreasons; required (min 20 chars) only when subreason = other.

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

  IF v_subreason = 'other' THEN
    IF v_note = '' THEN
      RAISE EXCEPTION 'note is required when subreason is other' USING ERRCODE = '22023';
    END IF;
    IF char_length(v_note) < 20 THEN
      RAISE EXCEPTION 'note must be at least 20 characters when subreason is other' USING ERRCODE = '22023';
    END IF;
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
  v_notes := '[' || v_subreason || ']'
    || CASE WHEN v_note <> '' THEN ' ' || v_note ELSE '' END;

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
