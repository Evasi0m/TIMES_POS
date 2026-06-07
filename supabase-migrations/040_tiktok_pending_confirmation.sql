-- 040_tiktok_pending_confirmation.sql
-- TikTok orders now land as status='pending' (awaiting cashier confirmation)
-- instead of going straight to 'active'. They do NOT cut stock and do NOT get
-- a tax-invoice number at import time. A cashier reviews each order on the POS
-- "ขายสินค้า" page: matches every line item's SKU to a POS product and enters
-- the net received. confirm_tiktok_sale_order() then atomically deducts stock,
-- issues the tax-invoice number, records net_received, and flips the order to
-- 'active' so it flows into Sales History + Dashboard/P&L/VAT.
--
-- Why pending:
--   * Cashiers are used to ringing up sales manually; auto-deducting stock the
--     moment TikTok pushes an order confused inventory. Pending makes every
--     TikTok order an explicit human checkpoint, mirroring a normal checkout.
--   * Tax numbers are gap-free, so we only burn one once the sale is real.
--
-- Stock is cut EXACTLY once (at confirm). Import never cuts; the matching tools
-- (link/relink) skip stock while pending; void of a pending order never
-- restores stock because none was taken.

-- ====================================================================
-- 1. New columns + allow the new 'pending' status
-- ====================================================================
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS tiktok_payment_method text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid;

-- The base schema's status CHECK only allowed ('active','voided'); TikTok
-- orders now also use 'pending'. Drop + recreate so inserts/updates below pass.
ALTER TABLE public.sale_orders
  DROP CONSTRAINT IF EXISTS sale_orders_status_check;
ALTER TABLE public.sale_orders
  ADD CONSTRAINT sale_orders_status_check
  CHECK (status IN ('active', 'voided', 'pending'));

-- Fast count + listing of the pending-confirmation queue.
CREATE INDEX IF NOT EXISTS idx_sale_orders_tiktok_pending
  ON public.sale_orders (sale_date DESC)
  WHERE status = 'pending' AND tiktok_order_id IS NOT NULL;

