-- 028_suppliers_and_purchase_docs.sql
-- ทะเบียนผู้จำหน่าย (suppliers) + เอกสารซื้อ/ใบรับสินค้า (purchase document) เลขรันอัตโนมัติ.
--
-- บริษัทจด VAT แล้ว ต้องนำภาษีซื้อจากการรับสินค้าไปยื่นสรรพากร (ภ.พ.30) จึงต้องมี
-- ข้อมูลผู้จำหน่ายครบถ้วน + เอกสารซื้อที่พิมพ์ได้.

-- ====================================================================
-- 1. ตาราง suppliers (ทะเบียนผู้จำหน่าย — บันทึกใช้ซ้ำได้)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.suppliers (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- รายชื่อผู้ติดต่อ
  contact_type     text NOT NULL DEFAULT 'juristic' CHECK (contact_type IN ('juristic','individual')),
  location         text NOT NULL DEFAULT 'th'       CHECK (location IN ('th','foreign')),
  contact_code     text,
  business_name    text NOT NULL,   -- ชื่อธุรกิจ/ผู้ติดต่อ  ★
  address          text NOT NULL,   -- ที่อยู่              ★
  postal_code      text NOT NULL,   -- รหัสไปรษณีย์         ★
  tax_id           text NOT NULL,   -- เลขผู้เสียภาษี       ★
  branch_type      text NOT NULL DEFAULT 'head' CHECK (branch_type IN ('head','branch')), -- ★
  branch_code      text,
  credit_days      integer NOT NULL DEFAULT 0,
  -- รายละเอียดผู้ติดต่อ
  contact_person   text,
  email            text,
  phone            text,
  -- ข้อมูลธนาคาร
  bank_name        text,
  bank_account_name text,
  bank_account_no  text,
  bank_branch_code text,
  bank_branch_name text,
  bank_account_type text CHECK (bank_account_type IN ('savings','current') OR bank_account_type IS NULL),
  is_active        boolean NOT NULL DEFAULT true,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid
);

COMMENT ON TABLE public.suppliers IS 'ทะเบียนผู้จำหน่าย — ใช้ออกเอกสารซื้อ/ภ.พ.30. business_name/address/postal_code/tax_id/branch_type บังคับ.';

CREATE INDEX IF NOT EXISTS suppliers_business_name_idx ON public.suppliers (business_name);
CREATE INDEX IF NOT EXISTS suppliers_tax_id_idx        ON public.suppliers (tax_id);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_contact_code_uniq
  ON public.suppliers (contact_code) WHERE contact_code IS NOT NULL;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authenticated_read  ON public.suppliers;
DROP POLICY IF EXISTS authenticated_write ON public.suppliers;
CREATE POLICY authenticated_read  ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY authenticated_write ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.suppliers_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS suppliers_touch_updated_at ON public.suppliers;
CREATE TRIGGER suppliers_touch_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.suppliers_touch_updated_at();

-- ====================================================================
-- 2. คอลัมน์ใหม่ใน receive_orders
-- ====================================================================
ALTER TABLE public.receive_orders
  ADD COLUMN IF NOT EXISTS supplier_id           bigint REFERENCES public.suppliers(id),
  ADD COLUMN IF NOT EXISTS purchase_doc_no       text,
  ADD COLUMN IF NOT EXISTS purchase_doc_issued_at timestamptz;

COMMENT ON COLUMN public.receive_orders.supplier_id IS 'ลิงก์ทะเบียนผู้จำหน่าย (optional). supplier_name/supplier_tax_id ยัง denormalized ไว้.';
COMMENT ON COLUMN public.receive_orders.purchase_doc_no IS 'เลขที่เอกสารซื้อ/ใบรับสินค้า (รันอัตโนมัติต่อปี พ.ศ.).';

-- ====================================================================
-- 3. เลขรันเอกสารซื้อ
-- ====================================================================
ALTER TABLE public.shop_settings
  ADD COLUMN IF NOT EXISTS purchase_doc_prefix text DEFAULT 'RC';

CREATE TABLE IF NOT EXISTS public.purchase_doc_counters (
  be_year  smallint PRIMARY KEY,
  last_seq integer  NOT NULL DEFAULT 0
);
ALTER TABLE public.purchase_doc_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_doc_counters_read ON public.purchase_doc_counters;
CREATE POLICY purchase_doc_counters_read ON public.purchase_doc_counters FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.next_purchase_doc_no(p_date timestamptz DEFAULT now())
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_be_year smallint;
  v_seq     integer;
  v_prefix  text;
