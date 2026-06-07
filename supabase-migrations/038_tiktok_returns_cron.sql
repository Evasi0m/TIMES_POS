-- 038_tiktok_returns_cron.sql — schedule TikTok returns/refund sync

CREATE OR REPLACE FUNCTION public.invoke_tiktok_returns_sync()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.invoke_tiktok_edge('tiktok-returns-sync', '{"hours":168}'::jsonb);
$$;

DO $$ BEGIN PERFORM cron.unschedule('tiktok-returns-sync'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('tiktok-returns-sync', '15 */6 * * *', $$ SELECT public.invoke_tiktok_returns_sync(); $$);