-- ====================================================================
-- 2. import_tiktok_sale_order — insert as PENDING, no stock, no tax no.
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
  v_tiktok_id  text;
  v_order_id   bigint;
  v_order_row  sale_orders%ROWTYPE;
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
    -- Re-sync of an existing order: refresh fulfillment metadata only. Never
    -- touch status / stock / net so a confirmed order stays confirmed and a
    -- pending order stays pending across TikTok status pushes.
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
    tiktok_package_ids, tracking_number, tiktok_shipping_type
  )
  SELECT
    v_sale_date,
    'tiktok',
    COALESCE(NULLIF(p_header->>'payment_method', ''), 'transfer'),
    NULLIF(p_header->>'tiktok_payment_method', ''),
    'pending',
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
    NULL,            -- net_received entered by cashier at confirm
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
    NULLIF(p_header->>'tiktok_shipping_type', '')
  RETURNING id INTO v_order_id;

  -- Items only: product_id may be pre-matched (auto-suggest) but stock is NOT
  -- cut here and NO tax-invoice number is issued. Both happen at confirm.
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
-- 3. confirm_tiktok_sale_order — cashier confirms: match SKUs + net,
--    deduct stock once, issue tax no, flip to active.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.confirm_tiktok_sale_order(
  p_order_id     bigint,
  p_items        jsonb,                 -- [{ item_id, product_id }]
  p_net_received numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
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

  -- Apply SKU matches chosen by the cashier (and snapshot cost from product).
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

  -- Every line must be matched before we can deduct stock + sell.
  SELECT count(*) INTO v_unmatched
    FROM sale_order_items
   WHERE sale_order_id = p_order_id AND product_id IS NULL;
  IF v_unmatched > 0 THEN
    RAISE EXCEPTION 'ยังจับคู่สินค้าไม่ครบ (%, รายการ)', v_unmatched USING ERRCODE = '22023';
  END IF;

  -- Deduct stock once per line.
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

  -- Issue a tax-invoice number now (only if one wasn't already assigned).
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

  -- Persist sku_id → product mappings so future imports auto-suggest.
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
-- 4. get_pending_tiktok_orders — the POS confirmation queue.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.get_pending_tiktok_orders(
  p_limit int DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
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
      WHERE so.status = 'pending' AND so.tiktok_order_id IS NOT NULL
      ORDER BY so.sale_date DESC
      LIMIT GREATEST(1, LEAST(p_limit, 300))
    ) t
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_tiktok_orders(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_tiktok_orders(int) TO authenticated;

-- ====================================================================
-- 5. Guard the existing matching tools so they never cut stock while an
--    order is still pending (confirm owns the single stock deduction).
-- ====================================================================

-- Admin matching queue should also surface pending orders (every new TikTok
-- order is now pending until a cashier confirms it).
CREATE OR REPLACE FUNCTION public.get_tiktok_unmatched_items(
  p_limit int DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    FROM (
      SELECT soi.id, soi.sale_order_id, soi.product_name, soi.sku_name,
             soi.seller_sku, soi.tiktok_sku_id, soi.sku_image_url, soi.quantity,
             so.tiktok_order_id, so.sale_date
      FROM sale_order_items soi
      JOIN sale_orders so ON so.id = soi.sale_order_id
      WHERE so.channel = 'tiktok' AND so.status IN ('active', 'pending')
        AND soi.product_id IS NULL
      ORDER BY so.sale_date DESC
      LIMIT GREATEST(1, LEAST(p_limit, 200))
    ) t
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_tiktok_unmatched_items(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tiktok_unmatched_items(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.link_tiktok_item_to_product(
  p_item_id bigint,
  p_product_id bigint,
  p_apply_stock boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_status text;
  v_apply boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public.sale_order_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Line item % not found', p_item_id USING ERRCODE = 'P0002';
  END IF;
  IF v_item.product_id IS NOT NULL THEN
    RAISE EXCEPTION 'รายการนี้จับคู่แล้ว' USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_status FROM public.sale_orders WHERE id = v_item.sale_order_id;

  UPDATE public.sale_order_items SET product_id = p_product_id WHERE id = p_item_id;

  IF v_item.tiktok_sku_id IS NOT NULL THEN
    INSERT INTO public.tiktok_product_mappings (tiktok_sku_id, product_id, seller_sku, tiktok_product_name, updated_at)
    VALUES (v_item.tiktok_sku_id, p_product_id, v_item.seller_sku, COALESCE(v_item.sku_name, v_item.product_name), now())
    ON CONFLICT (tiktok_sku_id) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      seller_sku = EXCLUDED.seller_sku,
      tiktok_product_name = EXCLUDED.tiktok_product_name,
      updated_at = now();
  END IF;

  -- Never deduct stock for a pending order — confirm_tiktok_sale_order does
  -- the single, authoritative deduction when the cashier confirms.
  v_apply := p_apply_stock AND v_status IS DISTINCT FROM 'pending';
  IF v_apply THEN
    PERFORM public.adjust_stock(
      p_id => p_product_id,
      qty_delta => -(v_item.quantity)::integer,
      p_reason => 'sale',
      p_ref_table => 'sale_orders',
      p_ref_id => v_item.sale_order_id
    );
  END IF;

  RETURN jsonb_build_object('item_id', p_item_id, 'product_id', p_product_id, 'stock_applied', v_apply);
END;
$$;
REVOKE ALL ON FUNCTION public.link_tiktok_item_to_product(bigint, bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_tiktok_item_to_product(bigint, bigint, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.relink_tiktok_by_mapping(
  p_apply_stock boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_rec   record;
  v_count int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  FOR v_rec IN
    SELECT soi.id, m.product_id, soi.quantity, soi.sale_order_id, so.status
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
    JOIN public.tiktok_product_mappings m ON m.tiktok_sku_id = soi.tiktok_sku_id
    WHERE so.channel = 'tiktok' AND so.status IN ('active', 'pending')
      AND soi.product_id IS NULL AND m.product_id IS NOT NULL
  LOOP
    UPDATE public.sale_order_items SET product_id = v_rec.product_id WHERE id = v_rec.id;
    -- Skip stock for pending orders; confirm handles it.
    IF p_apply_stock AND v_rec.status IS DISTINCT FROM 'pending' THEN
      PERFORM public.adjust_stock(
        p_id => v_rec.product_id,
        qty_delta => -(v_rec.quantity)::integer,
        p_reason => 'sale',
        p_ref_table => 'sale_orders',
        p_ref_id => v_rec.sale_order_id
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('relinked', v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.relink_tiktok_by_mapping(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.relink_tiktok_by_mapping(boolean) TO authenticated;

-- ====================================================================
-- 6. void_tiktok_sale_order — don't restore stock for pending orders
--    (none was ever taken).
-- ====================================================================
CREATE OR REPLACE FUNCTION public.void_tiktok_sale_order(
  p_tiktok_order_id text,
  p_reason text DEFAULT 'TikTok order cancelled'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
  v_status text;
  r record;
BEGIN
  SELECT id, status INTO v_id, v_status FROM sale_orders
   WHERE tiktok_order_id = p_tiktok_order_id AND status IN ('active', 'pending');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_found_or_already_voided');
  END IF;

  UPDATE sale_orders
     SET status = 'voided', voided_at = now(), void_reason = p_reason, updated_at = now()
   WHERE id = v_id AND status IN ('active', 'pending');

  -- Only restore stock if it was actually deducted (active orders). Pending
  -- orders never cut stock, so there is nothing to give back.
  IF v_status = 'active' THEN
    FOR r IN
      SELECT product_id, quantity FROM sale_order_items
       WHERE sale_order_id = v_id AND product_id IS NOT NULL
    LOOP
      PERFORM public.adjust_stock(
        r.product_id, r.quantity, 'sale_void', 'sale_orders', v_id
      );
    END LOOP;
  END IF;

  RETURN (SELECT to_jsonb(so) FROM sale_orders so WHERE id = v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.void_tiktok_sale_order(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_tiktok_sale_order(text, text) TO service_role;

-- ====================================================================
-- 7. Backfill — only move TikTok orders placed from the go-live cutoff
--    (2026-06-07 13:00 Asia/Bangkok) onward into the pending queue. Older
--    orders are left untouched (stay 'active', keep their stock + tax number)
--    so we don't re-open historical sales that were already reconciled.
--    Reverse any stock previously deducted on the in-scope orders so the
--    cashier re-confirms cleanly and stock is only ever cut at confirm.
-- ====================================================================
DO $$
DECLARE
  v_cutoff constant timestamptz := '2026-06-07 13:00:00+07';
  r record;
BEGIN
  FOR r IN
    SELECT soi.product_id, soi.quantity, soi.sale_order_id
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
    WHERE so.tiktok_order_id IS NOT NULL
      AND so.status = 'active'
      AND so.sale_date >= v_cutoff
      AND soi.product_id IS NOT NULL
  LOOP
    PERFORM public.adjust_stock(
      r.product_id, r.quantity, 'sale_void', 'sale_orders', r.sale_order_id
    );
  END LOOP;

  UPDATE public.sale_orders
     SET status = 'pending',
         net_received = NULL,
         net_received_pending = false,
         confirmed_at = NULL,
         confirmed_by = NULL,
         updated_at = now()
   WHERE tiktok_order_id IS NOT NULL
     AND status = 'active'
     AND sale_date >= v_cutoff;
END $$;
