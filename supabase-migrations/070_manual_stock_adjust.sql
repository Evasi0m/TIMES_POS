-- 070_manual_stock_adjust.sql
-- Super-admin manual stock correction via RPC (target qty + audit trail).
-- Uses existing adjust_stock(..., 'manual_adjust', ...) — no direct products UPDATE from client.

-- Optional: who triggered a movement (manual adjusts + future use).
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── Audit table ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stock_manual_adjustments (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id    bigint NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  stock_before  int NOT NULL,
  stock_after   int NOT NULL CHECK (stock_after >= 0),
  qty_delta     int NOT NULL,
  subreason     text NOT NULL CHECK (subreason IN (
    'recording_error', 'physical_count', 'damage_loss', 'legacy_data', 'other'
  )),
  note          text NOT NULL,
  movement_id   bigint REFERENCES public.stock_movements(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_manual_adjustments_product_id_idx
  ON public.stock_manual_adjustments (product_id);

CREATE INDEX IF NOT EXISTS stock_manual_adjustments_created_at_idx
  ON public.stock_manual_adjustments (created_at DESC);

ALTER TABLE public.stock_manual_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_manual_adjustments_select ON public.stock_manual_adjustments;
CREATE POLICY stock_manual_adjustments_select ON public.stock_manual_adjustments
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

REVOKE ALL ON TABLE public.stock_manual_adjustments FROM PUBLIC;
GRANT SELECT ON TABLE public.stock_manual_adjustments TO authenticated;

-- ── RPC: manual_adjust_product_stock ────────────────────────────────────────
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
  v_subreason   text := trim(coalesce(p_subreason, ''));
  v_note        text := trim(coalesce(p_note, ''));
  v_before      int;
  v_delta       int;
  v_after       int;
  v_audit_id    bigint;
  v_movement_id bigint;
  v_notes       text;
  v_is_service  boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
BEGIN
  IF NOT v_is_service AND (auth.uid() IS NULL OR NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only super admin can manually adjust stock' USING ERRCODE = '42501';
  END IF;

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
    subreason, note, created_by
  ) VALUES (
    p_product_id, v_before, v_after, v_delta,
    v_subreason, v_note, auth.uid()
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

REVOKE ALL ON FUNCTION public.manual_adjust_product_stock(bigint, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manual_adjust_product_stock(bigint, int, text, text) TO authenticated;
