-- 079_tiktok_stock_resolution.sql
-- TikTok cancel/return: void immediately, manual stock resolution via POS card.
-- Stops auto sale_void on TikTok cancel; cashiers confirm goods returned vs lost.

-- ---------------------------------------------------------------------------
-- 1. Columns on sale_orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS tiktok_resolution_kind text,
  ADD COLUMN IF NOT EXISTS stock_resolution text,
  ADD COLUMN IF NOT EXISTS stock_resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS stock_resolved_by uuid;

COMMENT ON COLUMN public.sale_orders.tiktok_resolution_kind IS
  'cancel_pre_ship | return_post_ship | return_refund | refund_only';
COMMENT ON COLUMN public.sale_orders.stock_resolution IS
  'awaiting | restocked | lost | n_a — manual stock checkpoint after TikTok void/return';

CREATE INDEX IF NOT EXISTS idx_sale_orders_stock_resolution_awaiting
  ON public.sale_orders (sale_date DESC)
  WHERE channel = 'tiktok'
    AND status = 'voided'
    AND stock_resolution = 'awaiting';

-- ---------------------------------------------------------------------------
-- 2. Shipped detector
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tiktok_order_was_shipped(p_sale_order_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.sale_orders so
     WHERE so.id = p_sale_order_id
       AND (
         upper(COALESCE(so.tiktok_order_status, '')) IN (
           'AWAITING_COLLECTION', 'IN_TRANSIT', 'DELIVERED',
           'COMPLETED', 'PARTIALLY_SHIPPING'
         )
         OR NULLIF(trim(COALESCE(so.tracking_number, '')), '') IS NOT NULL
         OR (
           so.tiktok_package_ids IS NOT NULL
           AND so.tiktok_package_ids <> 'null'::jsonb
           AND so.tiktok_package_ids <> '[]'::jsonb
         )
       )
  );
$$;

