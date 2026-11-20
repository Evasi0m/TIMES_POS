-- 092_bigseller_catchup.sql
-- BigSeller export: stop losing stock changes, and recover the ones lost.
--
-- Lost so far (found 2026-11-20):
--   a) batches before the 2026-11-18 fix skipped TikTok/Shopee/Lazada sales
--   b) the manual "reset-2026-11-18" batch jumped the cursor, leaving
--      movements 17491–17576 in no batch at all
--   c) products without a SKU ("unresolved") were dropped: the cursor moved
--      past them and they were never sent later
--
-- Changes:
--   * bigseller_export_batches.kind        'normal' | 'catchup'
--   * bigseller_export_batches.carried_from normal batch whose unresolved
--     products this batch re-tried (carry-forward, fixes c going forward)
--   * cursor (state / record_batch) only follows 'normal' batches
--   * bigseller_record_catchup: one-off batch for a + b + old c
--
-- Super admin only, like 088. Idempotent.

ALTER TABLE public.bigseller_export_batches
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS carried_from bigint;

ALTER TABLE public.bigseller_export_batches DROP CONSTRAINT IF EXISTS bigseller_export_batches_kind_check;
ALTER TABLE public.bigseller_export_batches
  ADD CONSTRAINT bigseller_export_batches_kind_check CHECK (kind IN ('normal', 'catchup'));

-- At most one catch-up batch.
CREATE UNIQUE INDEX IF NOT EXISTS bigseller_export_batches_one_catchup
  ON public.bigseller_export_batches (kind) WHERE kind = 'catchup';

CREATE OR REPLACE FUNCTION public.bigseller_export_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'last_to_movement_id', (SELECT max(to_movement_id) FROM public.bigseller_export_batches WHERE kind = 'normal'),
    'last_batch_id',       (SELECT max(id) FROM public.bigseller_export_batches WHERE kind = 'normal'),
    'max_movement_id',     (SELECT COALESCE(max(id), 0) FROM public.stock_movements),
    'catchup_done',        EXISTS (SELECT 1 FROM public.bigseller_export_batches WHERE kind = 'catchup')
  );
$$;

-- record_batch gains p_carried_from → new signature; drop old wrapper + impl.
DROP FUNCTION IF EXISTS public.bigseller_record_batch(bigint, bigint, jsonb, jsonb, jsonb, text, text);
DROP FUNCTION IF EXISTS public.bigseller_record_batch__impl(bigint, bigint, jsonb, jsonb, jsonb, text, text);

CREATE OR REPLACE FUNCTION public.bigseller_record_batch(
  p_from         bigint,
  p_to           bigint,
  p_rows_in      jsonb,
  p_rows_out     jsonb,
  p_unresolved   jsonb,
  p_filename_in  text,
  p_filename_out text,
  p_carried_from bigint DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_last  bigint;
  v_lastb bigint;
  v_id    bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('bigseller_export_batches'));
  SELECT max(to_movement_id), max(id) INTO v_last, v_lastb
    FROM public.bigseller_export_batches WHERE kind = 'normal';
  IF v_last IS NOT NULL AND p_from <> v_last THEN
    RAISE EXCEPTION 'มีการ export ช่วงนี้ไปแล้ว (ล่าสุดถึง movement %) — โหลดใหม่แล้วลองอีกครั้ง', v_last
      USING ERRCODE = '40001';
  END IF;
  IF p_carried_from IS NOT NULL AND p_carried_from IS DISTINCT FROM v_lastb THEN
    RAISE EXCEPTION 'รอบก่อนหน้าเปลี่ยนไปแล้ว — โหลดใหม่แล้วลองอีกครั้ง' USING ERRCODE = '40001';
  END IF;
  IF p_to < p_from THEN
    RAISE EXCEPTION 'ช่วง movement ไม่ถูกต้อง' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bigseller_export_batches (
    created_by, created_by_email, from_movement_id, to_movement_id,
    in_rows, out_rows, unresolved_count, filename_in, filename_out,
    rows_in, rows_out, unresolved, kind, carried_from
  ) VALUES (
    auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()), p_from, p_to,
    jsonb_array_length(COALESCE(p_rows_in, '[]'::jsonb)),
    jsonb_array_length(COALESCE(p_rows_out, '[]'::jsonb)),
    jsonb_array_length(COALESCE(p_unresolved, '[]'::jsonb)),
    p_filename_in, p_filename_out,
    COALESCE(p_rows_in, '[]'::jsonb), COALESCE(p_rows_out, '[]'::jsonb), COALESCE(p_unresolved, '[]'::jsonb),
    'normal', p_carried_from
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- One-off catch-up batch. Does not move the cursor.
CREATE OR REPLACE FUNCTION public.bigseller_record_catchup(
  p_from         bigint,
  p_to           bigint,
  p_rows_in      jsonb,
  p_rows_out     jsonb,
  p_unresolved   jsonb,
  p_filename_in  text,
  p_filename_out text
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('bigseller_export_batches'));
  IF EXISTS (SELECT 1 FROM public.bigseller_export_batches WHERE kind = 'catchup') THEN
    RAISE EXCEPTION 'ทำรอบเก็บตกไปแล้ว — โหลดไฟล์เดิมได้จากรายการรอบ' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.bigseller_export_batches (
    created_by, created_by_email, from_movement_id, to_movement_id,
    in_rows, out_rows, unresolved_count, filename_in, filename_out,
    rows_in, rows_out, unresolved, kind
  ) VALUES (
    auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()), p_from, GREATEST(p_to, p_from),
    jsonb_array_length(COALESCE(p_rows_in, '[]'::jsonb)),
    jsonb_array_length(COALESCE(p_rows_out, '[]'::jsonb)),
    jsonb_array_length(COALESCE(p_unresolved, '[]'::jsonb)),
    p_filename_in, p_filename_out,
    COALESCE(p_rows_in, '[]'::jsonb), COALESCE(p_rows_out, '[]'::jsonb), COALESCE(p_unresolved, '[]'::jsonb),
    'catchup'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.bigseller_export_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bigseller_record_batch(bigint, bigint, jsonb, jsonb, jsonb, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bigseller_record_catchup(bigint, bigint, jsonb, jsonb, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bigseller_export_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bigseller_record_batch(bigint, bigint, jsonb, jsonb, jsonb, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bigseller_record_catchup(bigint, bigint, jsonb, jsonb, jsonb, text, text) TO authenticated;

INSERT INTO public.rpc_perm_guards (fn_name, perm, arg_name, arg_perms) VALUES
  ('bigseller_export_state',   'products.bigseller_export', NULL, NULL),
  ('bigseller_record_batch',   'products.bigseller_export', NULL, NULL),
  ('bigseller_record_catchup', 'products.bigseller_export', NULL, NULL)
ON CONFLICT (fn_name) DO UPDATE SET perm = EXCLUDED.perm;

SELECT public.apply_perm_guards();
