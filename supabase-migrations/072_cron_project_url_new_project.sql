-- 072_cron_project_url_new_project.sql
-- Point pg_cron HTTP invokers at the migrated Supabase project URL.
-- Applied on NEW project after schema clone (033/008/013 hardcode the old ref).

CREATE OR REPLACE FUNCTION public.invoke_tiktok_edge(fn_name text, body jsonb DEFAULT '{}'::jsonb)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  project_url TEXT := 'https://pxenybeudcsddsnkduaj.supabase.co';
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

-- telegram v2 cron helper (013) — same project_url patch
CREATE OR REPLACE FUNCTION public.invoke_telegram_cron_tick()
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
    url     := project_url || '/functions/v1/daily-telegram-summary',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || service_jwt
    ),
    body    := '{}'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.invoke_tiktok_returns_sync()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.invoke_tiktok_edge('tiktok-returns-sync');
$$;
