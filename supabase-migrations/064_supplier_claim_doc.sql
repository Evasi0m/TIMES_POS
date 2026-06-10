-- 064_supplier_claim_doc.sql
-- Printable A4 for supplier claims / returns-to-supplier (ใบส่งคืนสินค้า / ใบลดหนี้ซื้อ).
-- The shop issues this to a supplier when sending goods back; it mirrors the
-- credit-note numbering infra (migration 030) but for supplier_claim_orders.

ALTER TABLE public.supplier_claim_orders
  ADD COLUMN IF NOT EXISTS claim_doc_no        text,
  ADD COLUMN IF NOT EXISTS claim_doc_issued_at timestamptz;
COMMENT ON COLUMN public.supplier_claim_orders.claim_doc_no IS
  'เลขที่เอกสารส่งคืน/เคลม (ใบลดหนี้ซื้อ) รันต่อปี พ.ศ.';

ALTER TABLE public.shop_settings
  ADD COLUMN IF NOT EXISTS claim_doc_prefix text DEFAULT 'RT';

CREATE TABLE IF NOT EXISTS public.claim_doc_counters (
  be_year  smallint PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);
ALTER TABLE public.claim_doc_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS claim_doc_counters_read ON public.claim_doc_counters;
CREATE POLICY claim_doc_counters_read ON public.claim_doc_counters
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.next_claim_doc_no(p_date timestamptz DEFAULT now())
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_be_year smallint; v_seq integer; v_prefix text;
BEGIN
  v_be_year := (EXTRACT(YEAR FROM (p_date AT TIME ZONE 'Asia/Bangkok'))::int + 543) % 100;
  INSERT INTO public.claim_doc_counters (be_year, last_seq) VALUES (v_be_year, 1)
  ON CONFLICT (be_year) DO UPDATE SET last_seq = public.claim_doc_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;
  SELECT COALESCE(claim_doc_prefix, 'RT') INTO v_prefix FROM public.shop_settings WHERE id = 1;
  IF v_prefix IS NULL THEN v_prefix := 'RT'; END IF;
  RETURN v_prefix || lpad(v_be_year::text, 2, '0') || lpad(v_seq::text, 5, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_claim_doc_no(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_claim_doc_no(timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_claim_doc_for_claim(p_claim_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_row public.supplier_claim_orders%ROWTYPE; v_no text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be logged in' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can issue claim documents' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.supplier_claim_orders WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier claim % not found', p_claim_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot issue a document for a voided claim' USING ERRCODE = '22023';
  END IF;
  IF v_row.claim_doc_no IS NULL THEN
    v_no := public.next_claim_doc_no(COALESCE(v_row.claim_date, now()));
    UPDATE public.supplier_claim_orders SET claim_doc_no = v_no, claim_doc_issued_at = now()
     WHERE id = p_claim_id RETURNING * INTO v_row;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_claim_doc_for_claim(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_claim_doc_for_claim(bigint) TO authenticated;
