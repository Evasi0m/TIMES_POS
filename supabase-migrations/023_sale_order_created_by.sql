-- 023_sale_order_created_by.sql
-- Store who originally created each sale bill. This is separate from
-- sale_order_edits (which records later corrections) so the bill detail
-- modal can show both: "บันทึกโดย" and "แก้ไขโดย" history.

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_email text;

CREATE INDEX IF NOT EXISTS idx_sale_orders_created_by
  ON public.sale_orders(created_by);

CREATE OR REPLACE FUNCTION public.create_sale_order_with_items(
  p_header jsonb,
  p_items  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_order_id   bigint;
  v_order_row  sale_orders%ROWTYPE;
  v_item       jsonb;
  v_uid        uuid;
  v_email      text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be a logged-in user' USING ERRCODE = '28000';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;

  INSERT INTO sale_orders (
    sale_date, channel, payment_method,
    discount_value, discount_type,
    subtotal, total_after_discount, grand_total,
    vat_rate, vat_amount, price_includes_vat,
    tax_invoice_no, buyer_name, buyer_tax_id, buyer_address,
    notes, net_received,
    created_by, created_by_email
  )
  SELECT
    COALESCE((p_header->>'sale_date')::timestamptz, now()),
    p_header->>'channel',
    p_header->>'payment_method',
    COALESCE((p_header->>'discount_value')::numeric, 0),
    p_header->>'discount_type',
    COALESCE((p_header->>'subtotal')::numeric, 0),
    COALESCE((p_header->>'total_after_discount')::numeric, 0),
    COALESCE((p_header->>'grand_total')::numeric, 0),
    COALESCE((p_header->>'vat_rate')::numeric, 7),
    COALESCE((p_header->>'vat_amount')::numeric, 0),
    COALESCE((p_header->>'price_includes_vat')::boolean, true),
    NULLIF(p_header->>'tax_invoice_no', ''),
    NULLIF(p_header->>'buyer_name', ''),
    NULLIF(p_header->>'buyer_tax_id', ''),
    NULLIF(p_header->>'buyer_address', ''),
    NULLIF(p_header->>'notes', ''),
    NULLIF(p_header->>'net_received', '')::numeric,
    v_uid,
    v_email
  RETURNING id INTO v_order_id;

  INSERT INTO sale_order_items (
    sale_order_id, product_id, product_name,
    quantity, unit_price, display_unit_price,
    discount1_value, discount1_type,
    discount2_value, discount2_type,
    cost_price
  )
  SELECT
    v_order_id,
    pid,
    item->>'product_name',
    COALESCE((item->>'quantity')::integer, 0),
    COALESCE((item->>'unit_price')::numeric, 0),
    NULLIF(item->>'display_unit_price','')::numeric,
    COALESCE((item->>'discount1_value')::numeric, 0),
    item->>'discount1_type',
    COALESCE((item->>'discount2_value')::numeric, 0),
    item->>'discount2_type',
    COALESCE(
      NULLIF(item->>'cost_price','')::numeric,
      p.cost_price
    )
  FROM jsonb_array_elements(p_items) AS item
  CROSS JOIN LATERAL (SELECT NULLIF(item->>'product_id','')::bigint AS pid) ids
  LEFT JOIN products p ON p.id = ids.pid;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NULLIF(v_item->>'product_id','') IS NOT NULL THEN
      PERFORM public.adjust_stock(
        p_id        => (v_item->>'product_id')::bigint,
        qty_delta   => -((v_item->>'quantity')::integer),
        p_reason    => 'sale',
        p_ref_table => 'sale_orders',
        p_ref_id    => v_order_id
      );
    END IF;
  END LOOP;

  SELECT * INTO v_order_row FROM sale_orders WHERE id = v_order_id;
  RETURN to_jsonb(v_order_row);
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_order_with_items(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sale_order_with_items(jsonb, jsonb) TO authenticated;
