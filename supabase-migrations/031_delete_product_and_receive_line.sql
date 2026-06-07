-- 031_delete_product_and_receive_line.sql
-- In-app deletion (super-admin only) with stock reversal, bill recompute,
-- and an audit trail. Replaces the ad-hoc manual SQL used to remove
-- mis-recorded products.
--
-- Modes:
--   delete_receive_line  — remove ONE line from a receive bill (reverse
--                          stock, recompute totals, auto-void empty bill)
--   delete_product       — delete a product; allowed only if it was never
--                          sold/returned/claimed. Removes its receive lines
--                          (recomputing those bills) first.

-- ====================================================================
-- 1. Audit table
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.deletion_audit (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type     text NOT NULL CHECK (entity_type IN ('product','receive_line','receive_order')),
  entity_id       bigint,
  snapshot        jsonb,
  side_effects    jsonb,
  reason          text,
  deleted_by      uuid,
  deleted_by_email text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.deletion_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deletion_audit_read ON public.deletion_audit;
CREATE POLICY deletion_audit_read ON public.deletion_audit
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- helper: recompute receive_orders total_value + vat_amount from its lines
CREATE OR REPLACE FUNCTION public.recompute_receive_totals(p_receive_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sum numeric; v_rate numeric;
BEGIN
  SELECT COALESCE(sum(unit_price * quantity), 0) INTO v_sum
    FROM receive_order_items WHERE receive_order_id = p_receive_id;
  SELECT COALESCE(vat_rate, 0) INTO v_rate FROM receive_orders WHERE id = p_receive_id;
  UPDATE receive_orders
     SET total_value = v_sum,
         vat_amount  = CASE WHEN v_rate > 0 THEN round(v_sum * v_rate / (100 + v_rate), 2) ELSE 0 END,
         updated_at  = now()
   WHERE id = p_receive_id;
END;
$$;

-- ====================================================================
-- 2. delete_receive_line — remove one line, reverse stock, recompute
-- ====================================================================
CREATE OR REPLACE FUNCTION public.delete_receive_line(p_line_id bigint, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_line   receive_order_items%ROWTYPE;
  v_ro     receive_orders%ROWTYPE;
  v_remaining int;
  v_voided boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be logged in' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can delete receive lines' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_line FROM receive_order_items WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receive line % not found', p_line_id USING ERRCODE = 'P0002';
  END IF;
  -- lock the parent bill
  SELECT * INTO v_ro FROM receive_orders WHERE id = v_line.receive_order_id FOR UPDATE;
  IF v_ro.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot edit a voided receive order' USING ERRCODE = '22023';
  END IF;

  -- reverse stock for the removed line (only if it adjusted stock originally)
  IF v_line.product_id IS NOT NULL AND EXISTS (SELECT 1 FROM products WHERE id = v_line.product_id) THEN
    PERFORM public.adjust_stock(v_line.product_id, -(v_line.quantity), 'receive_void', 'receive_orders', v_line.receive_order_id);
  END IF;

  DELETE FROM receive_order_items WHERE id = p_line_id;

  SELECT count(*) INTO v_remaining FROM receive_order_items WHERE receive_order_id = v_line.receive_order_id;
  IF v_remaining = 0 THEN
    UPDATE receive_orders SET voided_at = now(), void_reason = COALESCE(p_reason, 'ลบบรรทัดสุดท้าย'), total_value = 0, vat_amount = 0, updated_at = now()
     WHERE id = v_line.receive_order_id;
    v_voided := true;
  ELSE
    PERFORM public.recompute_receive_totals(v_line.receive_order_id);
  END IF;

  INSERT INTO deletion_audit (entity_type, entity_id, snapshot, side_effects, reason, deleted_by, deleted_by_email)
  VALUES ('receive_line', p_line_id, to_jsonb(v_line),
          jsonb_build_object('receive_order_id', v_line.receive_order_id, 'stock_reversed', v_line.quantity, 'bill_voided', v_voided),
          p_reason, auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()));

  SELECT * INTO v_ro FROM receive_orders WHERE id = v_line.receive_order_id;
  RETURN jsonb_build_object('receive_order_id', v_line.receive_order_id, 'voided', v_voided,
                            'new_total', v_ro.total_value, 'new_vat', v_ro.vat_amount, 'remaining', v_remaining);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_receive_line(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_receive_line(bigint, text) TO authenticated;

-- ====================================================================
-- 3. delete_product — delete only if never sold/returned/claimed
-- ====================================================================
CREATE OR REPLACE FUNCTION public.delete_product(p_id bigint, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_prod      products%ROWTYPE;
  v_roid      bigint;
  v_removed   int := 0;
  v_recomp    int := 0;
  v_voided    int := 0;
  v_remaining int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be logged in' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin can delete products' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prod FROM products WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  -- BLOCK: keep products that carry sales/return/claim history (revenue/VAT integrity)
  IF EXISTS (SELECT 1 FROM sale_order_items       WHERE product_id = p_id)
  OR EXISTS (SELECT 1 FROM return_order_items      WHERE product_id = p_id)
  OR EXISTS (SELECT 1 FROM supplier_claim_order_items WHERE product_id = p_id) THEN
    RAISE EXCEPTION 'ลบไม่ได้: สินค้านี้มีประวัติการขาย/คืน/เคลม' USING ERRCODE = '22023';
  END IF;

  -- remove its receive lines and recompute (or void) each affected bill
  FOR v_roid IN SELECT DISTINCT receive_order_id FROM receive_order_items WHERE product_id = p_id LOOP
    DELETE FROM receive_order_items WHERE receive_order_id = v_roid AND product_id = p_id;
    v_removed := v_removed + 1;
    SELECT count(*) INTO v_remaining FROM receive_order_items WHERE receive_order_id = v_roid;
    IF v_remaining = 0 THEN
      UPDATE receive_orders SET voided_at = now(), void_reason = COALESCE(p_reason, 'ลบสินค้า — ไม่เหลือรายการ'),
             total_value = 0, vat_amount = 0, updated_at = now()
       WHERE id = v_roid AND voided_at IS NULL;
      v_voided := v_voided + 1;
    ELSE
      PERFORM public.recompute_receive_totals(v_roid);
      v_recomp := v_recomp + 1;
    END IF;
  END LOOP;

  -- product is going away entirely → drop its stock movements (FK), images/jobs cascade
  DELETE FROM stock_movements WHERE product_id = p_id;
  DELETE FROM products WHERE id = p_id;

  INSERT INTO deletion_audit (entity_type, entity_id, snapshot, side_effects, reason, deleted_by, deleted_by_email)
  VALUES ('product', p_id, to_jsonb(v_prod),
          jsonb_build_object('receive_lines_removed', v_removed, 'bills_recomputed', v_recomp, 'bills_voided', v_voided),
          p_reason, auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()));

  RETURN jsonb_build_object('deleted', true, 'receive_lines_removed', v_removed,
                            'bills_recomputed', v_recomp, 'bills_voided', v_voided);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_product(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_product(bigint, text) TO authenticated;
