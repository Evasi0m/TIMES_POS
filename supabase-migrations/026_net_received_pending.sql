-- 026_net_received_pending.sql
-- "ใส่ทีหลัง" (enter-later) flag for e-commerce sales.
--
-- When a TikTok/Shopee/Lazada sale is rung up, the actual money the shop
-- receives (net_received) is often unknown until the platform pays out. The
-- cashier can now defer it: the sale still completes (stock decremented,
-- status = active), but net_received stays NULL and net_received_pending = true.
-- Profit is treated as 0 until the real amount is entered, at which point
-- net_received is set and the flag flips back to false.

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS net_received_pending boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sale_orders.net_received_pending IS
  'true = e-commerce sale awaiting the real net_received ("ใส่ทีหลัง"). While true, '
  'net_received is NULL and profit is treated as 0. Cleared when the amount is entered.';

-- Partial index keeps the notification-bell count (pending, active bills) cheap.
CREATE INDEX IF NOT EXISTS idx_sale_orders_net_pending
  ON public.sale_orders (sale_date DESC)
  WHERE net_received_pending AND status = 'active';

-- Re-create the sale RPC to persist the new flag. Identical to migration 018
-- (v3) except for the added net_received_pending column in the header insert.
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be a logged-in user' USING ERRCODE = '28000';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;

  INSERT INTO sale_orders (
    sale_date, channel, payment_method,
    discount_value, discount_type,
    subtotal, total_after_discount, grand_total,
    vat_rate, vat_amount, price_includes_vat,
    tax_invoice_no, buyer_name, buyer_tax_id, buyer_address,
    notes, net_received, net_received_pending
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
    COALESCE((p_header->>'net_received_pending')::boolean, false)
  RETURNING id INTO v_order_id;

  -- Items insert: cost_price is snapshotted via LEFT JOIN to products
  -- so legacy clients (no cost_price field) still get the right value.
  -- COALESCE order: explicit override → product table → NULL.
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
