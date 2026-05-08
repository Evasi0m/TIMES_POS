-- Migration 007 — Telegram bot settings (admin-only).
--
-- Why a separate table (not on shop_settings):
--   The existing `shop_settings` is readable by every authenticated user
--   so the cashier app can render shop_name / address / receipt_footer.
--   PostgREST + RLS work at row granularity, not column — there is no
--   clean way to hide the bot token column from cashiers while keeping
--   the rest of the row visible. Splitting it into `shop_secrets` with a
--   strict admin-only RLS policy is the right boundary.
--
--   Edge Function reads via service_role key (bypasses RLS).
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.shop_secrets (
  id                     SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  telegram_bot_token     TEXT,
  telegram_chat_id       TEXT,
  daily_summary_enabled  BOOLEAN NOT NULL DEFAULT false,
  daily_summary_hour     SMALLINT NOT NULL DEFAULT 21
    CHECK (daily_summary_hour BETWEEN 0 AND 23),
  last_summary_sent_at   TIMESTAMPTZ,
  last_summary_error     TEXT,
  updated_at             TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.shop_secrets IS 'Admin-only sensitive settings (Telegram bot token, schedule, last status).';
COMMENT ON COLUMN public.shop_secrets.telegram_bot_token IS 'Bot token from @BotFather. Strictly admin-only via RLS.';
COMMENT ON COLUMN public.shop_secrets.telegram_chat_id   IS 'Chat ID where the daily summary is sent.';

-- Seed the singleton row so UPSERT-style updates work without a first INSERT.
INSERT INTO public.shop_secrets (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- RLS: only admins (per `is_admin()` from migration 005) can read or write.
-- The Edge Function uses service_role (bypasses RLS) so cron runs are fine.
ALTER TABLE public.shop_secrets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.shop_secrets'::regclass AND polname = 'admin_only_all'
  ) THEN
    CREATE POLICY admin_only_all ON public.shop_secrets
      FOR ALL TO authenticated
      USING (is_admin())
      WITH CHECK (is_admin());
  END IF;
END $$;

-- Convenience trigger: bump updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION public.shop_secrets_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS shop_secrets_updated_at ON public.shop_secrets;
CREATE TRIGGER shop_secrets_updated_at
  BEFORE UPDATE ON public.shop_secrets
  FOR EACH ROW EXECUTE FUNCTION public.shop_secrets_touch_updated_at();

-- Cleanup: if migration 007 was previously applied to shop_settings,
-- drop those columns. Idempotent: IF EXISTS is silent on missing cols.
ALTER TABLE public.shop_settings
  DROP COLUMN IF EXISTS telegram_bot_token,
  DROP COLUMN IF EXISTS telegram_chat_id,
  DROP COLUMN IF EXISTS daily_summary_enabled,
  DROP COLUMN IF EXISTS daily_summary_hour,
  DROP COLUMN IF EXISTS last_summary_sent_at,
  DROP COLUMN IF EXISTS last_summary_error;
