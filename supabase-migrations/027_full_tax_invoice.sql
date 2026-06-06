-- 027_full_tax_invoice.sql
-- Full Thai tax invoice (ใบกำกับภาษีแบบเต็มรูป, ป.รัษฎากร ม.86/4) support.
--
-- บริษัท ไทมส์สโตร์ จำกัด จดทะเบียน VAT (ภ.พ.01 ลงวันที่ 5 มิ.ย. 2569) จึงต้อง
-- ออกใบกำกับภาษีให้ทุกการขาย. งานนี้เพิ่ม:
--   1. เลขที่ใบกำกับภาษีแบบรันอัตโนมัติต่อปี พ.ศ. (atomic, gap-free, ไม่ซ้ำ)
--   2. ฟิลด์ "สำนักงานใหญ่/สาขา" ของผู้ขาย (shop_settings) และผู้ซื้อ (sale_orders)
--   3. ออกเลขให้ "ทุกบิล" อัตโนมัติตอนสร้างบิล (create_sale_order_with_items v4)
--   4. ออกใบกำกับเต็มรูปย้อนหลังให้บิลเก่า (issue_tax_invoice_for_order)
--   5. seed ข้อมูลบริษัทจริงลง shop_settings
--
-- รูปแบบเลข: <prefix?><YY พ.ศ. 2 หลัก><รัน N หลัก รีเซ็ตรายปี> เช่น 6900001
-- ความกว้างเลขรัน (digits) อยู่ใน shop_settings.tax_invoice_digits (default 5 = 99,999/ปี;
-- ปรับเป็น 6 ได้ถ้ายอดบิลต่อปีใกล้แตะเพดาน โดยไม่ต้องแก้โค้ด).

-- ====================================================================
-- 1. คอลัมน์ใหม่: shop_settings (ข้อมูลผู้ขาย + รูปแบบเลขใบกำกับ)
-- ====================================================================
ALTER TABLE public.shop_settings
  ADD COLUMN IF NOT EXISTS shop_branch         text    DEFAULT 'สำนักงานใหญ่',
  ADD COLUMN IF NOT EXISTS tax_invoice_prefix  text,
  ADD COLUMN IF NOT EXISTS tax_invoice_digits  smallint DEFAULT 5
    CHECK (tax_invoice_digits BETWEEN 3 AND 9);

COMMENT ON COLUMN public.shop_settings.shop_branch IS
  'สำนักงานใหญ่/สาขา ของผู้ขาย — พิมพ์บนใบกำกับภาษีเต็มรูป (ม.86/4).';
COMMENT ON COLUMN public.shop_settings.tax_invoice_prefix IS
  'Prefix นำหน้าเลขใบกำกับภาษี (NULL = ไม่มี). เช่น "INV-".';
COMMENT ON COLUMN public.shop_settings.tax_invoice_digits IS
  'จำนวนหลักของเลขรันต่อปี (zero-padded). 5 = สูงสุด 99,999 บิล/ปี.';

-- ====================================================================
-- 2. คอลัมน์ใหม่: sale_orders (ข้อมูลผู้ซื้อเพิ่มเติม + เวลาออกเลข)
-- ====================================================================
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS buyer_branch          text,
  ADD COLUMN IF NOT EXISTS tax_invoice_issued_at timestamptz;

COMMENT ON COLUMN public.sale_orders.buyer_branch IS
  'สำนักงานใหญ่/สาขา ของผู้ซื้อ (กรณีนิติบุคคล) — พิมพ์บนใบกำกับภาษีเต็มรูป.';
COMMENT ON COLUMN public.sale_orders.tax_invoice_issued_at IS
  'เวลาที่ออกเลขใบกำกับภาษี (tax_invoice_no). ต่างจาก sale_date เมื่อออกย้อนหลัง.';

-- ====================================================================
-- 3. ตัวนับเลขรันต่อปี พ.ศ.
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.tax_invoice_counters (
  be_year  smallint PRIMARY KEY,   -- พ.ศ. 2 หลัก เช่น 69
  last_seq integer  NOT NULL DEFAULT 0
);

ALTER TABLE public.tax_invoice_counters ENABLE ROW LEVEL SECURITY;

-- อ่านได้สำหรับผู้ล็อกอิน (โชว์เลขล่าสุด/รายงาน); การเขียนทำผ่าน SECURITY DEFINER
-- function เท่านั้น (ไม่มี policy ให้ INSERT/UPDATE ตรง ๆ).
DROP POLICY IF EXISTS tax_invoice_counters_read ON public.tax_invoice_counters;
CREATE POLICY tax_invoice_counters_read
  ON public.tax_invoice_counters FOR SELECT
  TO authenticated
  USING (true);

