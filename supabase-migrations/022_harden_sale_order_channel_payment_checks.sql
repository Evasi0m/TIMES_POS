-- 022_harden_sale_order_channel_payment_checks.sql
-- Replace legacy CHECK constraints that used `ANY (..., NULL)`.
-- In Postgres, CHECK constraints pass when the expression is UNKNOWN,
-- so putting NULL inside the ANY array makes invalid non-null values slip
-- through. Use explicit `IS NULL OR value IN (...)` instead.
--
-- Also adds the current payment methods used by the app: paylater + cod.

ALTER TABLE public.sale_orders
  DROP CONSTRAINT IF EXISTS sale_orders_channel_check;

ALTER TABLE public.sale_orders
  ADD CONSTRAINT sale_orders_channel_check
  CHECK (
    channel IS NULL OR channel IN ('tiktok', 'shopee', 'facebook', 'store', 'lazada')
  );

ALTER TABLE public.sale_orders
  DROP CONSTRAINT IF EXISTS sale_orders_payment_method_check;

ALTER TABLE public.sale_orders
  ADD CONSTRAINT sale_orders_payment_method_check
  CHECK (
    payment_method IS NULL OR payment_method IN ('cash', 'transfer', 'card', 'paylater', 'cod')
  );
