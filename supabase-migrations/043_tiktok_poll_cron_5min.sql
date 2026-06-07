-- 043_tiktok_poll_cron_5min.sql — poll TikTok orders every 5 minutes (was 30)

DO $$ BEGIN PERFORM cron.unschedule('tiktok-poll-orders'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('tiktok-poll-orders', '*/5 * * * *', $$ SELECT public.invoke_tiktok_poll_orders(); $$);
