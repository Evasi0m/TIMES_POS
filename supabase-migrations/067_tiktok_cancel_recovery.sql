-- 067_tiktok_cancel_recovery.sql
-- TikTok cancel before ship: return from voided bills, audit events, void mirror metadata.

-- ---------------------------------------------------------------------------
-- 1. Audit log for TikTok order lifecycle events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tiktok_order_events (
  id            bigserial PRIMARY KEY,
  sale_order_id bigint NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  tiktok_order_id text,
  event           text NOT NULL,
  previous_status text,
  pos_stock_restored boolean,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tiktok_order_events_sale
  ON public.tiktok_order_events (sale_order_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_order_events_tiktok
  ON public.tiktok_order_events (tiktok_order_id)
  WHERE tiktok_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiktok_order_events_created
  ON public.tiktok_order_events (created_at DESC);

ALTER TABLE public.tiktok_order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiktok_order_events_select ON public.tiktok_order_events;
CREATE POLICY tiktok_order_events_select
  ON public.tiktok_order_events FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.tiktok_order_events TO authenticated;
GRANT ALL ON public.tiktok_order_events TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Helpers — detect prior sale_void stock restoration
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sale_order_has_stock_void(p_sale_order_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.stock_movements sm
     WHERE sm.ref_table = 'sale_orders'
       AND sm.ref_id = p_sale_order_id
       AND sm.reason = 'sale_void'
  );
$$;

REVOKE ALL ON FUNCTION public.sale_order_has_stock_void(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sale_order_has_stock_void(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sale_order_has_stock_void(bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Meta for return UI — eligibility + restock guard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tiktok_cancel_return_meta(p_sale_order_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sale_orders%ROWTYPE;
  v_restored boolean;
  v_eligible boolean;
BEGIN
  SELECT * INTO v_sale FROM public.sale_orders WHERE id = p_sale_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'not_found');
  END IF;

  v_eligible := v_sale.status = 'voided'
    AND v_sale.channel = 'tiktok'
    AND COALESCE(v_sale.void_reason, '') ILIKE '%TikTok%cancel%';

  v_restored := public.sale_order_has_stock_void(p_sale_order_id);

  RETURN jsonb_build_object(
    'eligible', v_eligible,
    'sale_order_id', v_sale.id,
    'tiktok_order_id', v_sale.tiktok_order_id,
    'void_reason', v_sale.void_reason,
    'pos_stock_restored', v_restored,
    'recommended_goods_returned', NOT v_restored
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tiktok_cancel_return_meta(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tiktok_cancel_return_meta(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tiktok_cancel_return_meta(bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. RPC — create return for TikTok-cancelled voided sale (full bill)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_tiktok_cancelled_return(
  p_sale_order_id bigint,
  p_goods_returned boolean DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb;
  v_goods boolean;
  v_sale public.sale_orders%ROWTYPE;
  v_items jsonb;
  v_header jsonb;
  v_return jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  v_meta := public.get_tiktok_cancel_return_meta(p_sale_order_id);
  IF NOT COALESCE((v_meta->>'eligible')::boolean, false) THEN
    RAISE EXCEPTION 'Bill is not an eligible TikTok cancelled sale'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sale FROM public.sale_orders WHERE id = p_sale_order_id;

  IF p_goods_returned IS NULL THEN
    v_goods := NOT COALESCE((v_meta->>'pos_stock_restored')::boolean, false);
  ELSE
    v_goods := p_goods_returned;
    -- Never double-restock when void already restored POS stock.
    IF COALESCE((v_meta->>'pos_stock_restored')::boolean, false) THEN
      v_goods := false;
    END IF;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'product_id', i.product_id,
           'product_name', i.product_name,
           'quantity', i.quantity,
           'unit_price', i.unit_price
         ))
    INTO v_items
    FROM public.sale_order_items i
   WHERE i.sale_order_id = p_sale_order_id;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'ออเดอร์ไม่มีรายการสินค้า' USING ERRCODE = '22023';
  END IF;

  v_header := jsonb_build_object(
    'return_date', now(),
    'total_value', v_sale.grand_total,
    'channel', 'tiktok',
    'return_reason', COALESCE(v_sale.void_reason, 'TikTok order cancelled'),
    'original_sale_order_id', p_sale_order_id,
    'goods_returned', v_goods,
    'notes', COALESCE(
      NULLIF(trim(p_notes), ''),
      'TikTok cancel return · POS #' || p_sale_order_id::text
    )
  );

  v_return := public.create_stock_movement_with_items('return', v_header, v_items);

  RETURN v_return || jsonb_build_object(
    'goods_returned_applied', v_goods,
    'pos_stock_restored_before', COALESCE((v_meta->>'pos_stock_restored')::boolean, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_tiktok_cancelled_return(bigint, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tiktok_cancelled_return(bigint, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. void_tiktok_sale_order — log event + return mirror metadata
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_tiktok_sale_order(
  p_tiktok_order_id text,
  p_reason text DEFAULT 'TikTok order cancelled'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
  v_status text;
  v_restored boolean := false;
  r record;
BEGIN
  SELECT id, status INTO v_id, v_status FROM public.sale_orders
   WHERE tiktok_order_id = p_tiktok_order_id AND status IN ('active', 'pending');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_found_or_already_voided');
  END IF;

  UPDATE public.sale_orders
     SET status = 'voided', voided_at = now(), void_reason = p_reason, updated_at = now()
   WHERE id = v_id AND status IN ('active', 'pending');

  IF v_status = 'active' THEN
    FOR r IN
      SELECT product_id, quantity FROM public.sale_order_items
       WHERE sale_order_id = v_id AND product_id IS NOT NULL
    LOOP
      PERFORM public.adjust_stock(
        r.product_id, r.quantity, 'sale_void', 'sale_orders', v_id
      );
    END LOOP;
    v_restored := true;
  END IF;

  INSERT INTO public.tiktok_order_events (
    sale_order_id, tiktok_order_id, event, previous_status, pos_stock_restored, details
  ) VALUES (
    v_id, p_tiktok_order_id, 'cancelled', v_status, v_restored,
    jsonb_build_object('void_reason', p_reason)
  );

  RETURN (
    SELECT to_jsonb(so) || jsonb_build_object(
      'pos_stock_restored', v_restored,
      'previous_status', v_status
    )
    FROM public.sale_orders so WHERE id = v_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.void_tiktok_sale_order(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_tiktok_sale_order(text, text) TO service_role;