-- ====================================================================
-- 4. next_tax_invoice_no(p_date) — ออกเลขถัดไปแบบ atomic gap-free
-- ====================================================================
CREATE OR REPLACE FUNCTION public.next_tax_invoice_no(p_date timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_be_year smallint;
  v_seq     integer;
  v_prefix  text;
  v_digits  smallint;
BEGIN
  -- พ.ศ. 2 หลัก ตามเวลาไทย: 2026 → 2569 → 69
  v_be_year := (EXTRACT(YEAR FROM (p_date AT TIME ZONE 'Asia/Bangkok'))::int + 543) % 100;

  -- เพิ่มตัวนับแบบ atomic: row lock ผ่าน ON CONFLICT DO UPDATE กันชนกันตอน insert พร้อมกัน
  INSERT INTO public.tax_invoice_counters (be_year, last_seq)
  VALUES (v_be_year, 1)
  ON CONFLICT (be_year)
  DO UPDATE SET last_seq = public.tax_invoice_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  SELECT COALESCE(tax_invoice_prefix, ''), COALESCE(tax_invoice_digits, 5)
    INTO v_prefix, v_digits
  FROM public.shop_settings WHERE id = 1;

  IF v_digits IS NULL THEN v_digits := 5; END IF;

  RETURN v_prefix
       || lpad(v_be_year::text, 2, '0')
       || lpad(v_seq::text, v_digits, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_tax_invoice_no(timestamptz) FROM PUBLIC;
-- เรียกได้เฉพาะจาก SECURITY DEFINER RPC อื่น ๆ (create/issue) — ไม่ grant ให้ client ตรง ๆ
GRANT EXECUTE ON FUNCTION public.next_tax_invoice_no(timestamptz) TO authenticated;

-- ====================================================================
-- 5. create_sale_order_with_items v4 — ออกเลขใบกำกับให้ทุกบิลอัตโนมัติ
--    (เหมือน v3 ทุกอย่าง + buyer_branch + auto tax_invoice_no)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.create_sale_order_with_items(
  p_header jsonb,
  p_items  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_order_id   bigint;
  v_order_row  sale_orders%ROWTYPE;
  v_item       jsonb;
  v_tax_no     text;
  v_sale_date  timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be a logged-in user' USING ERRCODE = '28000';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;

  v_sale_date := COALESCE((p_header->>'sale_date')::timestamptz, now());

  INSERT INTO sale_orders (
    sale_date, channel, payment_method,
    discount_value, discount_type,
    subtotal, total_after_discount, grand_total,
    vat_rate, vat_amount, price_includes_vat,
    tax_invoice_no, buyer_name, buyer_tax_id, buyer_address, buyer_branch,
    notes, net_received
  )
  SELECT
    v_sale_date,
    p_header->>'channel',
    p_header->>'payment_method',
    COALESCE((p_header->>'discount_value')::numeric, 0),
    p_header->>'discount_type',
    COALESCE((p_header->>'subtotal')::numeric, 0),
    COALESCE((p_header->>'total_after_discount')::numeric, 0),
    COALESCE((p_header->>'grand_total')::numeric, 0),
    COALESCE((p_header->>'vat_rate')::numeric, 7),
    COALESCE((p_header->>'vat_amount')::numeric, 0),
    COALESCE((p_header->>'price_includes_vat')::boolean, true),
    NULLIF(p_header->>'tax_invoice_no', ''),
    NULLIF(p_header->>'buyer_name', ''),
    NULLIF(p_header->>'buyer_tax_id', ''),
    NULLIF(p_header->>'buyer_address', ''),
    NULLIF(p_header->>'buyer_branch', ''),
    NULLIF(p_header->>'notes', ''),
    NULLIF(p_header->>'net_received', '')::numeric
  RETURNING id INTO v_order_id;

  -- ออกเลขใบกำกับภาษีอัตโนมัติให้ทุกบิล (เว้นแต่ client ส่งเลขมาเอง).
  -- ใช้ sale_date เป็นฐานปี เพื่อให้เลขรันสอดคล้องปีของบิล.
  IF NULLIF(p_header->>'tax_invoice_no', '') IS NULL THEN
    v_tax_no := public.next_tax_invoice_no(v_sale_date);
    UPDATE sale_orders
       SET tax_invoice_no = v_tax_no,
           tax_invoice_issued_at = now()
     WHERE id = v_order_id;
  END IF;

  -- Items insert: cost_price snapshot via LEFT JOIN to products (เหมือน v3).
  INSERT INTO sale_order_items (
    sale_order_id, product_id, product_name,
    quantity, unit_price, display_unit_price,
    discount1_value, discount1_type,
    discount2_value, discount2_type,
    cost_price
  )
  SELECT
    v_order_id,
    pid,
    item->>'product_name',
    COALESCE((item->>'quantity')::integer, 0),
    COALESCE((item->>'unit_price')::numeric, 0),
    NULLIF(item->>'display_unit_price','')::numeric,
    COALESCE((item->>'discount1_value')::numeric, 0),
    item->>'discount1_type',
    COALESCE((item->>'discount2_value')::numeric, 0),
    item->>'discount2_type',
    COALESCE(
      NULLIF(item->>'cost_price','')::numeric,
      p.cost_price
    )
  FROM jsonb_array_elements(p_items) AS item
  CROSS JOIN LATERAL (SELECT NULLIF(item->>'product_id','')::bigint AS pid) ids
  LEFT JOIN products p ON p.id = ids.pid;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF NULLIF(v_item->>'product_id','') IS NOT NULL THEN
      PERFORM public.adjust_stock(
        p_id        => (v_item->>'product_id')::bigint,
        qty_delta   => -((v_item->>'quantity')::integer),
        p_reason    => 'sale',
        p_ref_table => 'sale_orders',
        p_ref_id    => v_order_id
      );
    END IF;
  END LOOP;

  SELECT * INTO v_order_row FROM sale_orders WHERE id = v_order_id;
  RETURN to_jsonb(v_order_row);
END;
$$;

REVOKE ALL ON FUNCTION public.create_sale_order_with_items(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_sale_order_with_items(jsonb, jsonb) TO authenticated;

-- ====================================================================
-- 6. issue_tax_invoice_for_order — ออก/อัปเดตใบกำกับเต็มรูปย้อนหลัง
-- ====================================================================
CREATE OR REPLACE FUNCTION public.issue_tax_invoice_for_order(
  p_order_id bigint,
  p_buyer    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_order_row sale_orders%ROWTYPE;
  v_tax_no    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be logged in' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can issue tax invoices' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order_row FROM sale_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;
  IF v_order_row.status = 'voided' THEN
    RAISE EXCEPTION 'Cannot issue a tax invoice for a voided sale order' USING ERRCODE = '22023';
  END IF;

  -- ออกเลขถ้ายังไม่มี (ใช้ปีปัจจุบันที่ออกจริง). ถ้ามีแล้วเก็บเลขเดิม (ห้ามเปลี่ยน).
  IF v_order_row.tax_invoice_no IS NULL THEN
    v_tax_no := public.next_tax_invoice_no(now());
  ELSE
    v_tax_no := v_order_row.tax_invoice_no;
  END IF;

  UPDATE sale_orders
     SET buyer_name    = COALESCE(NULLIF(p_buyer->>'buyer_name', ''),   buyer_name),
         buyer_tax_id  = COALESCE(NULLIF(p_buyer->>'buyer_tax_id', ''), buyer_tax_id),
         buyer_address = COALESCE(NULLIF(p_buyer->>'buyer_address', ''),buyer_address),
         buyer_branch  = COALESCE(NULLIF(p_buyer->>'buyer_branch', ''), buyer_branch),
         tax_invoice_no = v_tax_no,
         tax_invoice_issued_at = COALESCE(tax_invoice_issued_at, now()),
         updated_at = now()
   WHERE id = p_order_id
  RETURNING * INTO v_order_row;

  RETURN to_jsonb(v_order_row);
END;
$$;

REVOKE ALL ON FUNCTION public.issue_tax_invoice_for_order(bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_tax_invoice_for_order(bigint, jsonb) TO authenticated;

-- ====================================================================
-- 7. Seed ข้อมูลบริษัทจริง (บริษัท ไทมส์สโตร์ จำกัด)
-- ====================================================================
UPDATE public.shop_settings SET
  shop_name   = 'บริษัท ไทมส์สโตร์ จำกัด',
  shop_address= '1242/2 ถนนมิตรภาพ ตำบลในเมือง อำเภอเมืองนครราชสีมา จังหวัดนครราชสีมา 30000',
  shop_tax_id = '0305569005495',
  shop_phone  = '091-012-1122',
  shop_branch = 'สำนักงานใหญ่'
WHERE id = 1;
