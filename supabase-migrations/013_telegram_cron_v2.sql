-- Migration 013 — Re-point the hourly Telegram cron to `telegram-send`.
--
-- Why a new file (not editing 008):
--   pg_cron doesn't track migration provenance — the schedule lives in
--   `cron.job` keyed by name. We re-use the same name "daily-telegram-summary"
--   so this migration is a clean overwrite. The function URL is the only
--   change (now hits `telegram-send` with a `kind:cron` body instead of
--   the legacy `daily-telegram-summary` with an empty body).
--
-- Idempotent — `cron.unschedule` is wrapped in EXCEPTION-handling so
-- re-runs don't fail when the schedule is missing.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

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
  SELECT decrypted_secret INTO service_jwt
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF service_jwt IS NULL THEN
    RAISE NOTICE 'service_role_key not in vault — skipping telegram cron tick';
    RETURN;
  END IF;

  -- v2: hits `telegram-send` with `{"kind":"cron"}`. The function then
  -- fans out to daily / monthly / morning_brief based on configured hours
  -- and the master switches.
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

-- Drop & recreate the schedule under the same name so the cron entry
-- becomes a single source of truth (no stale legacy job).
DO $$
BEGIN
  PERFORM cron.unschedule('daily-telegram-summary');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'daily-telegram-summary',
  '0 * * * *',                 -- every hour at minute 0 (BKK = UTC+7)
  $$ SELECT public.invoke_daily_telegram_summary(); $$
);

COMMENT ON FUNCTION public.invoke_daily_telegram_summary() IS
  'v2 — Hourly cron tick. Calls telegram-send with kind:cron; that function checks each notification''s configured BKK hour against now and dispatches if due.';
