-- 083_edit_receive_order.sql
-- Super-admin-only, atomic edit of an existing receive bill (ประวัติรับเข้า):
-- header fields, line quantity / unit price / discounts, add lines, remove
-- lines. Stock follows the change in the same transaction.
--
-- Side effects:
--   * Stock: per product, delta = new qty − old qty, applied via
--     public.adjust_stock(reason => 'receive_edit'). If lowering a receive
--     would take a product's stock below 0 (the goods were already sold),
--     the whole edit is refused and nothing changes.
--   * Totals: total_value / vat_amount recomputed server-side from the lines,
--     discounts included (same cascade as the app's applyDiscounts).
--   * Audit: one receive_order_edits row with before/after snapshots.
--   * TikTok: not touched here — the client mirrors current POS stock for the
--     affected products after this returns (sync_operation 'manual_adjust').
--
-- Idempotent no-op: if nothing changes, nothing is written.

-- ====================================================================
-- 1. Allow the new stock movement reason
-- ====================================================================
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
    'receive_edit'::text,
    'return_in'::text,
    'return_void'::text,
    'manual_adjust'::text,
    'initial'::text,
    'supplier_claim'::text,
    'supplier_claim_void'::text,
    'stock_reconcile'::text
  ]));

-- ====================================================================
-- 2. Audit table
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.receive_order_edits (
  id                bigserial   PRIMARY KEY,
  receive_order_id  bigint      NOT NULL REFERENCES public.receive_orders(id) ON DELETE CASCADE,
  edited_at         timestamptz NOT NULL DEFAULT now(),
  edited_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_by_email   text,
  before            jsonb       NOT NULL,   -- { header: {...}, lines: [...] }
  after             jsonb       NOT NULL,
  stock_deltas      jsonb       NOT NULL,   -- [{ product_id, delta }]
  reason            text
);
CREATE INDEX IF NOT EXISTS receive_order_edits_order_idx
  ON public.receive_order_edits (receive_order_id, edited_at DESC);

ALTER TABLE public.receive_order_edits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS receive_order_edits_read ON public.receive_order_edits;
CREATE POLICY receive_order_edits_read ON public.receive_order_edits
  FOR SELECT TO authenticated USING (public.is_super_admin());

-- ====================================================================
-- 3. Line total with the app's discount cascade
-- ====================================================================
CREATE OR REPLACE FUNCTION public.receive_line_total(
  p_unit_price numeric, p_qty numeric,
  p_d1v numeric, p_d1t text, p_d2v numeric, p_d2t text
) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  WITH s1 AS (
    SELECT CASE
      WHEN p_d1t = 'percent' THEN round(round(p_unit_price, 2) * (1 - COALESCE(p_d1v, 0) / 100), 2)
      WHEN p_d1t = 'baht'    THEN round(round(p_unit_price, 2) - COALESCE(p_d1v, 0), 2)
      ELSE round(p_unit_price, 2)
    END AS v
  ), s2 AS (
    SELECT CASE
      WHEN p_d2t = 'percent' THEN round(s1.v * (1 - COALESCE(p_d2v, 0) / 100), 2)
      WHEN p_d2t = 'baht'    THEN round(s1.v - COALESCE(p_d2v, 0), 2)
      ELSE s1.v
    END AS v FROM s1
  )
  SELECT round(GREATEST(0, s2.v) * COALESCE(p_qty, 0), 2) FROM s2;
$$;

