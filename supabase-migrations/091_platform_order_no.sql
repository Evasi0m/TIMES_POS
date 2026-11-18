-- 091_platform_order_no.sql
-- Marketplace order number on manually keyed e-commerce bills
-- (Shopee / Lazada / Thaimart / TikTok manual). Used to:
--   * block keying the same platform order twice
--   * reconcile bills against the platform payout report
-- TikTok API imports keep using tiktok_order_id.

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS platform_order_no text;

COMMENT ON COLUMN public.sale_orders.platform_order_no IS
  'Order number from the marketplace (manual e-commerce bills). Unique per channel among non-voided bills.';

-- One live bill per (channel, order number). Voided bills free the number so
-- a cashier can void + re-key a wrong bill.
CREATE UNIQUE INDEX IF NOT EXISTS sale_orders_platform_order_uniq
  ON public.sale_orders (channel, lower(platform_order_no))
  WHERE platform_order_no IS NOT NULL AND status <> 'voided';

-- Teach create_sale_order_with_items to persist p_header.platform_order_no.
-- After 086 the body lives in create_sale_order_with_items__impl; patch the
-- INSERT column list + SELECT values in place.
DO $$
DECLARE
  r    record;
  def  text;
  n    int := 0;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('create_sale_order_with_items', 'create_sale_order_with_items__impl')
       AND p.prosrc LIKE '%notes, net_received, net_received_pending%'
       AND p.prosrc NOT LIKE '%platform_order_no%'
  LOOP
    def := pg_get_functiondef(r.oid);
    def := replace(def,
      'notes, net_received, net_received_pending',
      'notes, net_received, net_received_pending, platform_order_no');
    def := regexp_replace(def,
      '(COALESCE\(\(p_header->>''net_received_pending''\)::boolean, false\))',
      '\1,' || chr(10) || '    NULLIF(btrim(p_header->>''platform_order_no''), '''')');
    IF def NOT LIKE '%p_header->>''platform_order_no''%' THEN
      RAISE EXCEPTION 'create_sale_order_with_items: VALUES patch did not apply';
    END IF;
    EXECUTE def;
    n := n + 1;
  END LOOP;
  IF n = 0 AND NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('create_sale_order_with_items', 'create_sale_order_with_items__impl')
       AND p.prosrc LIKE '%platform_order_no%'
  ) THEN
    RAISE EXCEPTION 'create_sale_order_with_items INSERT not found — patch manually';
  END IF;
END $$;
