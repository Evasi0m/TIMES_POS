-- 075_storefront_listing_image.sql
-- TikTok product cover (main/thumb) — shared across SKUs in one listing.

ALTER TABLE public.storefront_products
  ADD COLUMN IF NOT EXISTS listing_image_url text;

COMMENT ON COLUMN public.storefront_products.listing_image_url IS
  'TikTok product-level cover image (main/thumb) — same for all SKUs in listing.';

-- Interim backfill until next TikTok sync: first SKU image per product (sorted by sku id).
UPDATE public.storefront_products sp
SET listing_image_url = sub.cover
FROM (
  SELECT DISTINCT ON (tiktok_product_id)
    tiktok_product_id,
    image_url AS cover
  FROM public.storefront_products
  WHERE deleted_at IS NULL
    AND tiktok_product_id IS NOT NULL
    AND image_url IS NOT NULL
  ORDER BY tiktok_product_id, tiktok_sku_id ASC
) sub
WHERE sp.tiktok_product_id = sub.tiktok_product_id
  AND sp.deleted_at IS NULL
  AND sp.listing_image_url IS NULL;
