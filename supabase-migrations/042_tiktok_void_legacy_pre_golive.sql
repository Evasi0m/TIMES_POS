-- 042_tiktok_void_legacy_pre_golive.sql
-- Legacy TikTok API orders (sale_date BEFORE 2026-06-07 13:00 Bangkok) were
-- already re-keyed by cashiers at POS. They must NOT appear in Sales History
-- AND must NOT keep a stock deduction — only the manual POS sale counts.
--
-- Migration 041 may have re-applied stock cuts when restoring those orders to
-- `active`; this migration reverses that one last time and voids the duplicate
-- API rows so they stay out of reports (no confirmed_at) and out of inventory.
--
-- Idempotent: only touches rows still `active` or `pending`. A second run is a
-- no-op because matched orders are already `voided`.

DO $$
DECLARE
  v_cutoff constant timestamptz := '2026-06-07 13:00:00+07';
  v_order  record;
  r        record;
BEGIN
  FOR v_order IN
    SELECT id, status
    FROM public.sale_orders
    WHERE tiktok_order_id IS NOT NULL
      AND confirmed_at IS NULL
      AND sale_date < v_cutoff
      AND status IN ('active', 'pending')
  LOOP
    -- `active` legacy imports still hold a stock deduction (original import or
    -- re-applied by 041). Return it once. `pending` rows were already
    -- neutralised by 040 — nothing to give back.
    IF v_order.status = 'active' THEN
      FOR r IN
        SELECT product_id, quantity
        FROM public.sale_order_items
        WHERE sale_order_id = v_order.id
          AND product_id IS NOT NULL
      LOOP
        PERFORM public.adjust_stock(
          r.product_id, r.quantity, 'sale_void', 'sale_orders', v_order.id
        );
      END LOOP;
    END IF;

    UPDATE public.sale_orders
       SET status      = 'voided',
           voided_at   = now(),
           void_reason = 'Legacy TikTok API duplicate (pre POS go-live) — stock restored',
           updated_at  = now()
     WHERE id = v_order.id;
  END LOOP;
END $$;
