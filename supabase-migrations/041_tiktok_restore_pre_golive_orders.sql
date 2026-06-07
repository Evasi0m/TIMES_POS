-- 041_tiktok_restore_pre_golive_orders.sql
-- Repair for a 040 run that converted ALL TikTok orders to 'pending'.
--
-- The pending-confirmation go-live only applies to orders placed from
-- 2026-06-07 13:00 Asia/Bangkok onward. Older TikTok orders had already been
-- reconciled (stock cut, tax number issued, counted in reports) and must NOT
-- be re-opened. The first 040 backfill (before it learned the cutoff) flipped
-- them to 'pending' and reversed their stock — this migration undoes that for
-- the pre-go-live orders only:
--   * re-deduct stock for their matched line items (restoring the original cut)
--   * set status back to 'active'
-- Orders from the cutoff onward stay 'pending' (the new cashier-confirm flow).
--
-- Idempotent: once restored, the orders are 'active', so a re-run matches no
-- rows and re-deducts nothing.

DO $$
DECLARE
  v_cutoff constant timestamptz := '2026-06-07 13:00:00+07';
  r record;
BEGIN
  -- Re-apply the original stock deduction for matched items on the old orders
  -- we're restoring (040 had given this stock back).
  FOR r IN
    SELECT soi.product_id, soi.quantity, soi.sale_order_id
    FROM public.sale_order_items soi
    JOIN public.sale_orders so ON so.id = soi.sale_order_id
    WHERE so.tiktok_order_id IS NOT NULL
      AND so.status = 'pending'
      AND so.sale_date < v_cutoff
      AND soi.product_id IS NOT NULL
  LOOP
    PERFORM public.adjust_stock(
      r.product_id, -(r.quantity)::integer, 'sale', 'sale_orders', r.sale_order_id
    );
  END LOOP;

  -- Restore the orders to their pre-040 'active' state. (net_received was NULL
  -- for API-imported TikTok orders to begin with, so nothing to recover there;
  -- existing tax-invoice numbers were kept by 040.)
  UPDATE public.sale_orders
     SET status = 'active',
         updated_at = now()
   WHERE tiktok_order_id IS NOT NULL
     AND status = 'pending'
     AND sale_date < v_cutoff;
END $$;
