-- 036_tiktok_settlement_breakdown.sql
-- Store TikTok settlement fee breakdown alongside net_received so the POS can
-- show grand_total vs net (platform fee / commission / shipping subsidy).

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS settlement_fee        numeric,   -- total fees deducted (negative-of-net diff)
  ADD COLUMN IF NOT EXISTS settlement_breakdown  jsonb,     -- raw fee lines from finance API
  ADD COLUMN IF NOT EXISTS settlement_synced_at  timestamptz;

COMMENT ON COLUMN public.sale_orders.settlement_fee IS
  'ค่าธรรมเนียม TikTok รวม (grand_total - net_received) จาก statement';
COMMENT ON COLUMN public.sale_orders.settlement_breakdown IS
  'รายการค่าธรรมเนียมแยกย่อย (commission, transaction fee, shipping subsidy ฯลฯ)';
