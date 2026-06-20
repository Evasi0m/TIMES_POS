-- 076: Prevent duplicate TikTok line items (resync bug) + repair affected orders.
--
-- Bug: resync_tiktok_pending_order could INSERT duplicate rows sharing the same
-- tiktok_line_id; confirm then deducted stock once per row (e.g. 7 watches -> 14).
-- Fix: dedupe helper, hardened resync matching, aggregate stock on confirm,
-- unique index, one-time repair with stock restore on active orders.

-- ====================================================================
-- 1. dedupe_tiktok_order_lines
-- ====================================================================
CREATE OR REPLACE FUNCTION public.dedupe_tiktok_order_lines(
  p_order_id       bigint,
  p_restore_stock  boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status  text;
  r         record;
  v_deleted int := 0;
  v_stock   jsonb := '[]'::jsonb;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('order_id', NULL, 'deleted', 0);
  END IF;

  SELECT status INTO v_status FROM sale_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'deleted', 0, 'error', 'not_found');
  END IF;

  FOR r IN
    SELECT soi.id,
           soi.product_id,
           soi.quantity,
           soi.tiktok_line_id
      FROM sale_order_items soi
     WHERE soi.sale_order_id = p_order_id
       AND soi.tiktok_line_id IS NOT NULL
       AND soi.id NOT IN (
         SELECT DISTINCT ON (tiktok_line_id) id
           FROM sale_order_items
          WHERE sale_order_id = p_order_id
            AND tiktok_line_id IS NOT NULL
          ORDER BY tiktok_line_id, (product_id IS NULL), id ASC
       )
  LOOP
    IF p_restore_stock
       AND v_status = 'active'
       AND r.product_id IS NOT NULL
       AND COALESCE(r.quantity, 0) <> 0 THEN
      PERFORM public.adjust_stock(
        p_id        => r.product_id,
        qty_delta   => r.quantity,
        p_reason    => 'sale_edit',
        p_ref_table => 'sale_orders',
        p_ref_id    => p_order_id
      );
      v_stock := v_stock || jsonb_build_array(jsonb_build_object(
        'product_id', r.product_id,
        'qty_restored', r.quantity,
        'line_id', r.tiktok_line_id,
        'item_id', r.id
      ));
    END IF;

    DELETE FROM sale_order_items WHERE id = r.id;
    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'status', v_status,
    'deleted', v_deleted,
    'stock_restored', v_stock
  );
END;
$$;

