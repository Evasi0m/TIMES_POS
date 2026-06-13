-- 069_stock_export_logs.sql
-- Audit trail for Products stock CSV exports.
--   * Any authenticated user can log their own export via RPC.
--   * Only super_admin can read history (RLS + is_super_admin()).

CREATE TABLE IF NOT EXISTS public.stock_export_logs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exported_at     timestamptz NOT NULL DEFAULT now(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  exporter_email  text NOT NULL,
  exporter_name   text,
  scope           text NOT NULL CHECK (scope IN ('all', 'seiko', 'alba', 'citizen', 'casio', 'other')),
  scope_label     text NOT NULL,
  row_count       int NOT NULL CHECK (row_count >= 0),
  shop_name       text,
  filename        text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_export_logs_exported_at_idx
  ON public.stock_export_logs (exported_at DESC);

CREATE INDEX IF NOT EXISTS stock_export_logs_user_id_idx
  ON public.stock_export_logs (user_id);

ALTER TABLE public.stock_export_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_export_logs_select ON public.stock_export_logs;
CREATE POLICY stock_export_logs_select ON public.stock_export_logs
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

REVOKE ALL ON TABLE public.stock_export_logs FROM PUBLIC;
GRANT SELECT ON TABLE public.stock_export_logs TO authenticated;

-- Insert only via SECURITY DEFINER RPC (binds user_id to auth.uid()).
CREATE OR REPLACE FUNCTION public.log_stock_export(
  p_exporter_email text,
  p_exporter_name  text,
  p_scope          text,
  p_scope_label    text,
  p_row_count      int,
  p_shop_name      text,
  p_filename       text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id bigint;
  v_scope text := lower(trim(coalesce(p_scope, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_scope NOT IN ('all', 'seiko', 'alba', 'citizen', 'casio', 'other') THEN
    RAISE EXCEPTION 'Invalid scope' USING ERRCODE = '22023';
  END IF;
  IF p_row_count IS NULL OR p_row_count < 0 THEN
    RAISE EXCEPTION 'Invalid row_count' USING ERRCODE = '22023';
  END IF;
  IF coalesce(trim(p_filename), '') = '' THEN
    RAISE EXCEPTION 'filename required' USING ERRCODE = '22023';
  END IF;
  IF coalesce(trim(p_exporter_email), '') = '' THEN
    RAISE EXCEPTION 'exporter_email required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.stock_export_logs (
    user_id,
    exporter_email,
    exporter_name,
    scope,
    scope_label,
    row_count,
    shop_name,
    filename
  ) VALUES (
    auth.uid(),
    lower(trim(p_exporter_email)),
    nullif(trim(p_exporter_name), ''),
    v_scope,
    coalesce(nullif(trim(p_scope_label), ''), v_scope),
    p_row_count,
    nullif(trim(p_shop_name), ''),
    trim(p_filename)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_stock_export(text, text, text, text, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_stock_export(text, text, text, text, int, text, text) TO authenticated;