BEGIN
  v_be_year := (EXTRACT(YEAR FROM (p_date AT TIME ZONE 'Asia/Bangkok'))::int + 543) % 100;
  INSERT INTO public.purchase_doc_counters (be_year, last_seq)
  VALUES (v_be_year, 1)
  ON CONFLICT (be_year)
  DO UPDATE SET last_seq = public.purchase_doc_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;
  SELECT COALESCE(purchase_doc_prefix, 'RC') INTO v_prefix FROM public.shop_settings WHERE id = 1;
  IF v_prefix IS NULL THEN v_prefix := 'RC'; END IF;
  RETURN v_prefix || lpad(v_be_year::text, 2, '0') || lpad(v_seq::text, 5, '0');
END;
$$;
REVOKE ALL ON FUNCTION public.next_purchase_doc_no(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_purchase_doc_no(timestamptz) TO authenticated;

-- ====================================================================
-- 4. create_stock_movement_with_items — receive branch: supplier_id +
--    denormalize + auto purchase_doc_no. (claim/return เหมือนเดิม จาก 019)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.create_stock_movement_with_items(
  p_kind   text,
  p_header jsonb,
  p_items  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_header_table text;
  v_item_table   text;
  v_date_field   text;
  v_fk_field     text;
  v_stock_reason text;
  v_stock_sign   int;
  v_id           bigint;
  v_sql          text;
  v_header_row   jsonb;
  v_goods_ret    boolean;
  v_supplier_id  bigint;
  v_sup          public.suppliers%ROWTYPE;
  v_sup_name     text;
  v_sup_tax      text;
  v_recv_date    timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be a logged-in user' USING ERRCODE = '28000';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;

  CASE p_kind
    WHEN 'receive' THEN
      v_header_table := 'receive_orders'; v_item_table := 'receive_order_items';
      v_date_field := 'receive_date'; v_fk_field := 'receive_order_id';
      v_stock_reason := 'receive'; v_stock_sign := 1;
    WHEN 'claim' THEN
      v_header_table := 'supplier_claim_orders'; v_item_table := 'supplier_claim_order_items';
      v_date_field := 'claim_date'; v_fk_field := 'supplier_claim_order_id';
      v_stock_reason := 'supplier_claim'; v_stock_sign := -1;
    WHEN 'return' THEN
      v_header_table := 'return_orders'; v_item_table := 'return_order_items';
      v_date_field := 'return_date'; v_fk_field := 'return_order_id';
      v_stock_reason := 'return_in'; v_stock_sign := 1;
    ELSE
      RAISE EXCEPTION 'Unknown movement kind: %', p_kind USING ERRCODE = '22023';
  END CASE;

  IF p_kind = 'receive' THEN
    v_recv_date   := COALESCE((p_header->>'receive_date')::timestamptz, now());
    v_supplier_id := NULLIF(p_header->>'supplier_id','')::bigint;
    v_sup_name    := NULLIF(p_header->>'supplier_name','');
    v_sup_tax     := NULLIF(p_header->>'supplier_tax_id','');

    -- Denormalize from the suppliers registry when a supplier is linked and the
    -- client didn't override the name/tax id explicitly.
    IF v_supplier_id IS NOT NULL THEN
      SELECT * INTO v_sup FROM public.suppliers WHERE id = v_supplier_id;
      IF FOUND THEN
        v_sup_name := COALESCE(v_sup_name, v_sup.business_name);
        v_sup_tax  := COALESCE(v_sup_tax,  v_sup.tax_id);
      END IF;
    END IF;

    INSERT INTO public.receive_orders (
      receive_date, total_value, notes, vat_rate, vat_amount,
      supplier_name, supplier_invoice_no, supplier_tax_id, supplier_id
    ) VALUES (
      v_recv_date,
      COALESCE((p_header->>'total_value')::numeric, 0),
      NULLIF(p_header->>'notes',''),
      COALESCE((p_header->>'vat_rate')::numeric, 0),
      COALESCE((p_header->>'vat_amount')::numeric, 0),
      v_sup_name,
      NULLIF(p_header->>'supplier_invoice_no',''),
      v_sup_tax,
      v_supplier_id
    ) RETURNING id INTO v_id;

    IF p_header ? 'created_via' THEN
      UPDATE public.receive_orders
         SET created_via = COALESCE(p_header->>'created_via','manual')
       WHERE id = v_id;
    END IF;

    -- ออกเลขเอกสารซื้ออัตโนมัติทุกการรับเข้า (เว้นแต่ client ส่งมาเอง).
    IF NULLIF(p_header->>'purchase_doc_no','') IS NULL THEN
      UPDATE public.receive_orders
         SET purchase_doc_no = public.next_purchase_doc_no(v_recv_date),
             purchase_doc_issued_at = now()
       WHERE id = v_id;
    ELSE
      UPDATE public.receive_orders
         SET purchase_doc_no = p_header->>'purchase_doc_no',
             purchase_doc_issued_at = now()
       WHERE id = v_id;
    END IF;

  ELSIF p_kind = 'claim' THEN
    v_sql := format(
      'INSERT INTO %I (%I, total_value, notes, vat_rate, vat_amount, supplier_name, supplier_invoice_no, claim_reason) '
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
      v_header_table, v_date_field
    );
    EXECUTE v_sql INTO v_id USING
      COALESCE((p_header->>v_date_field)::timestamptz, now()),
      COALESCE((p_header->>'total_value')::numeric, 0),
      NULLIF(p_header->>'notes',''),
      COALESCE((p_header->>'vat_rate')::numeric, 0),
      COALESCE((p_header->>'vat_amount')::numeric, 0),
      NULLIF(p_header->>'supplier_name',''),
      NULLIF(p_header->>'supplier_invoice_no',''),
      NULLIF(p_header->>'claim_reason','');

  ELSE
    v_goods_ret := COALESCE((p_header->>'goods_returned')::boolean, true);
    EXECUTE format(
      'INSERT INTO %I (%I, total_value, notes, channel, return_reason, original_sale_order_id, goods_returned) '
      'VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      v_header_table, v_date_field
    ) INTO v_id USING
      COALESCE((p_header->>v_date_field)::timestamptz, now()),
      COALESCE((p_header->>'total_value')::numeric, 0),
      NULLIF(p_header->>'notes',''),
      COALESCE(p_header->>'channel','store'),
      NULLIF(p_header->>'return_reason',''),
      NULLIF(p_header->>'original_sale_order_id','')::bigint,
      v_goods_ret;
  END IF;

  EXECUTE format(
    'INSERT INTO %I (%I, product_id, product_name, quantity, unit, unit_price, '
    'discount1_value, discount1_type, discount2_value, discount2_type) '
    'SELECT $1, NULLIF(item->>''product_id'','''')::bigint, item->>''product_name'', '
    '       COALESCE((item->>''quantity'')::integer, 0), '
    '       item->>''unit'', '
    '       COALESCE((item->>''unit_price'')::numeric, 0), '
    '       COALESCE((item->>''discount1_value'')::numeric, 0), item->>''discount1_type'', '
    '       COALESCE((item->>''discount2_value'')::numeric, 0), item->>''discount2_type'' '
    'FROM jsonb_array_elements($2) AS item',
    v_item_table, v_fk_field
  ) USING v_id, p_items;

  IF NOT (p_kind = 'return' AND v_goods_ret IS FALSE) THEN
    PERFORM public.adjust_stock(
      p_id        => (item->>'product_id')::bigint,
      qty_delta   => (v_stock_sign * (item->>'quantity')::integer)::integer,
      p_reason    => v_stock_reason,
      p_ref_table => v_header_table,
      p_ref_id    => v_id
    )
    FROM jsonb_array_elements(p_items) AS item
    WHERE NULLIF(item->>'product_id','') IS NOT NULL;
  END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1', v_header_table)
    INTO v_header_row USING v_id;
  RETURN v_header_row;
END;
$$;
REVOKE ALL ON FUNCTION public.create_stock_movement_with_items(text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_stock_movement_with_items(text, jsonb, jsonb) TO authenticated;

-- ====================================================================
-- 5. issue_purchase_doc_for_receive — ออกเลขเอกสารซื้อย้อนหลังให้บิลเก่า
-- ====================================================================
CREATE OR REPLACE FUNCTION public.issue_purchase_doc_for_receive(p_receive_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_row public.receive_orders%ROWTYPE;
  v_no  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be logged in' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can issue purchase documents' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.receive_orders WHERE id = p_receive_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receive order % not found', p_receive_id USING ERRCODE = 'P0002';
  END IF;
  IF v_row.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot issue a purchase document for a voided receive' USING ERRCODE = '22023';
  END IF;
  IF v_row.purchase_doc_no IS NULL THEN
    v_no := public.next_purchase_doc_no(COALESCE(v_row.receive_date, now()));
    UPDATE public.receive_orders
       SET purchase_doc_no = v_no, purchase_doc_issued_at = now()
     WHERE id = p_receive_id
    RETURNING * INTO v_row;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_purchase_doc_for_receive(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_purchase_doc_for_receive(bigint) TO authenticated;