-- ====================================================================
-- 4. edit_receive_order
-- ====================================================================
-- p_header: any of { receive_date, supplier_name, supplier_invoice_no,
--                    supplier_tax_id, notes } — omitted keys stay as-is.
-- p_lines:  the FULL desired line list. Each element:
--   { id?: bigint,             -- existing line; omit for a new line
--     product_id: bigint,
--     quantity: int (>0),
--     unit_price: numeric (>=0),
--     discount1_value?, discount1_type?, discount2_value?, discount2_type? }
--   Existing lines not present in p_lines are removed.
CREATE OR REPLACE FUNCTION public.edit_receive_order(
  p_id     bigint,
  p_header jsonb DEFAULT '{}'::jsonb,
  p_lines  jsonb DEFAULT NULL,
  p_reason text  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_ro          receive_orders%ROWTYPE;
  v_before      jsonb;
  v_after       jsonb;
  v_line        jsonb;
  v_line_id     bigint;
  v_pid         bigint;
  v_qty         int;
  v_price       numeric;
  v_name        text;
  v_keep_ids    bigint[] := ARRAY[]::bigint[];
  v_deltas      jsonb := '[]'::jsonb;
  v_rec         record;
  v_sum         numeric;
  v_changed     boolean;
  v_old_qty     jsonb;
  v_stock       int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be logged in' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'แก้ไขบิลรับเข้าได้เฉพาะ super admin' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ro FROM receive_orders WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบบิลรับเข้า #%', p_id USING ERRCODE = 'P0002';
  END IF;
  IF v_ro.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'บิลนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้' USING ERRCODE = '22023';
  END IF;

  -- Snapshot before.
  SELECT jsonb_build_object(
           'header', to_jsonb(v_ro),
           'lines', COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb))
    INTO v_before
    FROM receive_order_items i WHERE i.receive_order_id = p_id;

  -- Old quantities per product (for stock deltas): { "<product_id>": qty }.
  SELECT COALESCE(jsonb_object_agg(product_id::text, qty), '{}'::jsonb) INTO v_old_qty
    FROM (SELECT product_id, sum(quantity)::int AS qty
            FROM receive_order_items WHERE receive_order_id = p_id AND product_id IS NOT NULL
           GROUP BY product_id) o;

  -- ── Header ──────────────────────────────────────────────────────────
  UPDATE receive_orders SET
    receive_date        = COALESCE((p_header->>'receive_date')::timestamptz, receive_date),
    supplier_name       = CASE WHEN p_header ? 'supplier_name'
                               THEN NULLIF(trim(p_header->>'supplier_name'), '') ELSE supplier_name END,
    supplier_invoice_no = CASE WHEN p_header ? 'supplier_invoice_no'
                               THEN NULLIF(trim(p_header->>'supplier_invoice_no'), '') ELSE supplier_invoice_no END,
    supplier_tax_id     = CASE WHEN p_header ? 'supplier_tax_id'
                               THEN NULLIF(regexp_replace(COALESCE(p_header->>'supplier_tax_id', ''), '\D', '', 'g'), '')
                               ELSE supplier_tax_id END,
    notes               = CASE WHEN p_header ? 'notes'
                               THEN NULLIF(trim(p_header->>'notes'), '') ELSE notes END
   WHERE id = p_id;

  -- ── Lines ───────────────────────────────────────────────────────────
  IF p_lines IS NOT NULL THEN
    IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
      RAISE EXCEPTION 'บิลต้องมีอย่างน้อย 1 รายการ — ถ้าต้องการลบทั้งบิลให้ใช้ยกเลิกบิล' USING ERRCODE = '22023';
    END IF;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
      v_pid   := (v_line->>'product_id')::bigint;
      v_qty   := (v_line->>'quantity')::int;
      v_price := (v_line->>'unit_price')::numeric;
      IF v_pid IS NULL OR v_qty IS NULL OR v_qty <= 0 OR v_price IS NULL OR v_price < 0 THEN
        RAISE EXCEPTION 'รายการไม่ครบ: ต้องมีสินค้า จำนวนมากกว่า 0 และราคาไม่ติดลบ' USING ERRCODE = '22023';
      END IF;
      SELECT name INTO v_name FROM products WHERE id = v_pid;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ไม่พบสินค้า id %', v_pid USING ERRCODE = 'P0002';
      END IF;

      v_line_id := NULLIF(v_line->>'id', '')::bigint;
      IF v_line_id IS NOT NULL THEN
        UPDATE receive_order_items SET
          product_id      = v_pid,
          product_name    = v_name,
          quantity        = v_qty,
          unit_price      = v_price,
          discount1_value = COALESCE((v_line->>'discount1_value')::numeric, 0),
          discount1_type  = v_line->>'discount1_type',
          discount2_value = COALESCE((v_line->>'discount2_value')::numeric, 0),
          discount2_type  = v_line->>'discount2_type'
         WHERE id = v_line_id AND receive_order_id = p_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'รายการ id % ไม่ได้อยู่ในบิลนี้', v_line_id USING ERRCODE = '22023';
        END IF;
      ELSE
        INSERT INTO receive_order_items (
          receive_order_id, product_id, product_name, quantity, unit, unit_price,
          discount1_value, discount1_type, discount2_value, discount2_type)
        VALUES (
          p_id, v_pid, v_name, v_qty, COALESCE(v_line->>'unit', 'เรือน'), v_price,
          COALESCE((v_line->>'discount1_value')::numeric, 0), v_line->>'discount1_type',
          COALESCE((v_line->>'discount2_value')::numeric, 0), v_line->>'discount2_type')
        RETURNING id INTO v_line_id;
      END IF;
      v_keep_ids := array_append(v_keep_ids, v_line_id);
    END LOOP;

    DELETE FROM receive_order_items
     WHERE receive_order_id = p_id AND NOT (id = ANY (v_keep_ids));

    -- Stock: apply the per-product difference.
    FOR v_rec IN
      WITH new_qty AS (
        SELECT product_id, sum(quantity)::int AS qty
          FROM receive_order_items WHERE receive_order_id = p_id AND product_id IS NOT NULL
         GROUP BY product_id
      ), old_qty AS (
        SELECT key::bigint AS product_id, value::int AS qty FROM jsonb_each_text(v_old_qty)
      )
      SELECT COALESCE(n.product_id, o.product_id) AS product_id,
             COALESCE(n.qty, 0) - COALESCE(o.qty, 0) AS delta
        FROM new_qty n FULL OUTER JOIN old_qty o ON o.product_id = n.product_id
       ORDER BY 1   -- stable lock order across concurrent edits
    LOOP
      CONTINUE WHEN v_rec.delta = 0;
      SELECT current_stock, name INTO v_stock, v_name
        FROM products WHERE id = v_rec.product_id FOR UPDATE;
      CONTINUE WHEN NOT FOUND;
      IF COALESCE(v_stock, 0) + v_rec.delta < 0 THEN
        RAISE EXCEPTION 'ลดจำนวน "%" ไม่ได้: สต็อกเหลือ % แต่ต้องหักออก % (สินค้าถูกขายไปแล้ว)',
          v_name, COALESCE(v_stock, 0), -v_rec.delta USING ERRCODE = '22023';
      END IF;
      PERFORM public.adjust_stock(
        p_id        => v_rec.product_id,
        qty_delta   => v_rec.delta,
        p_reason    => 'receive_edit',
        p_ref_table => 'receive_orders',
        p_ref_id    => p_id
      );
      v_deltas := v_deltas || jsonb_build_object('product_id', v_rec.product_id, 'delta', v_rec.delta);
    END LOOP;

    -- Totals (discount-aware). unit_price is stored VAT-inclusive, so the
    -- VAT portion is carved out of the gross sum.
    SELECT COALESCE(sum(public.receive_line_total(
             unit_price, quantity, discount1_value, discount1_type, discount2_value, discount2_type)), 0)
      INTO v_sum
      FROM receive_order_items WHERE receive_order_id = p_id;
    UPDATE receive_orders SET
      total_value = round(v_sum, 2),
      vat_amount  = CASE WHEN COALESCE(vat_rate, 0) > 0
                         THEN round(v_sum * vat_rate / (100 + vat_rate), 2) ELSE 0 END
     WHERE id = p_id;
  END IF;

  -- Snapshot after + no-op detection.
  SELECT * INTO v_ro FROM receive_orders WHERE id = p_id;
  SELECT jsonb_build_object(
           'header', to_jsonb(v_ro),
           'lines', COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb))
    INTO v_after
    FROM receive_order_items i WHERE i.receive_order_id = p_id;

  v_changed := (v_before->'lines') IS DISTINCT FROM (v_after->'lines')
            OR (v_before->'header') - 'updated_at' IS DISTINCT FROM (v_after->'header') - 'updated_at';

  IF v_changed THEN
    UPDATE receive_orders SET updated_at = now() WHERE id = p_id;
    INSERT INTO receive_order_edits (
      receive_order_id, edited_by, edited_by_email, before, after, stock_deltas, reason)
    VALUES (
      p_id, auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()),
      v_before, v_after, v_deltas, NULLIF(trim(COALESCE(p_reason, '')), ''));
  END IF;

  RETURN jsonb_build_object(
    'receive_order_id', p_id,
    'changed', v_changed,
    'stock_deltas', v_deltas,
    'total_value', v_ro.total_value,
    'vat_amount', v_ro.vat_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.edit_receive_order(bigint, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_receive_order(bigint, jsonb, jsonb, text) TO authenticated;
