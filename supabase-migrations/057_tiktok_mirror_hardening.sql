-- 057_tiktok_mirror_hardening.sql — sale_edit idempotency, void targets, auth, indexes, return op

-- ── unique index: allow multiple sale_edit success rows per bill+product ───
DROP INDEX IF EXISTS public.tiktok_inv_sync_once;

CREATE UNIQUE INDEX tiktok_inv_sync_once
  ON public.tiktok_inventory_sync_log (receive_order_id, product_id, sync_operation)
  WHERE status = 'success' AND sync_operation <> 'sale_edit';

-- ── sync_operation includes return (goods returned → mirror stock up) ───────
ALTER TABLE public.tiktok_inventory_sync_log
  DROP CONSTRAINT IF EXISTS tiktok_inventory_sync_log_sync_operation_check;

ALTER TABLE public.tiktok_inventory_sync_log
  ADD CONSTRAINT tiktok_inventory_sync_log_sync_operation_check
  CHECK (sync_operation IN ('receive', 'void', 'sale', 'sale_void', 'sale_edit', 'return'));

-- ── log sync — accept return op ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_tiktok_inventory_sync(
  p_receive_order_id  bigint,
  p_product_id        bigint,
  p_tiktok_sku_id     text,
  p_pos_stock_after   int,
  p_tiktok_qty_before int,
  p_tiktok_qty_after  int,
  p_status            text,
  p_error_message     text DEFAULT NULL,
  p_sync_operation    text DEFAULT 'receive'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing bigint;
  v_op text := COALESCE(NULLIF(trim(p_sync_operation), ''), 'receive');
  v_is_service boolean := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
BEGIN
  IF NOT v_is_service AND (auth.uid() IS NULL OR NOT public.is_admin()) THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  IF v_op NOT IN ('receive', 'void', 'sale', 'sale_void', 'sale_edit', 'return') THEN
    RAISE EXCEPTION 'Invalid sync_operation: %', v_op USING ERRCODE = '22023';
  END IF;

  IF p_status = 'success' AND v_op <> 'sale_edit' THEN
    SELECT id INTO v_existing
      FROM public.tiktok_inventory_sync_log
     WHERE receive_order_id = p_receive_order_id
       AND product_id = p_product_id
       AND sync_operation = v_op
       AND status = 'success'
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true);
    END IF;
  END IF;

  INSERT INTO public.tiktok_inventory_sync_log (
    receive_order_id, product_id, tiktok_sku_id,
    pos_stock_after, tiktok_qty_before, tiktok_qty_after,
    status, error_message, sync_operation, created_by
  ) VALUES (
    p_receive_order_id, p_product_id, p_tiktok_sku_id,
    p_pos_stock_after, p_tiktok_qty_before, p_tiktok_qty_after,
    p_status, p_error_message, v_op, auth.uid()
  );

  RETURN jsonb_build_object('ok', true, 'duplicate', false);
END;
$$;

-- ── already_synced — admin only ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tiktok_inventory_already_synced(
  p_receive_order_id bigint,
  p_product_id bigint,
  p_sync_operation text DEFAULT 'receive'
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.tiktok_inventory_sync_log
     WHERE receive_order_id = p_receive_order_id
       AND product_id = p_product_id
       AND sync_operation = COALESCE(NULLIF(trim(p_sync_operation), ''), 'receive')
       AND status = 'success'
  );
END;
$$;

