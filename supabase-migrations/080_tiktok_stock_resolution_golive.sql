-- 080_tiktok_stock_resolution_golive.sql
-- Go-live cutoff for manual stock resolution queue (รอตีกลับ).
-- Only voided TikTok orders from 2026-07-12 20:26 Asia/Bangkok onward enter the queue.

-- ---------------------------------------------------------------------------
-- 1. Cleanup — clear pre-cutoff rows stuck in awaiting (from 079 backfill)
-- ---------------------------------------------------------------------------
UPDATE public.sale_orders
   SET stock_resolution = 'n_a',
       tiktok_resolution_kind = NULL,
       updated_at = now()
 WHERE channel = 'tiktok'
   AND status = 'voided'
   AND stock_resolution = 'awaiting'
   AND COALESCE(voided_at, updated_at, sale_date) < '2026-07-12 20:26:00+07'::timestamptz;

-- ---------------------------------------------------------------------------
-- 2. enqueue_tiktok_stock_resolution — cutoff at runtime
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
  v_cutoff     constant timestamptz := '2026-07-12 20:26:00+07';
  v_sale public.sale_orders%ROWTYPE;
  v_kind text;
  v_prev_status text;
  v_voided_at timestamptz;
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

  SELECT COALESCE(voided_at, updated_at, now()) INTO v_voided_at
    FROM public.sale_orders WHERE id = p_sale_order_id;

  IF v_voided_at < v_cutoff THEN
    UPDATE public.sale_orders SET
      stock_resolution = 'n_a',
      tiktok_resolution_kind = NULL,
      updated_at = now()
    WHERE id = p_sale_order_id;

    RETURN jsonb_build_object(
      'sale_order_id', p_sale_order_id,
      'stock_resolution', 'n_a',
      'previous_status', v_prev_status,
      'skipped', true,
      'reason', 'pre_golive'
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

-- ---------------------------------------------------------------------------
-- 3. get_pending_tiktok_stock_resolutions — post-cutoff only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_pending_tiktok_stock_resolutions(
  p_limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_cutoff constant timestamptz := '2026-07-12 20:26:00+07';
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
        AND COALESCE(so.voided_at, so.updated_at) >= v_cutoff
      ORDER BY so.sale_date DESC
      LIMIT GREATEST(1, LEAST(p_limit, 300))
    ) t
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. confirm_tiktok_stock_resolution — reject pre-cutoff
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
  v_cutoff     constant timestamptz := '2026-07-12 20:26:00+07';
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

  IF COALESCE(v_sale.voided_at, v_sale.updated_at, v_sale.sale_date) < v_cutoff THEN
    RAISE EXCEPTION 'ออเดอร์ก่อน go-live รอตีกลับ (12/07/2026 20:26) — ไม่อยู่ในคิวยืนยันสต็อก'
      USING ERRCODE = '22023';
  END IF;

  IF v_sale.stock_resolution IS DISTINCT FROM 'awaiting' THEN
    RAISE EXCEPTION 'ออเดอร์นี้ไม่อยู่ในคิวรอตีกลับ' USING ERRCODE = '22023';
  END IF;

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

-- ---------------------------------------------------------------------------
-- 5. upsert_tiktok_return — enqueue only post-cutoff sales
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_tiktok_return(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cutoff     constant timestamptz := '2026-07-12 20:26:00+07';
  v_sale_order_id bigint;
  v_row public.tiktok_return_orders%ROWTYPE;
  v_kind text;
  v_status text;
  v_voided_at timestamptz;
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
    SELECT COALESCE(voided_at, updated_at, sale_date) INTO v_voided_at
      FROM public.sale_orders WHERE id = v_row.sale_order_id;
    IF v_voided_at IS NOT NULL AND v_voided_at >= v_cutoff THEN
      v_kind := public.tiktok_return_resolution_kind(v_row.return_type);
      PERFORM public.enqueue_tiktok_stock_resolution(
        v_row.sale_order_id,
        v_kind,
        'tiktok_return_sync'
      );
    END IF;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;
