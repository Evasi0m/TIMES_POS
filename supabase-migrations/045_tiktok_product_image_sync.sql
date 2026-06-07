-- 045_tiktok_product_image_sync.sql
-- When a TikTok SKU is matched to a POS product, hotlink sku_image_url into
-- product_images so ProductThumb shows the TikTok photo across the catalog.

-- ====================================================================
-- 1. Allow source_brand = 'tiktok'
-- ====================================================================
ALTER TABLE public.product_images
  DROP CONSTRAINT IF EXISTS product_images_source_brand_check;

ALTER TABLE public.product_images
  ADD CONSTRAINT product_images_source_brand_check
  CHECK (source_brand IN ('casio', 'seiko', 'alba', 'citizen', 'manual', 'tiktok'));

-- ====================================================================
-- 2. apply_tiktok_product_image — upsert hotlinked TikTok CDN URL
-- ====================================================================
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
BEGIN
  v_url := NULLIF(trim(p_image_url), '');
  IF p_product_id IS NULL OR v_url IS NULL THEN
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
    updated_at         = now();
END;
$$;

REVOKE ALL ON FUNCTION public.apply_tiktok_product_image(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_tiktok_product_image(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_tiktok_product_image(bigint, text) TO service_role;

-- ====================================================================
-- 3. confirm_tiktok_sale_order — sync images after SKU match
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

REVOKE ALL ON FUNCTION public.confirm_tiktok_sale_order(bigint, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_tiktok_sale_order(bigint, jsonb, numeric) TO authenticated;

-- ====================================================================
-- 4. link_tiktok_item_to_product — sync image on admin match
-- ====================================================================
CREATE OR REPLACE FUNCTION public.link_tiktok_item_to_product(
  p_item_id bigint,
  p_product_id bigint,
  p_apply_stock boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_item   public.sale_order_items%ROWTYPE;
  v_status text;
  v_apply  boolean;
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

  IF NULLIF(trim(v_item.sku_image_url), '') IS NOT NULL THEN
    PERFORM public.apply_tiktok_product_image(p_product_id, v_item.sku_image_url);
  END IF;

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

-- ====================================================================
-- 5. relink_tiktok_by_mapping — sync images when bulk-relinking
-- ====================================================================
CREATE OR REPLACE FUNCTION public.relink_tiktok_by_mapping(
  p_apply_stock boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_rec   record;
  v_count int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  FOR v_rec IN
    SELECT soi.id, m.product_id, soi.quantity, soi.sale_order_id, so.status, soi.sku_image_url
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
    JOIN public.tiktok_product_mappings m ON m.tiktok_sku_id = soi.tiktok_sku_id
    WHERE so.channel = 'tiktok' AND so.status IN ('active', 'pending')
      AND soi.product_id IS NULL AND m.product_id IS NOT NULL
  LOOP
    UPDATE public.sale_order_items SET product_id = v_rec.product_id WHERE id = v_rec.id;

    IF NULLIF(trim(v_rec.sku_image_url), '') IS NOT NULL THEN
      PERFORM public.apply_tiktok_product_image(v_rec.product_id, v_rec.sku_image_url);
    END IF;

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