-- ── sale void targets: sale OR sale_edit log, join by tiktok_sku_id ─────────
CREATE OR REPLACE FUNCTION public.get_tiktok_sale_mirror_targets(
  p_sale_order_id bigint,
  p_product_ids bigint[] DEFAULT NULL
)
RETURNS TABLE (
  product_id bigint,
  tiktok_sku_id text,
  tiktok_product_id text,
  warehouse_id text,
  seller_sku text,
  tiktok_product_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH prior_mirror AS (
    SELECT DISTINCT ON (l.product_id)
      l.product_id,
      l.tiktok_sku_id,
      l.created_at
    FROM public.tiktok_inventory_sync_log l
    WHERE l.receive_order_id = p_sale_order_id
      AND l.sync_operation IN ('sale', 'sale_edit')
      AND l.status = 'success'
      AND l.product_id IS NOT NULL
      AND l.tiktok_sku_id IS NOT NULL
      AND (p_product_ids IS NULL OR l.product_id = ANY(p_product_ids))
    ORDER BY l.product_id, l.created_at DESC
  )
  SELECT
    pm.product_id,
    COALESCE(m.tiktok_sku_id, pm.tiktok_sku_id) AS tiktok_sku_id,
    m.tiktok_product_id,
    m.warehouse_id,
    m.seller_sku,
    m.tiktok_product_name
  FROM prior_mirror pm
  LEFT JOIN public.tiktok_product_mappings m
    ON m.tiktok_sku_id = pm.tiktok_sku_id
   AND COALESCE(m.sync_enabled, true)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tiktok_inventory_sync_log v
     WHERE v.receive_order_id = p_sale_order_id
       AND v.product_id = pm.product_id
       AND v.sync_operation = 'sale_void'
       AND v.status = 'success'
  );
END;
$$;

-- ── receive void targets — admin + join by tiktok_sku_id ────────────────────
CREATE OR REPLACE FUNCTION public.get_tiktok_void_mirror_targets(
  p_receive_order_id bigint,
  p_product_ids bigint[] DEFAULT NULL
)
RETURNS TABLE (
  product_id bigint,
  tiktok_sku_id text,
  tiktok_product_id text,
  warehouse_id text,
  seller_sku text,
  tiktok_product_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH prior_mirror AS (
    SELECT DISTINCT ON (l.product_id)
      l.product_id,
      l.tiktok_sku_id,
      l.created_at
    FROM public.tiktok_inventory_sync_log l
    WHERE l.receive_order_id = p_receive_order_id
      AND l.sync_operation = 'receive'
      AND l.status = 'success'
      AND l.product_id IS NOT NULL
      AND l.tiktok_sku_id IS NOT NULL
      AND (p_product_ids IS NULL OR l.product_id = ANY(p_product_ids))
    ORDER BY l.product_id, l.created_at DESC
  )
  SELECT
    pm.product_id,
    COALESCE(m.tiktok_sku_id, pm.tiktok_sku_id) AS tiktok_sku_id,
    m.tiktok_product_id,
    m.warehouse_id,
    m.seller_sku,
    m.tiktok_product_name
  FROM prior_mirror pm
  LEFT JOIN public.tiktok_product_mappings m
    ON m.tiktok_sku_id = pm.tiktok_sku_id
   AND COALESCE(m.sync_enabled, true)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tiktok_inventory_sync_log v
     WHERE v.receive_order_id = p_receive_order_id
       AND v.product_id = pm.product_id
       AND v.sync_operation = 'void'
       AND v.status = 'success'
  );
END;
$$;

-- ── bills needing sale mirror (admin resync UI) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_bills_needing_sale_mirror_resync(p_limit int DEFAULT 20)
RETURNS TABLE (
  sale_order_id bigint,
  product_id bigint,
  seller_sku text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (so.id, m.product_id)
    so.id AS sale_order_id,
    m.product_id,
    m.seller_sku
  FROM public.sale_orders so
  JOIN public.sale_order_items soi ON soi.sale_order_id = so.id
  JOIN public.tiktok_product_mappings m
    ON m.product_id = soi.product_id
   AND COALESCE(m.sync_enabled, true)
   AND m.tiktok_product_id IS NOT NULL
   AND m.tiktok_sku_id IS NOT NULL
  WHERE so.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.tiktok_inventory_sync_log l
       WHERE l.receive_order_id = so.id
         AND l.product_id = m.product_id
         AND l.sync_operation IN ('sale', 'sale_edit')
         AND l.status = 'success'
    )
  ORDER BY so.id DESC, m.product_id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50));
END;
$$;

