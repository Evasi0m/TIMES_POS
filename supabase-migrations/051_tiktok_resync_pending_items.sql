-- 051_tiktok_resync_pending_items.sql
-- Re-sync line items for PENDING TikTok orders on every import/poll/webhook.
--
-- Gap: import_tiktok_sale_order's re-sync path only refreshed order metadata
-- (status, shipping) and item metadata (names/images) — never quantity, unit
-- price, or the set of lines. So when a buyer edited the order on TikTok
-- (changed qty, added/removed an item) before the cashier confirmed it, the POS
-- confirm screen still showed the stale original lines and total.
--
-- Fix: resync_tiktok_pending_order() rebuilds the lines of a still-'pending'
-- order to match TikTok — updating qty/price, inserting new lines, removing
-- dropped ones (matched by tiktok_line_id, then tiktok_sku_id), and refreshing
-- the money columns from the header. Confirmed ('active') and voided orders are
-- never touched: stock was already deducted and a tax-invoice number issued, so
-- their lines are frozen. product_id matches a cashier already picked are
-- preserved. The function is idempotent — unchanged orders produce no writes.

-- ====================================================================
-- 1. resync_tiktok_pending_order — line + total refresh (pending only)
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
  v_status   text;
  v_item     jsonb;
  v_line_id  text;
  v_sku_id   text;
  v_existing bigint;
  v_line_ids text[] := '{}';
BEGIN
  SELECT status INTO v_status FROM sale_orders WHERE id = p_order_id;
  IF v_status IS DISTINCT FROM 'pending' THEN RETURN; END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN; -- never wipe lines on an empty/garbled payload
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_id := NULLIF(v_item->>'tiktok_line_id', '');
    v_sku_id  := NULLIF(v_item->>'tiktok_sku_id', '');
    v_existing := NULL;

    -- Match an existing line: prefer the stable TikTok line id, then sku id.
    IF v_line_id IS NOT NULL THEN
      SELECT id INTO v_existing FROM sale_order_items
       WHERE sale_order_id = p_order_id AND tiktok_line_id = v_line_id
       LIMIT 1;
    END IF;
    IF v_existing IS NULL AND v_sku_id IS NOT NULL THEN
      SELECT id INTO v_existing FROM sale_order_items
       WHERE sale_order_id = p_order_id
         AND tiktok_sku_id = v_sku_id
         AND tiktok_line_id IS NULL
       LIMIT 1;
    END IF;

    IF v_existing IS NOT NULL THEN
      -- Refresh qty/price/meta. Keep product_id (cashier's match) untouched.
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
    ELSE
      -- New line the buyer added after the original import.
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
      LEFT JOIN products p ON p.id = ids.pid;
    END IF;

    IF v_line_id IS NOT NULL THEN
      v_line_ids := array_append(v_line_ids, v_line_id);
    END IF;
  END LOOP;

  -- Remove lines the buyer dropped. Conservative: only delete lines that carry
  -- a tiktok_line_id absent from the incoming set, and only when the payload
  -- actually provided line ids (so a payload without line ids never deletes).
  IF array_length(v_line_ids, 1) IS NOT NULL THEN
    DELETE FROM sale_order_items
     WHERE sale_order_id = p_order_id
       AND tiktok_line_id IS NOT NULL
       AND NOT (tiktok_line_id = ANY (v_line_ids));
  END IF;

  -- Refresh the money columns from the (buyer-edited) header.
  UPDATE sale_orders SET
    subtotal             = COALESCE((p_header->>'subtotal')::numeric, subtotal),
    total_after_discount = COALESCE((p_header->>'total_after_discount')::numeric, total_after_discount),
    grand_total          = COALESCE((p_header->>'grand_total')::numeric, grand_total),
    vat_amount           = COALESCE((p_header->>'vat_amount')::numeric, vat_amount),
    updated_at           = now()
  WHERE id = p_order_id AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.resync_tiktok_pending_order(bigint, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resync_tiktok_pending_order(bigint, jsonb, jsonb) TO service_role;

-- ====================================================================
-- 2. import_tiktok_sale_order — call the resync on the re-import path
--    (identical to migration 044 except the pending-resync hook).
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
    -- NEW: keep a still-unconfirmed order's lines + total in sync with TikTok.
    IF v_order_row.status = 'pending' THEN
      PERFORM public.resync_tiktok_pending_order(v_order_id, p_header, p_items);
    END IF;
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
