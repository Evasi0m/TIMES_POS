-- Migration 006 — enable Supabase Realtime on the tables that the app
-- subscribes to via `useRealtimeInvalidate()`. Without this, subscribing
-- clients connect successfully but never receive INSERT/UPDATE/DELETE
-- events, which silently breaks cross-device sync.
--
-- The publication `supabase_realtime` is created automatically by Supabase
-- on project init. We just add our tables to it (idempotent — no-op if
-- already present).
--
-- Safe to re-run; `IF NOT EXISTS` guards + DO blocks mean this survives
-- partial applies.

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'products',
    'sale_orders',
    'sale_order_items',
    'receive_orders',
    'receive_order_items',
    'return_orders',
    'return_order_items',
    'stock_movements',
    'shop_expenses',
    'shop_settings'
  ])
  LOOP
    -- ALTER PUBLICATION ... ADD TABLE is not idempotent on its own, so
    -- check first.
    IF NOT EXISTS (
      SELECT 1
      FROM   pg_publication_tables
      WHERE  pubname    = 'supabase_realtime'
      AND    schemaname = 'public'
      AND    tablename  = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

-- Verify:
--   select tablename from pg_publication_tables
--    where pubname='supabase_realtime' and schemaname='public';
