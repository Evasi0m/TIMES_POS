-- 003_add_net_received.sql
-- Adds the net_received column to sale_orders so e-commerce sales can record
-- the actual money the shop receives after platform fees (TikTok / Shopee /
-- Lazada take a cut, so grand_total ≠ revenue).
--
-- For store / facebook sales the column stays NULL — those flows treat
-- grand_total as revenue directly.
--
-- Also merges legacy 'cash' rows into 'transfer' since the UI no longer
-- exposes a separate cash option (we treat any over-the-counter payment
-- as transfer).
--
-- Companion changes:
--   - 001_create_sale_order_with_items.sql now passes net_received through
--     to the INSERT so the RPC writes the new column too.
--   - src/main.jsx: ProfitLossView and DashboardView prefer net_received
--     over grand_total when the channel is in {tiktok, shopee, lazada}.

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS net_received numeric;

COMMENT ON COLUMN public.sale_orders.net_received IS
  'Actual money the shop received from the platform (only for tiktok/shopee/lazada). NULL means use grand_total for profit calculation.';

UPDATE public.sale_orders
   SET payment_method = 'transfer'
 WHERE payment_method = 'cash';
