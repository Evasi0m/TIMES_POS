-- Migration 012 — Telegram bot v2 (multi-notification + webhook).
--
-- Extends `shop_secrets` (007) so one row holds the config for:
--   - daily summary       (existing, columns renamed)
--   - monthly summary     (new — sent on the 1st)
--   - morning brief       (new — MTD + low-stock list)
--   - two-way bot webhook (new — `webhook_secret` for setWebhook auth)
--
-- Backward compat: legacy columns `daily_summary_enabled` /
-- `daily_summary_hour` are kept (deprecated) and back-filled into the
-- new columns. They can be dropped in a later migration once the new
-- code has been live for a while.
--
-- Idempotent.

ALTER TABLE public.shop_secrets
  ADD COLUMN IF NOT EXISTS daily_enabled        BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_hour           SMALLINT NOT NULL DEFAULT 21
    CHECK (daily_hour BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS monthly_enabled      BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS monthly_hour         SMALLINT NOT NULL DEFAULT 9
    CHECK (monthly_hour BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS morning_enabled      BOOLEAN  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS morning_hour         SMALLINT NOT NULL DEFAULT 8
    CHECK (morning_hour BETWEEN 0 AND 23),
  ADD COLUMN IF NOT EXISTS low_stock_threshold  SMALLINT NOT NULL DEFAULT 3
    CHECK (low_stock_threshold BETWEEN 0 AND 999),
  ADD COLUMN IF NOT EXISTS webhook_secret       TEXT,
  ADD COLUMN IF NOT EXISTS last_monthly_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_brief_sent_at   TIMESTAMPTZ;

-- Back-fill new columns from the legacy ones (only if legacy still exists).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shop_secrets'
      AND column_name = 'daily_summary_enabled'
  ) THEN
    UPDATE public.shop_secrets
       SET daily_enabled = COALESCE(daily_summary_enabled, daily_enabled),
           daily_hour    = COALESCE(daily_summary_hour, daily_hour)
     WHERE id = 1;
  END IF;
END $$;

-- Seed `webhook_secret` once (32 random bytes hex-encoded). Idempotent:
-- only sets when NULL, so re-running keeps the existing secret.
UPDATE public.shop_secrets
   SET webhook_secret = encode(extensions.gen_random_bytes(32), 'hex')
 WHERE id = 1 AND webhook_secret IS NULL;

COMMENT ON COLUMN public.shop_secrets.daily_enabled        IS 'Master switch — daily summary at daily_hour BKK.';
COMMENT ON COLUMN public.shop_secrets.monthly_enabled      IS 'Master switch — monthly summary on day-1 at monthly_hour BKK.';
COMMENT ON COLUMN public.shop_secrets.morning_enabled      IS 'Master switch — morning brief every day at morning_hour BKK.';
COMMENT ON COLUMN public.shop_secrets.low_stock_threshold  IS 'Stock <= this value shows up in morning brief and /lowstock.';
COMMENT ON COLUMN public.shop_secrets.webhook_secret       IS 'Random secret. Sent in X-Telegram-Bot-Api-Secret-Token; verified by telegram-webhook function.';
