-- 060_tiktok_mapping_image_sync.sql — sync TikTok SKU images on mapping/import + backfill

-- ── apply_tiktok_product_image — skip manual override ───────────────────────
CREATE OR REPLACE FUNCTION public.apply_tiktok_product_image(
  p_product_id bigint,
  p_image_url  text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url  text;
  v_name text;
  v_manual boolean;
BEGIN
  v_url := NULLIF(trim(p_image_url), '');
  IF p_product_id IS NULL OR v_url IS NULL THEN
    RETURN;
  END IF;

  SELECT is_manual_override INTO v_manual
    FROM public.product_images
   WHERE product_id = p_product_id;
  IF COALESCE(v_manual, false) THEN
    RETURN;
  END IF;

  SELECT name INTO v_name FROM public.products WHERE id = p_product_id;

  INSERT INTO public.product_images (
    product_id,
    image_url,
    source_url,
    source_brand,
    source_name,
    status,
    is_manual_override,
    last_checked_at,
    updated_at
  ) VALUES (
    p_product_id,
    v_url,
    v_url,
    'tiktok',
    v_name,
    'found',
    false,
    now(),
    now()
  )
  ON CONFLICT (product_id) DO UPDATE SET
    image_url          = EXCLUDED.image_url,
    source_url         = EXCLUDED.source_url,
    source_brand       = EXCLUDED.source_brand,
    source_name        = COALESCE(EXCLUDED.source_name, product_images.source_name),
    status             = 'found',
    is_manual_override = false,
    last_checked_at    = now(),
    updated_at         = now()
  WHERE NOT product_images.is_manual_override;
END;
$$;

-- ── sync images from order lines (import / resync) ──────────────────────────
CREATE OR REPLACE FUNCTION public.sync_tiktok_order_line_images(p_order_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF p_order_id IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT DISTINCT ON (soi.product_id)
      soi.product_id,
      soi.sku_image_url
    FROM public.sale_order_items soi
    WHERE soi.sale_order_id = p_order_id
      AND soi.product_id IS NOT NULL
      AND NULLIF(trim(soi.sku_image_url), '') IS NOT NULL
    ORDER BY soi.product_id, soi.id DESC
  LOOP
    PERFORM public.apply_tiktok_product_image(r.product_id, r.sku_image_url);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_tiktok_order_line_images(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_tiktok_order_line_images(bigint) TO service_role;

-- ── upsert mapping + optional image ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.upsert_tiktok_inventory_mapping(text, bigint, text, text, text, text);

CREATE OR REPLACE FUNCTION public.upsert_tiktok_inventory_mapping(
  p_tiktok_sku_id       text,
  p_product_id          bigint,
  p_tiktok_product_id   text,
  p_seller_sku          text DEFAULT NULL,
  p_tiktok_product_name text DEFAULT NULL,
  p_warehouse_id        text DEFAULT NULL,
  p_image_url           text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role'
     AND (auth.uid() IS NULL OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(p_tiktok_sku_id), '') IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'tiktok_sku_id and product_id required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tiktok_product_mappings (
    tiktok_sku_id, product_id, seller_sku, tiktok_product_name,
    tiktok_product_id, warehouse_id, sync_enabled, updated_at
  ) VALUES (
    trim(p_tiktok_sku_id), p_product_id, p_seller_sku, p_tiktok_product_name,
    p_tiktok_product_id, p_warehouse_id, true, now()
  )
  ON CONFLICT (tiktok_sku_id) DO UPDATE SET
    product_id          = EXCLUDED.product_id,
    seller_sku          = COALESCE(EXCLUDED.seller_sku, tiktok_product_mappings.seller_sku),
    tiktok_product_name = COALESCE(EXCLUDED.tiktok_product_name, tiktok_product_mappings.tiktok_product_name),
    tiktok_product_id   = COALESCE(EXCLUDED.tiktok_product_id, tiktok_product_mappings.tiktok_product_id),
    warehouse_id        = COALESCE(EXCLUDED.warehouse_id, tiktok_product_mappings.warehouse_id),
    sync_enabled        = true,
    updated_at          = now();

  IF NULLIF(trim(p_image_url), '') IS NOT NULL THEN
    PERFORM public.apply_tiktok_product_image(p_product_id, p_image_url);
  END IF;

  RETURN jsonb_build_object('ok', true, 'tiktok_sku_id', trim(p_tiktok_sku_id));
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_tiktok_inventory_mapping(text, bigint, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_tiktok_inventory_mapping(text, bigint, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_tiktok_inventory_mapping(text, bigint, text, text, text, text, text) TO service_role;

-- ── import_tiktok_sale_order — sync images on new order insert ──────────────
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
    PERFORM public.sync_tiktok_order_line_images(v_order_id);
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

  PERFORM public.sync_tiktok_order_line_images(v_order_id);

  SELECT * INTO v_order_row FROM sale_orders WHERE id = v_order_id;
  RETURN to_jsonb(v_order_row);
END;
$$;

REVOKE ALL ON FUNCTION public.import_tiktok_sale_order(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_tiktok_sale_order(jsonb, jsonb) TO service_role;

-- ── backfill images for mapped products missing catalog photo ───────────────
CREATE OR REPLACE FUNCTION public.backfill_tiktok_product_images()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  r record;
  v_synced int := 0;
  v_skipped int := 0;
  v_no_image int := 0;
  v_url text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT m.product_id, m.tiktok_sku_id
    FROM public.tiktok_product_mappings m
    WHERE m.product_id IS NOT NULL
      AND COALESCE(m.sync_enabled, true)
  LOOP
    IF EXISTS (
      SELECT 1 FROM public.product_images pi
       WHERE pi.product_id = r.product_id
         AND pi.status = 'found'
         AND NULLIF(trim(pi.image_url), '') IS NOT NULL
         AND NOT COALESCE(pi.is_manual_override, false)
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.product_images pi
       WHERE pi.product_id = r.product_id
         AND COALESCE(pi.is_manual_override, false)
    ) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT soi.sku_image_url INTO v_url
    FROM public.sale_order_items soi
    WHERE soi.product_id = r.product_id
      AND NULLIF(trim(soi.sku_image_url), '') IS NOT NULL
      AND (
        soi.tiktok_sku_id = r.tiktok_sku_id
        OR soi.tiktok_sku_id IS NULL
      )
    ORDER BY soi.id DESC
    LIMIT 1;

    IF v_url IS NULL THEN
      v_no_image := v_no_image + 1;
      CONTINUE;
    END IF;

    PERFORM public.apply_tiktok_product_image(r.product_id, v_url);
    v_synced := v_synced + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'synced', v_synced,
    'skipped', v_skipped,
    'no_image', v_no_image
  );
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_tiktok_product_images() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_tiktok_product_images() TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_tiktok_product_images() TO service_role;
