-- Migration 016 — Multi-key pool for Gemini API, with per-key RPD tracking.
--
-- Context: the free tier of Google AI Studio has a daily Requests-Per-Day
-- cap (~250 RPD for 2.5-flash, ~20 for 3-flash-preview at the time of
-- writing). A single busy day of bill scanning can burn through one key's
-- quota easily. We previously stored ONE key in `shop_secrets.gemini_api_key`;
-- now we let admins register N keys with priority-ordered fallback, and
-- display today's RPD usage per key so they can see which is "hot".
--
-- Design:
--   1. `ai_api_keys` — one row per key, admin-only RLS, ordered by
--      `priority ASC` (lower = tried first). `label` is a user nickname
--      so you can tell your personal vs. business keys apart in the UI.
--      `rpd_limit` is purely cosmetic (drives the progress bar); Google
--      enforces the real limit server-side, and it changes over time as
--      they tune pricing — so we don't want to bake a hard number into
--      app logic.
--   2. `last_used_at` / `last_error` / `last_error_at` — updated by the
--      Edge Function after each attempt so the UI can show "just hit
--      quota 2 min ago" instead of making the operator guess.
--   3. `ai_usage_log.api_key_id` — retroactively added. NULL for
--      pre-migration rows (we genuinely don't know which key they used).
--      Indexed by (api_key_id, created_at) to make "today's RPD per key"
--      a fast index-only scan.
--   4. Data migration: if `shop_secrets.gemini_api_key` is set, seed the
--      first row of ai_api_keys with it at priority=0, labeled
--      "Primary (migrated)". `shop_secrets.gemini_api_key` is kept
--      untouched for now — the Edge Function reads from the new table,
--      but leaving the old column in place means an emergency rollback
--      to the v5 function keeps working. Drop it in a later migration
--      once v6+ has been stable for a while.
--
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. ai_api_keys — the key pool itself
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label         TEXT NOT NULL DEFAULT '',
  api_key       TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 0,
  disabled      BOOLEAN NOT NULL DEFAULT false,
  rpd_limit     INTEGER NOT NULL DEFAULT 250,
  last_used_at  TIMESTAMPTZ,
  last_error    TEXT,
  last_error_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_api_keys IS
  'Admin-managed pool of Gemini API keys. Edge Functions try them in priority order, falling back on 429/5xx.';
COMMENT ON COLUMN public.ai_api_keys.priority IS
  'Lower = tried first. Ties broken by created_at ASC so insertion order is stable.';
COMMENT ON COLUMN public.ai_api_keys.rpd_limit IS
  'Cosmetic only — drives the "47/250 RPD today" progress bar in the UI. Google enforces the real limit.';
COMMENT ON COLUMN public.ai_api_keys.last_error IS
  'Short description of the most recent failure (e.g. "quota exhausted", "revoked key"). Cleared on any success.';

CREATE INDEX IF NOT EXISTS ai_api_keys_priority_idx
  ON public.ai_api_keys (priority, created_at)
  WHERE disabled = false;

-- RLS: admin-only, mirroring shop_secrets.
ALTER TABLE public.ai_api_keys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.ai_api_keys'::regclass AND polname = 'admin_only_all'
  ) THEN
    CREATE POLICY admin_only_all ON public.ai_api_keys
      FOR ALL TO authenticated
      USING (public.is_admin())
      WITH CHECK (public.is_admin());
  END IF;
END $$;

-- updated_at touch trigger, same pattern as shop_secrets.
CREATE OR REPLACE FUNCTION public.ai_api_keys_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS ai_api_keys_updated_at ON public.ai_api_keys;
CREATE TRIGGER ai_api_keys_updated_at
  BEFORE UPDATE ON public.ai_api_keys
  FOR EACH ROW EXECUTE FUNCTION public.ai_api_keys_touch_updated_at();

-- ============================================================
-- 2. ai_usage_log — link each log row to the key that produced it
-- ============================================================
ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS api_key_id UUID
    REFERENCES public.ai_api_keys(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ai_usage_log.api_key_id IS
  'Which key produced this log entry. NULL for rows written before migration 016, or for calls that failed before a key was selected.';

CREATE INDEX IF NOT EXISTS ai_usage_log_api_key_id_created_idx
  ON public.ai_usage_log (api_key_id, created_at DESC)
  WHERE ok = true;

-- ============================================================
-- 3. Seed: migrate existing single key from shop_secrets
-- ============================================================
-- Only seeds if (a) shop_secrets has a key AND (b) ai_api_keys is still
-- empty — the second guard protects against accidental double-runs that
-- would otherwise create duplicate rows.
INSERT INTO public.ai_api_keys (label, api_key, priority)
SELECT 'Primary (migrated)', s.gemini_api_key, 0
FROM public.shop_secrets s
WHERE s.id = 1
  AND s.gemini_api_key IS NOT NULL
  AND s.gemini_api_key <> ''
  AND NOT EXISTS (SELECT 1 FROM public.ai_api_keys);
