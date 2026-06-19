-- 074_telegram_cron_v2_fix.sql
-- Point invoke_daily_telegram_summary at telegram-send (kind:cron) per migration 013.
-- Migration 072 accidentally reverted to legacy daily-telegram-summary + empty body.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_daily_telegram_summary()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  project_url  TEXT := 'https://pxenybeudcsddsnkduaj.supabase.co';
  service_jwt  TEXT;
BEGIN
  SELECT decrypted_secret INTO service_jwt
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF service_jwt IS NULL THEN
    RAISE NOTICE 'service_role_key not in vault — skipping telegram cron tick';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := project_url || '/functions/v1/telegram-send',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || service_jwt
    ),
    body    := '{"kind":"cron"}'::jsonb
  );
END;
$$;

COMMENT ON FUNCTION public.invoke_daily_telegram_summary() IS
  'Hourly pg_cron tick ? telegram-send {kind:cron} ? daily/monthly dispatch by BKK hour.';

-- Ensure hourly schedule exists (idempotent).
DO $$
BEGIN
  PERFORM cron.unschedule('daily-telegram-summary');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'daily-telegram-summary',
  '0 * * * *',
  $$ SELECT public.invoke_daily_telegram_summary(); $$
);

-- Legacy helper from 072 — align with v2 endpoint (unused by cron but safe to fix).
CREATE OR REPLACE FUNCTION public.invoke_telegram_cron_tick()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  PERFORM public.invoke_daily_telegram_summary();
END;
$$;