REVOKE ALL ON FUNCTION public.get_bills_needing_sale_mirror_resync(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bills_needing_sale_mirror_resync(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_bills_needing_sale_mirror_resync(int) TO service_role;

-- ── confirm: preserve tiktok ids from p_items or existing mapping ───────────
CREATE OR REPLACE FUNCTION public.confirm_tiktok_sale_order(
  p_order_id     bigint,
  p_items        jsonb,
  p_net_received numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_cutoff     constant timestamptz := '2026-06-07 13:00:00+07';
  v_order      sale_orders%ROWTYPE;
  v_entry      jsonb;
  v_item_id    bigint;
  v_product_id bigint;
  v_unmatched  int;
  v_tax_no     text;
  r            record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be a logged-in user' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_order FROM sale_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % not found', p_order_id USING ERRCODE = 'P0002';
  END IF;
  IF v_order.tiktok_order_id IS NULL THEN
    RAISE EXCEPTION 'รายการนี้ไม่ใช่ออเดอร์ TikTok' USING ERRCODE = '22023';
  END IF;
  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'ออเดอร์นี้ยืนยันไปแล้วหรือถูกยกเลิก' USING ERRCODE = '22023';
  END IF;
  IF v_order.sale_date < v_cutoff THEN
    RAISE EXCEPTION 'ออเดอร์ก่อน go-live (07/06/2026 13:00) ไม่อยู่ใน queue ยืนยัน — เป็น duplicate จาก TikTok API'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_item_id    := NULLIF(v_entry->>'item_id', '')::bigint;
      v_product_id := NULLIF(v_entry->>'product_id', '')::bigint;
      IF v_item_id IS NULL OR v_product_id IS NULL THEN
        CONTINUE;
      END IF;
      UPDATE sale_order_items soi
         SET product_id   = v_product_id,
             product_name = p.name,
             cost_price   = COALESCE(soi.cost_price, p.cost_price)
        FROM products p
       WHERE soi.id = v_item_id
         AND soi.sale_order_id = p_order_id
         AND p.id = v_product_id;
    END LOOP;
  END IF;

  SELECT count(*) INTO v_unmatched
    FROM sale_order_items
   WHERE sale_order_id = p_order_id AND product_id IS NULL;
  IF v_unmatched > 0 THEN
    RAISE EXCEPTION 'ยังจับคู่สินค้าไม่ครบ (%, รายการ)', v_unmatched USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT product_id, quantity FROM sale_order_items
     WHERE sale_order_id = p_order_id AND product_id IS NOT NULL
  LOOP
    PERFORM public.adjust_stock(
      p_id        => r.product_id,
      qty_delta   => -(r.quantity)::integer,
      p_reason    => 'sale',
      p_ref_table => 'sale_orders',
      p_ref_id    => p_order_id
    );
  END LOOP;

  IF v_order.tax_invoice_no IS NULL THEN
    v_tax_no := public.next_tax_invoice_no(v_order.sale_date);
  END IF;

  UPDATE sale_orders SET
    status                = 'active',
    net_received          = CASE
                              WHEN p_net_received IS NOT NULL THEN round(p_net_received, 2)
                              ELSE NULL
                            END,
    net_received_pending  = (p_net_received IS NULL),
    tax_invoice_no        = COALESCE(tax_invoice_no, v_tax_no),
    tax_invoice_issued_at = COALESCE(tax_invoice_issued_at, now()),
    confirmed_at          = now(),
    confirmed_by          = auth.uid(),
    updated_at            = now()
  WHERE id = p_order_id;

  INSERT INTO public.tiktok_product_mappings (
    tiktok_sku_id, product_id, seller_sku, tiktok_product_name,
    tiktok_product_id, warehouse_id, sync_enabled, updated_at
  )
  SELECT
    soi.tiktok_sku_id,
    soi.product_id,
    soi.seller_sku,
    COALESCE(soi.sku_name, soi.product_name),
    COALESCE(
      pi.tiktok_product_id,
      em.tiktok_product_id
    ),
    COALESCE(
      pi.warehouse_id,
      em.warehouse_id
    ),
    true,
    now()
  FROM sale_order_items soi
  LEFT JOIN LATERAL (
    SELECT
      NULLIF(trim(elem->>'tiktok_product_id'), '') AS tiktok_product_id,
      NULLIF(trim(elem->>'warehouse_id'), '') AS warehouse_id
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) elem
    WHERE NULLIF(elem->>'item_id', '')::bigint = soi.id
    LIMIT 1
  ) pi ON true
  LEFT JOIN public.tiktok_product_mappings em
    ON em.tiktok_sku_id = soi.tiktok_sku_id
  WHERE soi.sale_order_id = p_order_id
    AND soi.tiktok_sku_id IS NOT NULL
    AND soi.product_id IS NOT NULL
  ON CONFLICT (tiktok_sku_id) DO UPDATE SET
    product_id          = EXCLUDED.product_id,
    seller_sku          = EXCLUDED.seller_sku,
    tiktok_product_name = EXCLUDED.tiktok_product_name,
    tiktok_product_id   = COALESCE(EXCLUDED.tiktok_product_id, tiktok_product_mappings.tiktok_product_id),
    warehouse_id        = COALESCE(EXCLUDED.warehouse_id, tiktok_product_mappings.warehouse_id),
    sync_enabled        = true,
    updated_at          = now();

  FOR r IN
    SELECT DISTINCT product_id, sku_image_url
      FROM sale_order_items
     WHERE sale_order_id = p_order_id
       AND product_id IS NOT NULL
       AND NULLIF(trim(sku_image_url), '') IS NOT NULL
  LOOP
    PERFORM public.apply_tiktok_product_image(r.product_id, r.sku_image_url);
  END LOOP;

  RETURN (SELECT to_jsonb(so) FROM sale_orders so WHERE id = p_order_id);
END;
$$;

-- ── health: catalog cap hint ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_tiktok_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, vault
AS $$
DECLARE
  v_row  tiktok_tokens%ROWTYPE;
  v_key  boolean := false;
  v_pending int := 0;
  v_unmatched int := 0;
  v_last_sync timestamptz;
  v_map_total int := 0;
  v_map_missing int := 0;
  v_resync_pending int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can view TikTok health' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM tiktok_tokens WHERE id = 1;

  BEGIN
    SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      INTO v_key;
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;

  SELECT count(*) INTO v_pending
    FROM sale_orders WHERE channel = 'tiktok' AND status = 'pending';

  SELECT count(*) INTO v_unmatched
    FROM sale_order_items soi
    JOIN sale_orders so ON so.id = soi.sale_order_id
   WHERE so.channel = 'tiktok' AND so.status IN ('pending', 'active')
     AND soi.product_id IS NULL;

  SELECT max(tiktok_synced_at) INTO v_last_sync
    FROM sale_orders WHERE channel = 'tiktok';

  SELECT count(*), count(*) FILTER (WHERE tiktok_product_id IS NULL)
    INTO v_map_total, v_map_missing
    FROM tiktok_product_mappings;

  SELECT count(*) INTO v_resync_pending
    FROM public.get_bills_needing_sale_mirror_resync(50);

  RETURN jsonb_build_object(
    'connected', v_row.access_token IS NOT NULL AND v_row.shop_cipher IS NOT NULL,
    'shop_name', v_row.shop_name,
    'access_token_expires_at', v_row.access_token_expires_at,
    'token_expired', v_row.access_token_expires_at IS NOT NULL
      AND v_row.access_token_expires_at < now(),
    'access_token_hours_left', CASE WHEN v_row.access_token_expires_at IS NOT NULL
      THEN round(extract(epoch FROM (v_row.access_token_expires_at - now())) / 3600.0, 1)
      ELSE NULL END,
    'refresh_token_expires_at', v_row.refresh_token_expires_at,
    'default_warehouse_id', v_row.default_warehouse_id,
    'last_error', v_row.last_error,
    'last_refresh_error', v_row.last_refresh_error,
    'cron_service_key_set', v_key,
    'pending_count', v_pending,
    'unmatched_items', v_unmatched,
    'last_synced_at', v_last_sync,
    'mappings_total', v_map_total,
    'mappings_missing_product_id', v_map_missing,
    'sale_mirror_resync_pending', v_resync_pending,
    'catalog_mirror_max_skus', 500,
    'checked_at', now()
  );
END;
$$;

-- ── indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS tiktok_inv_sync_log_order_op_idx
  ON public.tiktok_inventory_sync_log (receive_order_id, sync_operation, status)
  WHERE status = 'success';

CREATE INDEX IF NOT EXISTS tiktok_product_mappings_product_id_idx
  ON public.tiktok_product_mappings (product_id)
  WHERE COALESCE(sync_enabled, true);
