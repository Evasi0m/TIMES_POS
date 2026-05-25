-- Migration 015 — AI bill-scan feature (CMG invoice OCR via Gemini).
--
-- 1. shop_secrets gains two columns:
--      gemini_api_key       — admin-only key stored alongside Telegram secrets.
--      ai_bill_scan_enabled — master switch; UI hides the scan button if off.
--    Both protected by the existing admin_only_all RLS policy on shop_secrets
--    (see migration 007), so cashiers can never read the key.
--
-- 2. ai_usage_log — per-call audit trail: which user, which feature, token
--    counts, USD/THB cost snapshot, OK/error. Read = self-or-admin. Insert
--    is service_role-only (no client policy) — only the Edge Function ever
--    writes, so we don't need to gate by user.
--
-- Idempotent — safe to re-run.

-- ============================================================
-- 1. shop_secrets — Gemini key + master switch
-- ============================================================
ALTER TABLE public.shop_secrets
  ADD COLUMN IF NOT EXISTS gemini_api_key       TEXT,
  ADD COLUMN IF NOT EXISTS ai_bill_scan_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.shop_secrets.gemini_api_key IS
  'Google AI Studio API key. Admin-only via existing shop_secrets RLS. Read by cmg-bill-parse edge fn via service_role.';
COMMENT ON COLUMN public.shop_secrets.ai_bill_scan_enabled IS
  'Master switch — hides the "AI scan bill" button when false (budget kill switch).';

-- ============================================================
-- 2. ai_usage_log — per-call audit of AI feature usage
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id               BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  feature          TEXT NOT NULL CHECK (feature IN ('cmg_bill_scan')),
  model            TEXT NOT NULL,
  prompt_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  total_tokens     INTEGER GENERATED ALWAYS AS (prompt_tokens + output_tokens) STORED,
  estimated_usd    NUMERIC(10,6) NOT NULL DEFAULT 0,
  estimated_thb    NUMERIC(10,4) NOT NULL DEFAULT 0,
  receive_order_id BIGINT REFERENCES public.receive_orders(id) ON DELETE SET NULL,
  ok               BOOLEAN NOT NULL DEFAULT true,
  error_message    TEXT
);

COMMENT ON TABLE public.ai_usage_log IS
  'Per-call AI feature audit. Inserted only by service_role (Edge Functions). Read by owning user or admins.';
COMMENT ON COLUMN public.ai_usage_log.estimated_usd IS
  'Snapshot of cost at call time. May drift from current pricing — that is the point (historical).';
COMMENT ON COLUMN public.ai_usage_log.receive_order_id IS
  'Optional back-reference to the receive_orders row the scan ended up creating (patched post-save).';

CREATE INDEX IF NOT EXISTS ai_usage_log_created_at_idx ON public.ai_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_log_user_id_idx    ON public.ai_usage_log (user_id);
CREATE INDEX IF NOT EXISTS ai_usage_log_feature_idx    ON public.ai_usage_log (feature, created_at DESC);

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

-- Self-read OR admin-read. No client INSERT/UPDATE/DELETE policy — only the
-- Edge Function (service_role) writes; service_role bypasses RLS entirely.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.ai_usage_log'::regclass AND polname = 'ai_usage_self_or_admin_read'
  ) THEN
    CREATE POLICY ai_usage_self_or_admin_read ON public.ai_usage_log
      FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR public.is_admin());
  END IF;
END $$;
