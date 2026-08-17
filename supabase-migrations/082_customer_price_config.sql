-- Migration 082 — customer-price tab markup config.
--
-- Floor staff quote from latest cost_price + per-brand % then snap to a
-- Thai retail ending (default 90). Config lives on shop_settings so admins
-- can change % without a deploy. Missing column / NULL falls back in JS.

ALTER TABLE public.shop_settings
  ADD COLUMN IF NOT EXISTS customer_price_config JSONB;

COMMENT ON COLUMN public.shop_settings.customer_price_config IS
  'Customer-price tab: { ending, round, default_markup_pct, brands: { casio, seiko, alba, citizen, other } }. NULL = in-code defaults (30% / ending 90 / round down).';
