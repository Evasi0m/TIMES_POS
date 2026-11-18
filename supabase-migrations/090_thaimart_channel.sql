-- 090_thaimart_channel.sql
-- Add Thaimart as a marketplace sales channel.
--   * sale_orders.channel CHECK now accepts 'thaimart'
--   * edit_sale_order (and its perm-guard __impl body from 086) accepts it
-- Thaimart orders are keyed manually at POS (no API) and, like the other
-- marketplaces, record net_received. BigSeller is connected to Thaimart,
-- so the BigSeller export skips its order-linked movements (client side).

ALTER TABLE public.sale_orders
  DROP CONSTRAINT IF EXISTS sale_orders_channel_check;

ALTER TABLE public.sale_orders
  ADD CONSTRAINT sale_orders_channel_check
  CHECK (
    channel IS NULL OR channel IN ('tiktok', 'shopee', 'facebook', 'store', 'lazada', 'thaimart')
  );

-- Patch the channel whitelist inside edit_sale_order in place. After 086 the
-- real body lives in edit_sale_order__impl; patch whichever holds the list.
DO $$
DECLARE
  r   record;
  def text;
  n   int := 0;
BEGIN
  FOR r IN
    SELECT p.oid FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('edit_sale_order', 'edit_sale_order__impl')
       AND p.prosrc LIKE '%''store'',''lazada'')%'
  LOOP
    def := replace(pg_get_functiondef(r.oid),
                   '''store'',''lazada'')',
                   '''store'',''lazada'',''thaimart'')');
    EXECUTE def;
    n := n + 1;
  END LOOP;
  IF n = 0 AND NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname IN ('edit_sale_order', 'edit_sale_order__impl')
       AND p.prosrc LIKE '%''thaimart''%'
  ) THEN
    RAISE EXCEPTION 'edit_sale_order channel whitelist not found — patch manually';
  END IF;
END $$;

COMMENT ON COLUMN public.sale_orders.net_received IS
  'Actual money the shop received from the platform (only for tiktok/shopee/lazada/thaimart). NULL means use grand_total for profit calculation.';
