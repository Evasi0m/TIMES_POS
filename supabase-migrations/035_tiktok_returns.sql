-- 035_tiktok_returns.sql
-- TikTok Return & Refund tracking + bridge to ใบลดหนี้ (credit note) flow.
--   1. tiktok_return_orders: mirror of TikTok return/refund records
--   2. upsert_tiktok_return(jsonb): service-role upsert from sync/webhook
--   3. create_tiktok_credit_note(bigint): build return_order from the linked
--      sale order, restock (if goods returned), and issue a credit note.

-- ====================================================================
-- 1. tiktok_return_orders
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.tiktok_return_orders (
  id                bigserial PRIMARY KEY,
  tiktok_return_id  text NOT NULL UNIQUE,
  tiktok_order_id   text,
  sale_order_id     bigint REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  return_type       text,                       -- REFUND | RETURN_AND_REFUND | ...
  return_status     text,
  refund_amount     numeric,
  currency          text,
  reason            text,
  return_order_id   bigint REFERENCES public.return_orders(id) ON DELETE SET NULL,
  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tiktok_returns_order ON public.tiktok_return_orders(tiktok_order_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_returns_sale ON public.tiktok_return_orders(sale_order_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_returns_status ON public.tiktok_return_orders(return_status);

ALTER TABLE public.tiktok_return_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tiktok_returns_read ON public.tiktok_return_orders;
CREATE POLICY tiktok_returns_read ON public.tiktok_return_orders
  FOR SELECT TO authenticated USING (true);

-- ====================================================================
-- 2. upsert_tiktok_return — called by edge (service role)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.upsert_tiktok_return(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale_order_id bigint;
  v_row public.tiktok_return_orders%ROWTYPE;
BEGIN
  SELECT id INTO v_sale_order_id FROM public.sale_orders
   WHERE tiktok_order_id = NULLIF(p->>'tiktok_order_id','')
   LIMIT 1;

  INSERT INTO public.tiktok_return_orders (
    tiktok_return_id, tiktok_order_id, sale_order_id,
    return_type, return_status, refund_amount, currency, reason, raw, updated_at
  ) VALUES (
    p->>'tiktok_return_id',
    NULLIF(p->>'tiktok_order_id',''),
    v_sale_order_id,
    NULLIF(p->>'return_type',''),
    NULLIF(p->>'return_status',''),
    NULLIF(p->>'refund_amount','')::numeric,
    NULLIF(p->>'currency',''),
    NULLIF(p->>'reason',''),
    COALESCE(p->'raw', '{}'::jsonb),
    now()
  )
  ON CONFLICT (tiktok_return_id) DO UPDATE SET
    tiktok_order_id = EXCLUDED.tiktok_order_id,
    sale_order_id   = COALESCE(EXCLUDED.sale_order_id, public.tiktok_return_orders.sale_order_id),
    return_type     = EXCLUDED.return_type,
    return_status   = EXCLUDED.return_status,
    refund_amount   = EXCLUDED.refund_amount,
    currency        = EXCLUDED.currency,
    reason          = EXCLUDED.reason,
    raw             = EXCLUDED.raw,
    updated_at      = now()
  RETURNING * INTO v_row;

  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_tiktok_return(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_tiktok_return(jsonb) TO service_role;

-- ====================================================================
-- 3. create_tiktok_credit_note — admin: restock + ใบลดหนี้ from sale order
-- ====================================================================
CREATE OR REPLACE FUNCTION public.create_tiktok_credit_note(
  p_tiktok_return_id bigint,
  p_goods_returned boolean DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_ret    public.tiktok_return_orders%ROWTYPE;
  v_sale   public.sale_orders%ROWTYPE;
  v_goods  boolean;
  v_items  jsonb;
  v_header jsonb;
  v_return jsonb;
  v_return_id bigint;
  v_cn     jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can issue credit notes' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ret FROM public.tiktok_return_orders WHERE id = p_tiktok_return_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TikTok return % not found', p_tiktok_return_id USING ERRCODE = 'P0002';
  END IF;
  IF v_ret.return_order_id IS NOT NULL THEN
    SELECT to_jsonb(r) INTO v_cn FROM public.return_orders r WHERE id = v_ret.return_order_id;
    RETURN v_cn;  -- already issued, idempotent
  END IF;
  IF v_ret.sale_order_id IS NULL THEN
    RAISE EXCEPTION 'TikTok return ไม่ได้ผูกกับออเดอร์ POS' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sale FROM public.sale_orders WHERE id = v_ret.sale_order_id;

  -- RETURN_AND_REFUND => goods come back to stock; pure REFUND => no restock.
  v_goods := COALESCE(
    p_goods_returned,
    v_ret.return_type ILIKE '%RETURN%'
  );

  SELECT jsonb_agg(jsonb_build_object(
           'product_id', i.product_id,
           'product_name', COALESCE(i.sku_name, i.product_name),
           'quantity', i.quantity,
           'unit_price', i.unit_price
         ))
    INTO v_items
    FROM public.sale_order_items i
   WHERE i.sale_order_id = v_ret.sale_order_id;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'ออเดอร์ไม่มีรายการสินค้า' USING ERRCODE = '22023';
  END IF;

  v_header := jsonb_build_object(
    'return_date', now(),
    'total_value', COALESCE(v_ret.refund_amount, v_sale.grand_total),
    'channel', 'tiktok',
    'return_reason', COALESCE(v_ret.reason, 'TikTok return'),
    'original_sale_order_id', v_ret.sale_order_id,
    'goods_returned', v_goods,
    'notes', 'TikTok return ' || v_ret.tiktok_return_id
  );

  v_return := public.create_stock_movement_with_items('return', v_header, v_items);
  v_return_id := (v_return->>'id')::bigint;

  v_cn := public.issue_credit_note_for_return(v_return_id);

  UPDATE public.tiktok_return_orders
     SET return_order_id = v_return_id, updated_at = now()
   WHERE id = p_tiktok_return_id;

  RETURN v_cn;
END;
$$;
REVOKE ALL ON FUNCTION public.create_tiktok_credit_note(bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tiktok_credit_note(bigint, boolean) TO authenticated;
