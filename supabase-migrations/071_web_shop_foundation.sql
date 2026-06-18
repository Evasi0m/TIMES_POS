-- 071_web_shop_foundation.sql
-- TIMES_SHOP catalog cache — TikTok SKU mirror (NOT POS products table).
-- Shop reads via shop-get-catalog Edge Function only (service_role).

CREATE TABLE IF NOT EXISTS public.storefront_products (
  tiktok_sku_id     text PRIMARY KEY,
  tiktok_product_id text,
  product_name      text NOT NULL,
  sku_name          text,
  seller_sku        text,
  image_url         text,
  unit_price        numeric(12,2) NOT NULL DEFAULT 0,
  stock_available   integer NOT NULL DEFAULT 0,
  pos_product_id    bigint REFERENCES public.products(id),
  is_published      boolean NOT NULL DEFAULT true,
  deleted_at        timestamptz,
  sort_order        integer NOT NULL DEFAULT 0,
  description       text,
  synced_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_storefront_products_catalog
  ON public.storefront_products (updated_at DESC)
  WHERE is_published = true AND deleted_at IS NULL;

COMMENT ON TABLE public.storefront_products IS
  'TikTok Shop catalog cache for TIMES_SHOP — synced from TikTok API, not POS retail stock.';

ALTER TABLE public.storefront_products ENABLE ROW LEVEL SECURITY;
-- Intentionally no SELECT policy for anon/authenticated — Shop uses Edge Functions only.
