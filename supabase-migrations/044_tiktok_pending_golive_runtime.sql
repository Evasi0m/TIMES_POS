-- 044_tiktok_pending_golive_runtime.sql
-- Enforce POS confirm go-live at runtime (not just one-time migrations).
-- Cutoff: 2026-06-07 13:00 Asia/Bangkok — only orders from this instant onward
-- enter the pending confirmation queue. Older TikTok API rows are legacy
-- duplicates (cashiers keyed them manually at POS) and must never appear in
-- "Order TikTok รอยืนยัน" or be importable as pending.

-- ====================================================================
-- 1. import_tiktok_sale_order — pre-cutoff → voided, post-cutoff → pending
-- ====================================================================
CREATE OR REPLACE FUNCTION public.import_tiktok_sale_order(
  p_header jsonb,
  p_items  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff     constant timestamptz := '2026-06-07 13:00:00+07';
  v_tiktok_id  text;
  v_order_id   bigint;
  v_order_row  sale_orders%ROWTYPE;
  v_sale_date  timestamptz;
  v_status     text;
  v_db_status  text;
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
      tiktok_order_status   = COALESCE(p_header->>'tiktok_order_status', tiktok_order_status),
      tiktok_synced_at      = now(),
      tiktok_payment_method = COALESCE(NULLIF(p_header->>'tiktok_payment_method', ''), tiktok_payment_method),
      notes                 = COALESCE(NULLIF(p_header->>'notes', ''), notes),
      updated_at            = now()
    WHERE id = v_order_id
    RETURNING * INTO v_order_row;

    PERFORM public.upsert_tiktok_order_fulfillment(v_tiktok_id, p_header, p_items);
    SELECT * INTO v_order_row FROM sale_orders WHERE id = v_order_id;
    RETURN to_jsonb(v_order_row);
  END IF;

  v_sale_date := COALESCE((p_header->>'sale_date')::timestamptz, now());
  v_status := COALESCE(p_header->>'tiktok_order_status', 'imported');
  v_db_status := CASE WHEN v_sale_date >= v_cutoff THEN 'pending' ELSE 'voided' END;

  INSERT INTO sale_orders (
    sale_date, channel, payment_method, tiktok_payment_method,
    status,
    discount_value, discount_type,
    subtotal, total_after_discount, grand_total,
    vat_rate, vat_amount, price_includes_vat,
    buyer_name, buyer_tax_id, buyer_address, buyer_branch,
    notes, net_received, net_received_pending,
    tiktok_order_id, tiktok_order_status, tiktok_synced_at,
    shipping_recipient_name, shipping_phone, shipping_address, shipping_postal_code,
    tiktok_package_ids, tracking_number, tiktok_shipping_type,
    voided_at, void_reason
  )
  SELECT
    v_sale_date,
    'tiktok',
    COALESCE(NULLIF(p_header->>'payment_method', ''), 'transfer'),
    NULLIF(p_header->>'tiktok_payment_method', ''),
    v_db_status,
    COALESCE((p_header->>'discount_value')::numeric, 0),
    COALESCE(p_header->>'discount_type', 'amount'),
    COALESCE((p_header->>'subtotal')::numeric, 0),
    COALESCE((p_header->>'total_after_discount')::numeric, 0),
    COALESCE((p_header->>'grand_total')::numeric, 0),
    COALESCE((p_header->>'vat_rate')::numeric, 7),
    COALESCE((p_header->>'vat_amount')::numeric, 0),
    COALESCE((p_header->>'price_includes_vat')::boolean, true),
    NULLIF(p_header->>'buyer_name', ''),
    NULLIF(p_header->>'buyer_tax_id', ''),
    NULLIF(p_header->>'buyer_address', ''),
    NULLIF(p_header->>'buyer_branch', ''),
    NULLIF(p_header->>'notes', ''),
    NULL,
    false,
    v_tiktok_id,
    v_status,
    now(),
    NULLIF(p_header->>'shipping_recipient_name', ''),
    NULLIF(p_header->>'shipping_phone', ''),
    NULLIF(p_header->>'shipping_address', ''),
    NULLIF(p_header->>'shipping_postal_code', ''),
    CASE WHEN p_header ? 'tiktok_package_ids' THEN p_header->'tiktok_package_ids' ELSE NULL END,
    NULLIF(p_header->>'tracking_number', ''),
    NULLIF(p_header->>'tiktok_shipping_type', ''),
    CASE WHEN v_db_status = 'voided' THEN now() ELSE NULL END,
    CASE WHEN v_db_status = 'voided'
      THEN 'Legacy TikTok API duplicate (pre POS go-live)'
      ELSE NULL END
  RETURNING id INTO v_order_id;

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

  SELECT * INTO v_order_row FROM sale_orders WHERE id = v_order_id;
  RETURN to_jsonb(v_order_row);
END;
$$;

REVOKE ALL ON FUNCTION public.import_tiktok_sale_order(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_tiktok_sale_order(jsonb, jsonb) TO service_role;

-- ====================================================================
-- 2. confirm_tiktok_sale_order — reject pre-cutoff queue entries
-- ====================================================================
CREATE OR REPLACE FUNCTION public.confirm_tiktok_sale_order(
  p_order_id     bigint,
  p_items        jsonb,
  p_net_received numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_cutoff     constant timestamptz := '2026-06-07 13:00:00+07';
  v_order      sale_orders%ROWTYPE;
  v_entry      jsonb;
  v_item_id    bigint;
  v_product_id bigint;
  v_unmatched  int;
  v_tax_no     text;
  r            record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be a logged-in user' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_order FROM sale_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;
  IF v_order.tiktok_order_id IS NULL THEN
    RAISE EXCEPTION 'รายการนี้ไม่ใช่ออเดอร์ TikTok' USING ERRCODE = '22023';
  END IF;
  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'ออเดอร์นี้ยืนยันไปแล้วหรือถูกยกเลิก' USING ERRCODE = '22023';
  END IF;
  IF v_order.sale_date < v_cutoff THEN
    RAISE EXCEPTION 'ออเดอร์ก่อน go-live (07/06/2026 13:00) ไม่อยู่ใน queue ยืนยัน — เป็น duplicate จาก TikTok API'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_item_id    := NULLIF(v_entry->>'item_id', '')::bigint;
      v_product_id := NULLIF(v_entry->>'product_id', '')::bigint;
      IF v_item_id IS NULL OR v_product_id IS NULL THEN
        CONTINUE;
      END IF;
      UPDATE sale_order_items soi
         SET product_id = v_product_id,
             cost_price = COALESCE(soi.cost_price, p.cost_price)
        FROM products p
       WHERE soi.id = v_item_id
         AND soi.sale_order_id = p_order_id
         AND p.id = v_product_id;
    END LOOP;
  END IF;

  SELECT count(*) INTO v_unmatched
    FROM sale_order_items
   WHERE sale_order_id = p_order_id AND product_id IS NULL;
  IF v_unmatched > 0 THEN
    RAISE EXCEPTION 'ยังจับคู่สินค้าไม่ครบ (%, รายการ)', v_unmatched USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT product_id, quantity FROM sale_order_items
     WHERE sale_order_id = p_order_id AND product_id IS NOT NULL
  LOOP
    PERFORM public.adjust_stock(
      p_id        => r.product_id,
      qty_delta   => -(r.quantity)::integer,
      p_reason    => 'sale',
      p_ref_table => 'sale_orders',
      p_ref_id    => p_order_id
    );
  END LOOP;

  IF v_order.tax_invoice_no IS NULL THEN
    v_tax_no := public.next_tax_invoice_no(v_order.sale_date);
  END IF;

  UPDATE sale_orders SET
    status               = 'active',
    net_received         = CASE WHEN p_net_received IS NOT NULL THEN round(p_net_received, 2) ELSE net_received END,
    net_received_pending = false,
    tax_invoice_no       = COALESCE(tax_invoice_no, v_tax_no),
    tax_invoice_issued_at = COALESCE(tax_invoice_issued_at, now()),
    confirmed_at         = now(),
    confirmed_by         = auth.uid(),
    updated_at           = now()
  WHERE id = p_order_id;

  INSERT INTO public.tiktok_product_mappings (tiktok_sku_id, product_id, seller_sku, tiktok_product_name, updated_at)
  SELECT soi.tiktok_sku_id, soi.product_id, soi.seller_sku,
         COALESCE(soi.sku_name, soi.product_name), now()
    FROM sale_order_items soi
   WHERE soi.sale_order_id = p_order_id
     AND soi.tiktok_sku_id IS NOT NULL
     AND soi.product_id IS NOT NULL
  ON CONFLICT (tiktok_sku_id) DO UPDATE SET
    product_id          = EXCLUDED.product_id,
    seller_sku          = EXCLUDED.seller_sku,
    tiktok_product_name = EXCLUDED.tiktok_product_name,
    updated_at          = now();

  RETURN (SELECT to_jsonb(so) FROM sale_orders so WHERE id = p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_tiktok_sale_order(bigint, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_tiktok_sale_order(bigint, jsonb, numeric) TO authenticated;

-- ====================================================================
-- 3. get_pending_tiktok_orders — only post-cutoff orders
-- ====================================================================
CREATE OR REPLACE FUNCTION public.get_pending_tiktok_orders(
  p_limit int DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_cutoff constant timestamptz := '2026-06-07 13:00:00+07';
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be a logged-in user' USING ERRCODE = '28000';
  END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    FROM (
      SELECT
        so.id, so.tiktok_order_id, so.sale_date, so.grand_total,
        so.payment_method, so.tiktok_payment_method, so.tiktok_order_status,
        so.buyer_name, so.buyer_address, so.buyer_tax_id,
        so.shipping_recipient_name,
        (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', soi.id,
            'product_id', soi.product_id,
            'product_name', soi.product_name,
            'seller_sku', soi.seller_sku,
            'sku_name', soi.sku_name,
            'sku_image_url', soi.sku_image_url,
            'tiktok_sku_id', soi.tiktok_sku_id,
            'quantity', soi.quantity,
            'unit_price', soi.unit_price
          ) ORDER BY soi.id), '[]'::jsonb)
          FROM sale_order_items soi
          WHERE soi.sale_order_id = so.id
        ) AS items
      FROM sale_orders so
      WHERE so.status = 'pending'
        AND so.tiktok_order_id IS NOT NULL
        AND so.sale_date >= v_cutoff
      ORDER BY so.sale_date DESC
      LIMIT GREATEST(1, LEAST(p_limit, 300))
    ) t
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_tiktok_orders(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_tiktok_orders(int) TO authenticated;

-- ====================================================================
-- 4. Cleanup — void any pre-cutoff rows still stuck in pending
-- ====================================================================
UPDATE public.sale_orders
   SET status      = 'voided',
       voided_at   = now(),
       void_reason = 'Legacy TikTok API duplicate (pre POS go-live)',
       updated_at  = now()
 WHERE tiktok_order_id IS NOT NULL
   AND status = 'pending'
   AND confirmed_at IS NULL
   AND sale_date < '2026-06-07 13:00:00+07'::timestamptz;