REVOKE ALL ON FUNCTION public.tiktok_order_was_shipped(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tiktok_order_was_shipped(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tiktok_order_was_shipped(bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Infer resolution kind from sale row
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.infer_tiktok_resolution_kind(
  p_sale_order_id bigint,
  p_override_kind text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind text;
BEGIN
  v_kind := NULLIF(trim(p_override_kind), '');
  IF v_kind IS NOT NULL THEN
    RETURN v_kind;
  END IF;

  IF public.tiktok_order_was_shipped(p_sale_order_id) THEN
    RETURN 'return_post_ship';
  END IF;

  RETURN 'cancel_pre_ship';
END;
$$;

REVOKE ALL ON FUNCTION public.infer_tiktok_resolution_kind(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.infer_tiktok_resolution_kind(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.infer_tiktok_resolution_kind(bigint, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Return status → resolution kind
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tiktok_return_resolution_kind(p_return_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_return_type, '') ILIKE '%RETURN%' THEN 'return_refund'
    ELSE 'refund_only'
  END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Terminal return statuses (enqueue stock resolution)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tiktok_return_status_is_terminal(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(COALESCE(p_status, '')) IN (
    'RETURN_OR_REFUND_REQUEST_COMPLETE',
    'RETURN_OR_REFUND_REQUEST_SUCCESS',
    'COMPLETED',
    'REFUND_SUCCESS',
    'RETURN_SUCCESS'
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. enqueue_tiktok_stock_resolution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_tiktok_stock_resolution(
  p_sale_order_id bigint,
  p_kind text DEFAULT NULL,
  p_source text DEFAULT 'system'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sale_orders%ROWTYPE;
  v_kind text;
  v_prev_status text;
BEGIN
  SELECT * INTO v_sale FROM public.sale_orders WHERE id = p_sale_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_found');
  END IF;

  IF v_sale.channel IS DISTINCT FROM 'tiktok' OR v_sale.tiktok_order_id IS NULL THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_tiktok');
  END IF;

  IF v_sale.stock_resolution IN ('restocked', 'lost', 'n_a') THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'already_resolved',
      'stock_resolution', v_sale.stock_resolution
    );
  END IF;

  v_kind := public.infer_tiktok_resolution_kind(p_sale_order_id, p_kind);
  v_prev_status := v_sale.status;

  IF v_sale.status IN ('active', 'pending') THEN
    UPDATE public.sale_orders SET
      status = 'voided',
      voided_at = COALESCE(voided_at, now()),
      void_reason = COALESCE(
        NULLIF(trim(void_reason), ''),
        CASE WHEN p_source ILIKE '%return%' THEN 'TikTok return/refund' ELSE 'TikTok order cancelled' END
      ),
      updated_at = now()
    WHERE id = p_sale_order_id;
  END IF;

  IF v_prev_status = 'pending' THEN
    UPDATE public.sale_orders SET
      stock_resolution = 'n_a',
      tiktok_resolution_kind = NULL,
      updated_at = now()
    WHERE id = p_sale_order_id;

    INSERT INTO public.tiktok_order_events (
      sale_order_id, tiktok_order_id, event, previous_status, pos_stock_restored, details
    ) VALUES (
      p_sale_order_id, v_sale.tiktok_order_id, 'cancelled_pending', v_prev_status, false,
      jsonb_build_object('source', p_source, 'stock_resolution', 'n_a')
    );

    RETURN jsonb_build_object(
      'sale_order_id', p_sale_order_id,
      'stock_resolution', 'n_a',
      'previous_status', v_prev_status
    );
  END IF;

  UPDATE public.sale_orders SET
    stock_resolution = 'awaiting',
    tiktok_resolution_kind = v_kind,
    updated_at = now()
  WHERE id = p_sale_order_id;

  INSERT INTO public.tiktok_order_events (
    sale_order_id, tiktok_order_id, event, previous_status, pos_stock_restored, details
  ) VALUES (
    p_sale_order_id, v_sale.tiktok_order_id, 'stock_resolution_queued', v_prev_status, false,
    jsonb_build_object(
      'source', p_source,
      'tiktok_resolution_kind', v_kind,
      'stock_resolution', 'awaiting'
    )
  );

  RETURN (
    SELECT to_jsonb(so) || jsonb_build_object(
      'previous_status', v_prev_status,
      'pos_stock_restored', false
    )
    FROM public.sale_orders so WHERE id = p_sale_order_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_tiktok_stock_resolution(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_tiktok_stock_resolution(bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_tiktok_stock_resolution(bigint, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. void_tiktok_sale_order v2 — no auto sale_void
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
BEGIN
  SELECT id, status INTO v_id, v_status FROM public.sale_orders
   WHERE tiktok_order_id = p_tiktok_order_id AND status IN ('active', 'pending');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_found_or_already_voided');
  END IF;

  RETURN public.enqueue_tiktok_stock_resolution(
    v_id,
  NULL,
    COALESCE(NULLIF(trim(p_reason), ''), 'tiktok_cancel')
  ) || jsonb_build_object('void_reason', p_reason, 'previous_status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.void_tiktok_sale_order(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_tiktok_sale_order(text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. get_pending_tiktok_stock_resolutions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_tiktok_stock_resolutions(
  p_limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.sale_date DESC), '[]'::jsonb)
    FROM (
      SELECT
        so.id,
        so.sale_date,
        so.grand_total,
        so.tiktok_order_id,
        so.tiktok_order_status,
        so.tracking_number,
        so.void_reason,
        so.voided_at,
        so.tiktok_resolution_kind,
        so.stock_resolution,
        (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', soi.id,
            'product_id', soi.product_id,
            'product_name', soi.product_name,
            'sku_name', soi.sku_name,
            'seller_sku', soi.seller_sku,
            'tiktok_sku_id', soi.tiktok_sku_id,
            'quantity', soi.quantity,
            'unit_price', soi.unit_price
          ) ORDER BY soi.id), '[]'::jsonb)
          FROM public.sale_order_items soi
          WHERE soi.sale_order_id = so.id
        ) AS items,
        (
          SELECT tro.return_type
          FROM public.tiktok_return_orders tro
          WHERE tro.sale_order_id = so.id
          ORDER BY tro.updated_at DESC NULLS LAST
          LIMIT 1
        ) AS tiktok_return_type
      FROM public.sale_orders so
      WHERE so.channel = 'tiktok'
        AND so.status = 'voided'
        AND so.stock_resolution = 'awaiting'
        AND so.tiktok_order_id IS NOT NULL
      ORDER BY so.sale_date DESC
      LIMIT GREATEST(1, LEAST(p_limit, 300))
    ) t
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_pending_tiktok_stock_resolutions(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_tiktok_stock_resolutions(int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. confirm_tiktok_stock_resolution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_tiktok_stock_resolution(
  p_sale_order_id bigint,
  p_goods_returned boolean,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_sale public.sale_orders%ROWTYPE;
  v_items jsonb;
  v_header jsonb;
  v_return jsonb;
  v_resolution text;
  v_return_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_sale FROM public.sale_orders WHERE id = p_sale_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % not found', p_sale_order_id USING ERRCODE = 'P0002';
  END IF;

  IF v_sale.channel IS DISTINCT FROM 'tiktok' OR v_sale.tiktok_order_id IS NULL THEN
    RAISE EXCEPTION 'รายการนี้ไม่ใช่ออเดอร์ TikTok' USING ERRCODE = '22023';
  END IF;

  IF v_sale.stock_resolution IS DISTINCT FROM 'awaiting' THEN
    RAISE EXCEPTION 'ออเดอร์นี้ไม่อยู่ในคิวรอตีกลับ' USING ERRCODE = '22023';
  END IF;

  -- Never double-restock if legacy sale_void already ran.
  IF p_goods_returned AND public.sale_order_has_stock_void(p_sale_order_id) THEN
    RAISE EXCEPTION 'สต็อกคืนแล้วจาก void เก่า — ไม่ต้องบันทึกรับคืนซ้ำ' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'product_id', i.product_id,
           'product_name', COALESCE(i.sku_name, i.product_name),
           'quantity', i.quantity,
           'unit_price', i.unit_price
         ))
    INTO v_items
    FROM public.sale_order_items i
   WHERE i.sale_order_id = p_sale_order_id
     AND i.product_id IS NOT NULL;

  IF v_items IS NULL OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'ออเดอร์ไม่มีรายการสินค้า' USING ERRCODE = '22023';
  END IF;

  v_header := jsonb_build_object(
    'return_date', now(),
    'total_value', v_sale.grand_total,
    'channel', 'tiktok',
    'return_reason', COALESCE(v_sale.void_reason, 'TikTok stock resolution'),
    'original_sale_order_id', p_sale_order_id,
    'goods_returned', p_goods_returned,
    'notes', COALESCE(
      NULLIF(trim(p_notes), ''),
      'TikTok stock resolution · POS #' || p_sale_order_id::text
    )
  );

  v_return := public.create_stock_movement_with_items('return', v_header, v_items);
  v_return_id := (v_return->>'id')::bigint;
  v_resolution := CASE WHEN p_goods_returned THEN 'restocked' ELSE 'lost' END;

  UPDATE public.sale_orders SET
    stock_resolution = v_resolution,
    stock_resolved_at = now(),
    stock_resolved_by = auth.uid(),
    updated_at = now()
  WHERE id = p_sale_order_id;

  INSERT INTO public.tiktok_order_events (
    sale_order_id, tiktok_order_id, event, previous_status, pos_stock_restored, details
  ) VALUES (
    p_sale_order_id, v_sale.tiktok_order_id, 'stock_resolution_confirmed', v_sale.status,
    p_goods_returned,
    jsonb_build_object(
      'goods_returned', p_goods_returned,
      'stock_resolution', v_resolution,
      'return_order_id', v_return_id,
      'tiktok_resolution_kind', v_sale.tiktok_resolution_kind
    )
  );

  RETURN v_return || jsonb_build_object(
    'sale_order_id', p_sale_order_id,
    'stock_resolution', v_resolution,
    'goods_returned', p_goods_returned,
    'product_ids', (
      SELECT COALESCE(jsonb_agg(DISTINCT i.product_id), '[]'::jsonb)
      FROM public.sale_order_items i
      WHERE i.sale_order_id = p_sale_order_id AND i.product_id IS NOT NULL
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_tiktok_stock_resolution(bigint, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_tiktok_stock_resolution(bigint, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Update cancel-return meta for new flow
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
    AND (
      COALESCE(v_sale.void_reason, '') ILIKE '%TikTok%cancel%'
      OR COALESCE(v_sale.void_reason, '') ILIKE '%TikTok%return%'
    )
    AND v_sale.stock_resolution IN ('awaiting', 'restocked', 'lost');

  v_restored := v_sale.stock_resolution = 'restocked'
    OR public.sale_order_has_stock_void(p_sale_order_id);

  RETURN jsonb_build_object(
    'eligible', v_eligible,
    'sale_order_id', v_sale.id,
    'tiktok_order_id', v_sale.tiktok_order_id,
    'void_reason', v_sale.void_reason,
    'stock_resolution', v_sale.stock_resolution,
    'tiktok_resolution_kind', v_sale.tiktok_resolution_kind,
    'pos_stock_restored', v_restored,
    'recommended_goods_returned', CASE
      WHEN v_sale.stock_resolution = 'awaiting' THEN NULL
      WHEN v_restored THEN false
      ELSE true
    END
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. upsert_tiktok_return — enqueue on terminal return status
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_tiktok_return(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale_order_id bigint;
  v_row public.tiktok_return_orders%ROWTYPE;
  v_kind text;
  v_status text;
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

  v_status := COALESCE(v_row.return_status, '');
  IF v_row.sale_order_id IS NOT NULL
     AND public.tiktok_return_status_is_terminal(v_status) THEN
    v_kind := public.tiktok_return_resolution_kind(v_row.return_type);
    PERFORM public.enqueue_tiktok_stock_resolution(
      v_row.sale_order_id,
      v_kind,
      'tiktok_return_sync'
    );
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. Backfill existing voided TikTok orders
-- ---------------------------------------------------------------------------
UPDATE public.sale_orders so
   SET stock_resolution = 'restocked',
       stock_resolved_at = COALESCE(so.voided_at, so.updated_at, now())
 WHERE so.channel = 'tiktok'
   AND so.status = 'voided'
   AND so.stock_resolution IS NULL
   AND public.sale_order_has_stock_void(so.id);

UPDATE public.sale_orders so
   SET stock_resolution = 'n_a'
 WHERE so.channel = 'tiktok'
   AND so.status = 'voided'
   AND so.stock_resolution IS NULL
   AND NOT public.sale_order_has_stock_void(so.id)
   AND EXISTS (
     SELECT 1 FROM public.tiktok_order_events e
     WHERE e.sale_order_id = so.id
       AND e.previous_status = 'pending'
   );

UPDATE public.sale_orders so
   SET stock_resolution = 'awaiting',
       tiktok_resolution_kind = public.infer_tiktok_resolution_kind(so.id, NULL)
 WHERE so.channel = 'tiktok'
   AND so.status = 'voided'
   AND so.stock_resolution IS NULL
   AND NOT public.sale_order_has_stock_void(so.id);
