-- 039_tiktok_exclude_from_pos_pending.sql
-- API-imported TikTok orders manage net in E-Commerce, not PendingNetBell.
UPDATE public.sale_orders
   SET net_received_pending = false
 WHERE tiktok_order_id IS NOT NULL
   AND net_received_pending = true;
