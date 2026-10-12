-- 085_tiktok_image_refresh_cron.sql
-- Daily re-check of TikTok product photos (tiktok-product-image-backfill,
-- { refresh: true }): picks up photos the seller changed in Seller Center and
-- drops old listing-main-photo fallbacks on multi-SKU listings. Manual and
-- brand-site photos are never touched.
--
-- 04:10 Asia/Bangkok = 21:10 UTC, after settlement sync (03:00 UTC) and away
-- from shop hours. Uses invoke_tiktok_edge() from 072 (service_role_key in
-- vault). Idempotent.

DO $$ BEGIN PERFORM cron.unschedule('tiktok-image-refresh'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'tiktok-image-refresh',
  '10 21 * * *',
  $$ SELECT public.invoke_tiktok_edge('tiktok-product-image-backfill', '{"refresh": true}'::jsonb); $$
);
