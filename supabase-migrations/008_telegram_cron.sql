-- Migration 008 — Schedule the daily Telegram summary edge function.
--
-- pg_cron fires every hour at :00. The edge function checks the user's
-- configured `daily_summary_hour` (Bangkok time) on each invocation and
-- skips if it doesn't match. This way the user can change the hour from
-- the UI without us having to update the cron schedule.
--
-- Why every hour instead of one fixed cron job per hour-of-day:
--   pg_cron schedules are static. Letting the edge function gate on the
--   configured hour means the UI dropdown "เวลาส่ง" works without DDL.
--
-- Note: The Supabase service-role key is required to invoke the function
-- when verify_jwt=true. We pull it from vault.decrypted_secrets — set it
-- once with: select vault.create_secret('<service_role_jwt>', 'service_role_key')

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

-- Helper that the cron job calls. Lives in private schema (cron-only).
CREATE OR REPLACE FUNCTION public.invoke_daily_telegram_summary()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  project_url  TEXT := 'https://zrymhhkqdcttqsdczfcr.supabase.co';
  service_jwt  TEXT;
BEGIN
  -- Read the service role JWT stashed in Vault. If missing, skip silently
  -- so we never log an error every hour for a misconfigured project.
  SELECT decrypted_secret INTO service_jwt
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF service_jwt IS NULL THEN
    RAISE NOTICE 'service_role_key not in vault — skipping daily summary cron tick';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := project_url || '/functions/v1/daily-telegram-summary',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || service_jwt
    ),
    body    := '{}'::jsonb
  );
END;
$$;

-- Idempotent schedule: drop & recreate.
DO $$
BEGIN
  PERFORM cron.unschedule('daily-telegram-summary');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'daily-telegram-summary',
  '0 * * * *',                 -- every hour at minute 0
  $$ SELECT public.invoke_daily_telegram_summary(); $$
);

COMMENT ON FUNCTION public.invoke_daily_telegram_summary() IS
  'Called hourly by pg_cron. The edge function gates on the configured Bangkok hour and the master switch.';
