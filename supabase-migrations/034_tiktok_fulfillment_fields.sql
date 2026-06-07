-- 034_tiktok_fulfillment_fields.sql — TikTok SKU images, shipping, fulfillment metadata

-- ── sale_order_items: TikTok line metadata ──────────────────────────────────
ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS tiktok_sku_id text,
  ADD COLUMN IF NOT EXISTS seller_sku text,
  ADD COLUMN IF NOT EXISTS sku_name text,
  ADD COLUMN IF NOT EXISTS sku_image_url text,
  ADD COLUMN IF NOT EXISTS tiktok_line_id text;

-- ── sale_orders: shipping + fulfillment ─────────────────────────────────────
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS shipping_recipient_name text,
  ADD COLUMN IF NOT EXISTS shipping_phone text,
  ADD COLUMN IF NOT EXISTS shipping_address text,
  ADD COLUMN IF NOT EXISTS shipping_postal_code text,
  ADD COLUMN IF NOT EXISTS tiktok_package_ids jsonb,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS tiktok_shipping_type text;

-- ── upsert TikTok metadata on existing orders (no stock/VAT changes) ────────
CREATE OR REPLACE FUNCTION public.upsert_tiktok_order_fulfillment(
  p_tiktok_order_id text,
  p_header jsonb,
  p_items jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id bigint;
  v_row      sale_orders%ROWTYPE;
  v_item     jsonb;
  v_idx      int := 0;
  v_item_id  bigint;
BEGIN
  SELECT id INTO v_order_id FROM sale_orders WHERE tiktok_order_id = p_tiktok_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TikTok order % not found', p_tiktok_order_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE sale_orders SET
    tiktok_order_status     = COALESCE(NULLIF(p_header->>'tiktok_order_status', ''), tiktok_order_status),
    tiktok_synced_at        = now(),
    shipping_recipient_name = COALESCE(NULLIF(p_header->>'shipping_recipient_name', ''), shipping_recipient_name),
    shipping_phone          = COALESCE(NULLIF(p_header->>'shipping_phone', ''), shipping_phone),
    shipping_address        = COALESCE(NULLIF(p_header->>'shipping_address', ''), shipping_address),
    shipping_postal_code    = COALESCE(NULLIF(p_header->>'shipping_postal_code', ''), shipping_postal_code),
    tiktok_package_ids      = COALESCE(p_header->'tiktok_package_ids', tiktok_package_ids),
    tracking_number         = COALESCE(NULLIF(p_header->>'tracking_number', ''), tracking_number),
    tiktok_shipping_type    = COALESCE(NULLIF(p_header->>'tiktok_shipping_type', ''), tiktok_shipping_type),
    buyer_name              = COALESCE(buyer_name, NULLIF(p_header->>'buyer_name', '')),
    buyer_address           = COALESCE(buyer_address, NULLIF(p_header->>'buyer_address', '')),
    updated_at              = now()
  WHERE id = v_order_id;

  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_idx := v_idx + 1;
      SELECT soi.id INTO v_item_id
        FROM sale_order_items soi
       WHERE soi.sale_order_id = v_order_id
         AND (
           (NULLIF(v_item->>'tiktok_line_id', '') IS NOT NULL AND soi.tiktok_line_id = v_item->>'tiktok_line_id')
           OR (NULLIF(v_item->>'tiktok_sku_id', '') IS NOT NULL AND soi.tiktok_sku_id = v_item->>'tiktok_sku_id')
         )
       LIMIT 1;

      IF v_item_id IS NULL THEN
        SELECT soi.id INTO v_item_id
          FROM (
            SELECT id, row_number() OVER (ORDER BY id) AS rn
              FROM sale_order_items
             WHERE sale_order_id = v_order_id
          ) soi
         WHERE soi.rn = v_idx;
      END IF;

      IF v_item_id IS NOT NULL THEN
        UPDATE sale_order_items SET
          product_name   = COALESCE(NULLIF(v_item->>'product_name', ''), product_name),
          tiktok_sku_id  = COALESCE(NULLIF(v_item->>'tiktok_sku_id', ''), tiktok_sku_id),
          seller_sku     = COALESCE(NULLIF(v_item->>'seller_sku', ''), seller_sku),
          sku_name       = COALESCE(NULLIF(v_item->>'sku_name', ''), sku_name),
          sku_image_url  = COALESCE(NULLIF(v_item->>'sku_image_url', ''), sku_image_url),
          tiktok_line_id = COALESCE(NULLIF(v_item->>'tiktok_line_id', ''), tiktok_line_id)
        WHERE id = v_item_id;
      END IF;
    END LOOP;
  END IF;

  SELECT * INTO v_row FROM sale_orders WHERE id = v_order_id;
  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_tiktok_order_fulfillment(text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_tiktok_order_fulfillment(text, jsonb, jsonb) TO service_role;

-- ── Extend import_tiktok_sale_order INSERT with new columns ─────────────────
CREATE OR REPLACE FUNCTION public.import_tiktok_sale_order(
  p_header jsonb,
  p_items  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tiktok_id  text;
  v_order_id   bigint;
  v_order_row  sale_orders%ROWTYPE;
  v_item       jsonb;
  v_tax_no     text;
  v_sale_date  timestamptz;
  v_status     text;
BEGIN
  v_tiktok_id := NULLIF(p_header->>'tiktok_order_id', '');
  IF v_tiktok_id IS NULL THEN
    RAISE EXCEPTION 'tiktok_order_id is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_order_id FROM sale_orders WHERE tiktok_order_id = v_tiktok_id;
  IF FOUND THEN
    UPDATE sale_orders SET
      tiktok_order_status = COALESCE(p_header->>'tiktok_order_status', tiktok_order_status),
      tiktok_synced_at    = now(),
      payment_method      = COALESCE(NULLIF(p_header->>'payment_method', ''), payment_method),
      notes               = COALESCE(NULLIF(p_header->>'notes', ''), notes),
      updated_at          = now()
    WHERE id = v_order_id
    RETURNING * INTO v_order_row;

    PERFORM public.upsert_tiktok_order_fulfillment(v_tiktok_id, p_header, p_items);
    SELECT * INTO v_order_row FROM sale_orders WHERE id = v_order_id;
    RETURN to_jsonb(v_order_row);
  END IF;

  v_sale_date := COALESCE((p_header->>'sale_date')::timestamptz, now());
  v_status := COALESCE(p_header->>'tiktok_order_status', 'imported');

  INSERT INTO sale_orders (
    sale_date, channel, payment_method,
    discount_value, discount_type,
    subtotal, total_after_discount, grand_total,
    vat_rate, vat_amount, price_includes_vat,
    tax_invoice_no, buyer_name, buyer_tax_id, buyer_address, buyer_branch,
    notes, net_received, net_received_pending,
    tiktok_order_id, tiktok_order_status, tiktok_synced_at,
    shipping_recipient_name, shipping_phone, shipping_address, shipping_postal_code,
    tiktok_package_ids, tracking_number, tiktok_shipping_type
  )
  SELECT
    v_sale_date,
    'tiktok',
    COALESCE(NULLIF(p_header->>'payment_method', ''), 'transfer'),
    COALESCE((p_header->>'discount_value')::numeric, 0),
    COALESCE(p_header->>'discount_type', 'amount'),
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
    NULLIF(p_header->>'buyer_branch', ''),
    NULLIF(p_header->>'notes', ''),
    NULLIF(p_header->>'net_received', '')::numeric,
    COALESCE((p_header->>'net_received_pending')::boolean, true),
    v_tiktok_id,
    v_status,
    now(),
    NULLIF(p_header->>'shipping_recipient_name', ''),
    NULLIF(p_header->>'shipping_phone', ''),
    NULLIF(p_header->>'shipping_address', ''),
    NULLIF(p_header->>'shipping_postal_code', ''),
    CASE WHEN p_header ? 'tiktok_package_ids' THEN p_header->'tiktok_package_ids' ELSE NULL END,
    NULLIF(p_header->>'tracking_number', ''),
    NULLIF(p_header->>'tiktok_shipping_type', '')
  RETURNING id INTO v_order_id;

  IF NULLIF(p_header->>'tax_invoice_no', '') IS NULL THEN
    v_tax_no := public.next_tax_invoice_no(v_sale_date);
    UPDATE sale_orders
       SET tax_invoice_no = v_tax_no, tax_invoice_issued_at = now()
     WHERE id = v_order_id;
  END IF;

  INSERT INTO sale_order_items (
    sale_order_id, product_id, product_name,
    quantity, unit_price, display_unit_price,
    discount1_value, discount1_type,
    discount2_value, discount2_type,
    cost_price,
    tiktok_sku_id, seller_sku, sku_name, sku_image_url, tiktok_line_id
  )
  SELECT
    v_order_id, pid, item->>'product_name',
    COALESCE((item->>'quantity')::integer, 0),
    COALESCE((item->>'unit_price')::numeric, 0),
    NULLIF(item->>'display_unit_price','')::numeric,
    COALESCE((item->>'discount1_value')::numeric, 0),
    item->>'discount1_type',
    COALESCE((item->>'discount2_value')::numeric, 0),
    item->>'discount2_type',
    COALESCE(NULLIF(item->>'cost_price','')::numeric, p.cost_price),
    NULLIF(item->>'tiktok_sku_id', ''),
    NULLIF(item->>'seller_sku', ''),
    NULLIF(item->>'sku_name', ''),
    NULLIF(item->>'sku_image_url', ''),
    NULLIF(item->>'tiktok_line_id', '')
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

REVOKE ALL ON FUNCTION public.import_tiktok_sale_order(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_tiktok_sale_order(jsonb, jsonb) TO service_role;
