-- 061_tiktok_mappings_needing_images.sql — list mapped products missing catalog photos

CREATE OR REPLACE FUNCTION public.get_tiktok_mappings_needing_images(
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  product_id bigint,
  tiktok_sku_id text,
  tiktok_product_id text,
  seller_sku text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    m.product_id,
    m.tiktok_sku_id,
    m.tiktok_product_id,
    m.seller_sku
  FROM public.tiktok_product_mappings m
  WHERE m.product_id IS NOT NULL
    AND COALESCE(m.sync_enabled, true)
    AND NULLIF(trim(m.tiktok_product_id), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.product_images pi
       WHERE pi.product_id = m.product_id
         AND pi.status = 'found'
         AND NULLIF(trim(pi.image_url), '') IS NOT NULL
         AND NOT COALESCE(pi.is_manual_override, false)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.product_images pi
       WHERE pi.product_id = m.product_id
         AND COALESCE(pi.is_manual_override, false)
    )
  ORDER BY m.updated_at DESC NULLS LAST, m.product_id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.get_tiktok_mappings_needing_images(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tiktok_mappings_needing_images(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tiktok_mappings_needing_images(int) TO service_role;
