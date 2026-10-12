-- 084_tiktok_image_substitution_fix.sql
-- Stop wrong TikTok photos landing on POS products, and clean up the ones
-- that already did.
--
-- 1. confirm_tiktok_sale_order — a substituted line ("ส่งจริงคนละรุ่น")
--    carries the photo of the SKU the buyer ORDERED, but its product_id is
--    the model actually SHIPPED. 062/075/076 skipped those lines for the
--    mapping upsert but still copied their photo onto the shipped product.
--    Body is 076 verbatim; only the image loop gains the substitution filter.
-- 2. backfill_tiktok_product_images — same filter on the order-line source.
-- 3. clear_tiktok_product_image — drop a product's TikTok-sourced photo
--    (never a manual override or a brand-site photo). Used after unlinking
--    or moving a SKU so the old photo doesn't stick to the wrong model.
-- 4. reset_polluted_tiktok_images — one-off cleanup: removes TikTok photos
--    that came from a substituted line, or whose product no longer has any
--    TikTok mapping. Returns the product ids so the client can re-fetch.
--
-- Idempotent. Safe to re-run.

-- ====================================================================
-- 1. confirm_tiktok_sale_order
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


  -- Skip substituted lines: their photo belongs to the ordered SKU, not the
  -- shipped product.
  FOR r IN
    SELECT DISTINCT product_id, sku_image_url
      FROM sale_order_items
     WHERE sale_order_id = p_order_id
       AND product_id IS NOT NULL
       AND NOT COALESCE(is_sku_substitution, false)
       AND NULLIF(trim(sku_image_url), '') IS NOT NULL
  LOOP
    PERFORM public.apply_tiktok_product_image(r.product_id, r.sku_image_url);
  END LOOP;

  RETURN (SELECT to_jsonb(so) FROM sale_orders so WHERE id = p_order_id);
END;
$$;

-- ====================================================================
-- 2. backfill_tiktok_product_images
-- ====================================================================
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
      AND NOT COALESCE(soi.is_sku_substitution, false)
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

-- ====================================================================
-- 3. clear_tiktok_product_image
-- ====================================================================
CREATE OR REPLACE FUNCTION public.clear_tiktok_product_image(p_product_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_deleted int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;
  IF p_product_id IS NULL THEN RETURN false; END IF;

  DELETE FROM public.product_images
   WHERE product_id = p_product_id
     AND source_brand = 'tiktok'
     AND NOT COALESCE(is_manual_override, false);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_tiktok_product_image(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_tiktok_product_image(bigint) TO authenticated;

-- ====================================================================
-- 4. reset_polluted_tiktok_images
-- ====================================================================
CREATE OR REPLACE FUNCTION public.reset_polluted_tiktok_images()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sub      bigint[];
  v_orphan   bigint[];
  v_mapped   bigint[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  -- Photo copied from a line where this product was shipped as a substitute.
  SELECT COALESCE(array_agg(DISTINCT pi.product_id), '{}') INTO v_sub
    FROM public.product_images pi
   WHERE pi.source_brand = 'tiktok'
     AND NOT COALESCE(pi.is_manual_override, false)
     AND EXISTS (
       SELECT 1 FROM public.sale_order_items soi
        WHERE soi.product_id = pi.product_id
          AND COALESCE(soi.is_sku_substitution, false)
          AND soi.sku_image_url = pi.image_url
     );

  -- TikTok photo on a product that no longer has any TikTok mapping.
  SELECT COALESCE(array_agg(pi.product_id), '{}') INTO v_orphan
    FROM public.product_images pi
   WHERE pi.source_brand = 'tiktok'
     AND NOT COALESCE(pi.is_manual_override, false)
     AND NOT (pi.product_id = ANY (v_sub))
     AND NOT EXISTS (
       SELECT 1 FROM public.tiktok_product_mappings m
        WHERE m.product_id = pi.product_id
     );

  DELETE FROM public.product_images
   WHERE product_id = ANY (v_sub || v_orphan)
     AND source_brand = 'tiktok'
     AND NOT COALESCE(is_manual_override, false);

  -- Products that still have a mapping — the client re-fetches their photo.
  SELECT COALESCE(array_agg(DISTINCT m.product_id), '{}') INTO v_mapped
    FROM public.tiktok_product_mappings m
   WHERE m.product_id = ANY (v_sub);

  RETURN jsonb_build_object(
    'substitution', cardinality(v_sub),
    'orphan',       cardinality(v_orphan),
    'refetch_product_ids', to_jsonb(v_mapped)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reset_polluted_tiktok_images() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_polluted_tiktok_images() TO authenticated;
