-- 037_tiktok_product_matching.sql
-- Product matching for TikTok line items:
--   1. richer get_tiktok_unmatched_items (seller_sku, sku_id, image, qty)
--   2. link_tiktok_item_to_product: set product_id, upsert mapping, optional restock
--   3. relink_tiktok_by_mapping: apply an existing mapping to all unmatched lines

-- ====================================================================
-- 1. Richer unmatched queue
-- ====================================================================
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
      WHERE so.channel = 'tiktok' AND so.status = 'active' AND soi.product_id IS NULL
      ORDER BY so.sale_date DESC
      LIMIT GREATEST(1, LEAST(p_limit, 200))
    ) t
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_tiktok_unmatched_items(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tiktok_unmatched_items(int) TO authenticated;

-- ====================================================================
-- 2. Link one line item to a POS product (+ optional retroactive stock cut)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.link_tiktok_item_to_product(
  p_item_id bigint,
  p_product_id bigint,
  p_apply_stock boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
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

  UPDATE public.sale_order_items SET product_id = p_product_id WHERE id = p_item_id;

  -- Persist the mapping so future imports auto-match by sku_id.
  IF v_item.tiktok_sku_id IS NOT NULL THEN
    INSERT INTO public.tiktok_product_mappings (tiktok_sku_id, product_id, seller_sku, tiktok_product_name, updated_at)
    VALUES (v_item.tiktok_sku_id, p_product_id, v_item.seller_sku, COALESCE(v_item.sku_name, v_item.product_name), now())
    ON CONFLICT (tiktok_sku_id) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      seller_sku = EXCLUDED.seller_sku,
      tiktok_product_name = EXCLUDED.tiktok_product_name,
      updated_at = now();
  END IF;

  -- Retroactively deduct stock for the already-sold line.
  IF p_apply_stock THEN
    PERFORM public.adjust_stock(
      p_id => p_product_id,
      qty_delta => -(v_item.quantity)::integer,
      p_reason => 'sale',
      p_ref_table => 'sale_orders',
      p_ref_id => v_item.sale_order_id
    );
  END IF;

  RETURN jsonb_build_object('item_id', p_item_id, 'product_id', p_product_id, 'stock_applied', p_apply_stock);
END;
$$;
REVOKE ALL ON FUNCTION public.link_tiktok_item_to_product(bigint, bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_tiktok_item_to_product(bigint, bigint, boolean) TO authenticated;

-- ====================================================================
-- 3. Re-apply known mappings to all currently-unmatched lines
-- ====================================================================
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
    SELECT soi.id, m.product_id, soi.quantity, soi.sale_order_id
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
    JOIN public.tiktok_product_mappings m ON m.tiktok_sku_id = soi.tiktok_sku_id
    WHERE so.channel = 'tiktok' AND so.status = 'active'
      AND soi.product_id IS NULL AND m.product_id IS NOT NULL
  LOOP
    UPDATE public.sale_order_items SET product_id = v_rec.product_id WHERE id = v_rec.id;
    IF p_apply_stock THEN
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
