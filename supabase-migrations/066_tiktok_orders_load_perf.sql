-- 066: Speed up TikTok Shop orders panel load (fix statement_timeout).
-- Panel lists recent sale_orders + their line items only — not a full-table join scan.

CREATE INDEX IF NOT EXISTS idx_sale_orders_tiktok_list
  ON public.sale_orders (sale_date DESC)
  WHERE channel = 'tiktok' AND tiktok_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sale_order_items_sale_order_id
  ON public.sale_order_items (sale_order_id);
