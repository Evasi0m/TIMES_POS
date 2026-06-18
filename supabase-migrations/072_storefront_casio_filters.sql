-- CASIO derived filter columns on storefront_products (TIMES_SHOP catalog filters).

ALTER TABLE public.storefront_products
  ADD COLUMN IF NOT EXISTS model_base text,
  ADD COLUMN IF NOT EXISTS watch_series text,
  ADD COLUMN IF NOT EXISTS watch_sub_type text,
  ADD COLUMN IF NOT EXISTS casio_prefix text,
  ADD COLUMN IF NOT EXISTS strap_material text,
  ADD COLUMN IF NOT EXISTS dial_color_code text;

CREATE INDEX IF NOT EXISTS idx_storefront_watch_series
  ON public.storefront_products (watch_series)
  WHERE is_published = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_storefront_model_base
  ON public.storefront_products (model_base)
  WHERE is_published = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_storefront_watch_sub_type
  ON public.storefront_products (watch_sub_type)
  WHERE is_published = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_storefront_strap_material
  ON public.storefront_products (strap_material)
  WHERE is_published = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_storefront_dial_color
  ON public.storefront_products (dial_color_code)
  WHERE is_published = true AND deleted_at IS NULL;

COMMENT ON COLUMN public.storefront_products.model_base IS
  'CASIO base model (color suffix stripped), derived from sku_name/seller_sku at sync.';
