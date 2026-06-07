-- 046_tiktok_matching_super_admin.sql
-- Restrict TikTok product-matching RPCs to super_admin only.

CREATE OR REPLACE FUNCTION public.get_tiktok_unmatched_items(
  p_limit int DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin' USING ERRCODE = '42501';
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_item   public.sale_order_items%ROWTYPE;
  v_status text;
  v_apply  boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin' USING ERRCODE = '42501';
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
  IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super admin' USING ERRCODE = '42501';
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