REVOKE ALL ON FUNCTION public.dedupe_tiktok_order_lines(bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dedupe_tiktok_order_lines(bigint, boolean) TO service_role;

-- ====================================================================
-- 2. resync_tiktok_pending_order
-- ====================================================================
CREATE OR REPLACE FUNCTION public.resync_tiktok_pending_order(
  p_order_id bigint,
  p_header   jsonb,
  p_items    jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status    text;
  v_item      jsonb;
  v_line_id   text;
  v_sku_id    text;
  v_existing  bigint;
  v_line_ids  text[] := '{}';
  v_used_ids  bigint[] := '{}';
BEGIN
  SELECT status INTO v_status FROM sale_orders WHERE id = p_order_id;
  IF v_status IS DISTINCT FROM 'pending' THEN RETURN; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN;
  END IF;

  PERFORM public.dedupe_tiktok_order_lines(p_order_id, false);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_id := NULLIF(v_item->>'tiktok_line_id', '');
    v_sku_id  := NULLIF(v_item->>'tiktok_sku_id', '');
    v_existing := NULL;

    IF v_line_id IS NOT NULL THEN
      SELECT id INTO v_existing
        FROM sale_order_items
       WHERE sale_order_id = p_order_id
         AND tiktok_line_id = v_line_id
         AND NOT (id = ANY (v_used_ids))
       ORDER BY id ASC
       LIMIT 1;
    END IF;

    IF v_existing IS NULL AND v_sku_id IS NOT NULL THEN
      SELECT id INTO v_existing
        FROM sale_order_items
       WHERE sale_order_id = p_order_id
         AND tiktok_sku_id = v_sku_id
         AND tiktok_line_id IS NULL
         AND NOT (id = ANY (v_used_ids))
       ORDER BY id ASC
       LIMIT 1;
    END IF;

    IF v_existing IS NOT NULL THEN
      UPDATE sale_order_items SET
        quantity       = COALESCE((v_item->>'quantity')::integer, quantity),
        unit_price     = COALESCE((v_item->>'unit_price')::numeric, unit_price),
        product_name   = COALESCE(NULLIF(v_item->>'product_name', ''), product_name),
        seller_sku     = COALESCE(NULLIF(v_item->>'seller_sku', ''), seller_sku),
        sku_name       = COALESCE(NULLIF(v_item->>'sku_name', ''), sku_name),
        sku_image_url  = COALESCE(NULLIF(v_item->>'sku_image_url', ''), sku_image_url),
        tiktok_sku_id  = COALESCE(NULLIF(v_item->>'tiktok_sku_id', ''), tiktok_sku_id),
        tiktok_line_id = COALESCE(NULLIF(v_item->>'tiktok_line_id', ''), tiktok_line_id)
      WHERE id = v_existing;
      v_used_ids := array_append(v_used_ids, v_existing);
    ELSE
      INSERT INTO sale_order_items (
        sale_order_id, product_id, product_name, quantity, unit_price,
        discount1_value, discount1_type, discount2_value, discount2_type,
        cost_price, tiktok_sku_id, seller_sku, sku_name, sku_image_url, tiktok_line_id
      )
      SELECT
        p_order_id, ids.pid, v_item->>'product_name',
        COALESCE((v_item->>'quantity')::integer, 0),
        COALESCE((v_item->>'unit_price')::numeric, 0),
        0, 'amount', 0, 'amount',
        p.cost_price, v_sku_id, NULLIF(v_item->>'seller_sku', ''),
        NULLIF(v_item->>'sku_name', ''), NULLIF(v_item->>'sku_image_url', ''), v_line_id
      FROM (SELECT NULLIF(v_item->>'product_id', '')::bigint AS pid) ids
      LEFT JOIN products p ON p.id = ids.pid
      RETURNING id INTO v_existing;
      v_used_ids := array_append(v_used_ids, v_existing);
    END IF;

    IF v_line_id IS NOT NULL THEN
      v_line_ids := array_append(v_line_ids, v_line_id);
    END IF;
  END LOOP;

  IF array_length(v_line_ids, 1) IS NOT NULL THEN
    DELETE FROM sale_order_items
     WHERE sale_order_id = p_order_id
       AND tiktok_line_id IS NOT NULL
       AND NOT (tiktok_line_id = ANY (v_line_ids));
  END IF;

  UPDATE sale_orders SET
    subtotal             = COALESCE((p_header->>'subtotal')::numeric, subtotal),
    total_after_discount = COALESCE((p_header->>'total_after_discount')::numeric, total_after_discount),
    grand_total          = COALESCE((p_header->>'grand_total')::numeric, grand_total),
    vat_amount           = COALESCE((p_header->>'vat_amount')::numeric, vat_amount),
    updated_at           = now()
  WHERE id = p_order_id AND status = 'pending';

  PERFORM public.dedupe_tiktok_order_lines(p_order_id, false);
END;
$$;

REVOKE ALL ON FUNCTION public.resync_tiktok_pending_order(bigint, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resync_tiktok_pending_order(bigint, jsonb, jsonb) TO service_role;

-- ====================================================================
-- 3. confirm_tiktok_sale_order (aggregate stock by product_id)
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
  v_substitute boolean;
  v_sub_note   text;
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

  PERFORM public.dedupe_tiktok_order_lines(p_order_id, false);

  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_item_id    := NULLIF(v_entry->>'item_id', '')::bigint;
      v_product_id := NULLIF(v_entry->>'product_id', '')::bigint;
      v_substitute := COALESCE((v_entry->>'substitute')::boolean, false);
      v_sub_note   := NULLIF(trim(v_entry->>'substitution_note'), '');
      IF v_item_id IS NULL OR v_product_id IS NULL THEN
        CONTINUE;
      END IF;
      UPDATE sale_order_items soi
         SET product_id            = v_product_id,
             product_name          = p.name,
             cost_price            = COALESCE(soi.cost_price, p.cost_price),
             is_sku_substitution   = v_substitute,
             substitution_note     = CASE WHEN v_substitute THEN v_sub_note ELSE NULL END,
             fulfilled_product_id  = CASE WHEN v_substitute THEN v_product_id ELSE NULL END
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
    SELECT product_id, sum(quantity)::integer AS quantity
      FROM sale_order_items
     WHERE sale_order_id = p_order_id
       AND product_id IS NOT NULL
     GROUP BY product_id
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
    status                = 'active',
    net_received          = CASE
                              WHEN p_net_received IS NOT NULL THEN round(p_net_received, 2)
                              ELSE NULL
                            END,
    net_received_pending  = (p_net_received IS NULL),
    tax_invoice_no        = COALESCE(tax_invoice_no, v_tax_no),
    tax_invoice_issued_at = COALESCE(tax_invoice_issued_at, now()),
    confirmed_at          = now(),
    confirmed_by          = auth.uid(),
    updated_at            = now()
  WHERE id = p_order_id;

  -- Skip mapping upsert for substituted lines (one-off fulfillment, not permanent SKU map).
  -- DISTINCT ON prevents duplicate tiktok_sku_id rows in one INSERT ON CONFLICT.
  INSERT INTO public.tiktok_product_mappings (
    tiktok_sku_id, product_id, seller_sku, tiktok_product_name,
    tiktok_product_id, warehouse_id, sync_enabled, updated_at
  )
  SELECT
    d.tiktok_sku_id,
    d.product_id,
    d.seller_sku,
    d.tiktok_product_name,
    d.tiktok_product_id,
    d.warehouse_id,
    true,
    now()
  FROM (
    SELECT DISTINCT ON (soi.tiktok_sku_id)
      soi.tiktok_sku_id,
      soi.product_id,
      soi.seller_sku,
      COALESCE(soi.sku_name, soi.product_name) AS tiktok_product_name,
      COALESCE(pi.tiktok_product_id, em.tiktok_product_id) AS tiktok_product_id,
      COALESCE(pi.warehouse_id, em.warehouse_id) AS warehouse_id
    FROM sale_order_items soi
    LEFT JOIN LATERAL (
      SELECT
        NULLIF(trim(elem->>'tiktok_product_id'), '') AS tiktok_product_id,
        NULLIF(trim(elem->>'warehouse_id'), '') AS warehouse_id,
        COALESCE((elem->>'substitute')::boolean, false) AS substitute
      FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) elem
      WHERE NULLIF(elem->>'item_id', '')::bigint = soi.id
      LIMIT 1
    ) pi ON true
    LEFT JOIN public.tiktok_product_mappings em
      ON em.tiktok_sku_id = soi.tiktok_sku_id
    WHERE soi.sale_order_id = p_order_id
      AND soi.tiktok_sku_id IS NOT NULL
      AND soi.product_id IS NOT NULL
      AND COALESCE(pi.substitute, soi.is_sku_substitution, false) = false
    ORDER BY soi.tiktok_sku_id, soi.id ASC
  ) d
  ON CONFLICT (tiktok_sku_id) DO UPDATE SET
    product_id          = EXCLUDED.product_id,
    seller_sku          = EXCLUDED.seller_sku,
    tiktok_product_name = EXCLUDED.tiktok_product_name,
    tiktok_product_id   = COALESCE(EXCLUDED.tiktok_product_id, tiktok_product_mappings.tiktok_product_id),
    warehouse_id        = COALESCE(EXCLUDED.warehouse_id, tiktok_product_mappings.warehouse_id),
    sync_enabled        = true,
    updated_at          = now();

  FOR r IN
    SELECT DISTINCT product_id, sku_image_url
      FROM sale_order_items
     WHERE sale_order_id = p_order_id
       AND product_id IS NOT NULL
       AND NULLIF(trim(sku_image_url), '') IS NOT NULL
  LOOP
    PERFORM public.apply_tiktok_product_image(r.product_id, r.sku_image_url);
  END LOOP;

  RETURN (SELECT to_jsonb(so) FROM sale_orders so WHERE id = p_order_id);
END;
$$;

-- ====================================================================
-- 4. import_tiktok_sale_order
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
    IF v_order_row.status = 'pending' THEN
      PERFORM public.resync_tiktok_pending_order(v_order_id, p_header, p_items);
    END IF;
    PERFORM public.backfill_tiktok_order_lines_if_empty(v_order_id, p_items);
    PERFORM public.dedupe_tiktok_order_lines(v_order_id, false);
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

  PERFORM public.dedupe_tiktok_order_lines(v_order_id, false);
  PERFORM public.sync_tiktok_order_line_images(v_order_id);

  SELECT * INTO v_order_row FROM sale_orders WHERE id = v_order_id;
  RETURN to_jsonb(v_order_row);
END;
$$;

REVOKE ALL ON FUNCTION public.import_tiktok_sale_order(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_tiktok_sale_order(jsonb, jsonb) TO service_role;

-- ====================================================================
-- 5. One-time repair + unique index
-- ====================================================================
DO $$
DECLARE
  r record;
  v_result jsonb;
BEGIN
  FOR r IN
    SELECT so.id, so.status
      FROM sale_orders so
      JOIN (
        SELECT sale_order_id
          FROM sale_order_items
         WHERE tiktok_line_id IS NOT NULL
         GROUP BY sale_order_id
        HAVING count(*) > count(DISTINCT tiktok_line_id)
      ) dup ON dup.sale_order_id = so.id
  LOOP
    v_result := public.dedupe_tiktok_order_lines(r.id, r.status = 'active');
    RAISE NOTICE 'dedupe order %: %', r.id, v_result;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS sale_order_items_tiktok_line_uidx
  ON public.sale_order_items (sale_order_id, tiktok_line_id)
  WHERE tiktok_line_id IS NOT NULL;
