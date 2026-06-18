-- 074_storefront_sales_attributes.sql
-- TikTok SKU variant axes for TIMES_SHOP listing picker.

ALTER TABLE public.storefront_products
  ADD COLUMN IF NOT EXISTS sales_attributes jsonb;

CREATE INDEX IF NOT EXISTS idx_storefront_products_tiktok_product_id
  ON public.storefront_products (tiktok_product_id)
  WHERE deleted_at IS NULL AND tiktok_product_id IS NOT NULL;

COMMENT ON COLUMN public.storefront_products.sales_attributes IS
  'TikTok sales_attributes[] snapshot — variant name/value per SKU.';
