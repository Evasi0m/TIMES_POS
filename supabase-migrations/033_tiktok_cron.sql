-- 033_tiktok_cron.sql — pg_cron jobs for TikTok token refresh, settlement, poll

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.invoke_tiktok_edge(fn_name text, body jsonb DEFAULT '{}'::jsonb)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  project_url TEXT := 'https://zrymhhkqdcttqsdczfcr.supabase.co';
  service_jwt TEXT;
BEGIN
  SELECT decrypted_secret INTO service_jwt
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF service_jwt IS NULL THEN
    RAISE NOTICE 'service_role_key not in vault — skipping tiktok cron %', fn_name;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := project_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || service_jwt
    ),
    body    := body
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.invoke_tiktok_token_refresh()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.invoke_tiktok_edge('tiktok-token-refresh');
$$;

CREATE OR REPLACE FUNCTION public.invoke_tiktok_settlement_sync()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.invoke_tiktok_edge('tiktok-settlement-sync');
$$;

CREATE OR REPLACE FUNCTION public.invoke_tiktok_poll_orders()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.invoke_tiktok_edge('tiktok-poll-orders');
$$;

DO $$ BEGIN PERFORM cron.unschedule('tiktok-token-refresh'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('tiktok-token-refresh', '0 */12 * * *', $$ SELECT public.invoke_tiktok_token_refresh(); $$);

DO $$ BEGIN PERFORM cron.unschedule('tiktok-settlement-sync'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('tiktok-settlement-sync', '0 3 * * *', $$ SELECT public.invoke_tiktok_settlement_sync(); $$);

DO $$ BEGIN PERFORM cron.unschedule('tiktok-poll-orders'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('tiktok-poll-orders', '*/30 * * * *', $$ SELECT public.invoke_tiktok_poll_orders(); $$);
