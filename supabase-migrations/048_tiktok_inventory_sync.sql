-- 048_tiktok_inventory_sync.sql — mirror POS stock → TikTok after receive (opt-in)

-- ── extend mappings for inventory API ─────────────────────────────────────
ALTER TABLE public.tiktok_product_mappings
  ADD COLUMN IF NOT EXISTS tiktok_product_id text,
  ADD COLUMN IF NOT EXISTS warehouse_id      text,
  ADD COLUMN IF NOT EXISTS sync_enabled     boolean DEFAULT true;

-- ── default warehouse on token row ────────────────────────────────────────
ALTER TABLE public.tiktok_tokens
  ADD COLUMN IF NOT EXISTS default_warehouse_id text;

-- ── sync audit log + idempotency ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tiktok_inventory_sync_log (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receive_order_id  bigint NOT NULL,
  product_id        bigint REFERENCES public.products(id) ON DELETE SET NULL,
  tiktok_sku_id     text,
  pos_stock_after   int,
  tiktok_qty_before int,
  tiktok_qty_after  int,
  status            text NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  error_message     text,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tiktok_inv_sync_once
  ON public.tiktok_inventory_sync_log (receive_order_id, product_id)
  WHERE status = 'success';

ALTER TABLE public.tiktok_inventory_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tiktok_inv_sync_log_admin ON public.tiktok_inventory_sync_log
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── connection status includes warehouse ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_tiktok_connection_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_row tiktok_tokens%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can view TikTok connection status' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM tiktok_tokens WHERE id = 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('connected', false);
  END IF;
  RETURN jsonb_build_object(
    'connected', v_row.access_token IS NOT NULL AND v_row.shop_cipher IS NOT NULL,
    'shop_name', v_row.shop_name,
    'shop_id', v_row.shop_id,
    'connected_at', v_row.connected_at,
    'access_token_expires_at', v_row.access_token_expires_at,
    'refresh_token_expires_at', v_row.refresh_token_expires_at,
    'last_error', v_row.last_error,
    'last_refresh_error', v_row.last_refresh_error,
    'default_warehouse_id', v_row.default_warehouse_id,
    'token_expired', v_row.access_token_expires_at IS NOT NULL
      AND v_row.access_token_expires_at < now()
  );
END;
$$;

-- ── mappings for receive lines ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_tiktok_mappings_for_products(p_product_ids bigint[])
RETURNS SETOF public.tiktok_product_mappings
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT m.*
    FROM public.tiktok_product_mappings m
   WHERE public.is_admin()
     AND m.product_id = ANY (p_product_ids)
     AND COALESCE(m.sync_enabled, true);
$$;

REVOKE ALL ON FUNCTION public.get_tiktok_mappings_for_products(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tiktok_mappings_for_products(bigint[]) TO authenticated;

-- ── upsert mapping after user confirms TikTok SKU ─────────────────────────
CREATE OR REPLACE FUNCTION public.upsert_tiktok_inventory_mapping(
  p_tiktok_sku_id      text,
  p_product_id         bigint,
  p_tiktok_product_id  text,
  p_seller_sku         text DEFAULT NULL,
  p_tiktok_product_name text DEFAULT NULL,
  p_warehouse_id       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(p_tiktok_sku_id), '') IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'tiktok_sku_id and product_id required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.tiktok_product_mappings (
    tiktok_sku_id, product_id, seller_sku, tiktok_product_name,
    tiktok_product_id, warehouse_id, sync_enabled, updated_at
  ) VALUES (
    trim(p_tiktok_sku_id), p_product_id, p_seller_sku, p_tiktok_product_name,
    p_tiktok_product_id, p_warehouse_id, true, now()
  )
  ON CONFLICT (tiktok_sku_id) DO UPDATE SET
    product_id          = EXCLUDED.product_id,
    seller_sku          = COALESCE(EXCLUDED.seller_sku, tiktok_product_mappings.seller_sku),
    tiktok_product_name = COALESCE(EXCLUDED.tiktok_product_name, tiktok_product_mappings.tiktok_product_name),
    tiktok_product_id   = COALESCE(EXCLUDED.tiktok_product_id, tiktok_product_mappings.tiktok_product_id),
    warehouse_id        = COALESCE(EXCLUDED.warehouse_id, tiktok_product_mappings.warehouse_id),
    sync_enabled        = true,
    updated_at          = now();

  RETURN jsonb_build_object('ok', true, 'tiktok_sku_id', trim(p_tiktok_sku_id));
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_tiktok_inventory_mapping(text, bigint, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_tiktok_inventory_mapping(text, bigint, text, text, text, text) TO authenticated;

-- ── log sync result (idempotent success) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_tiktok_inventory_sync(
  p_receive_order_id  bigint,
  p_product_id        bigint,
  p_tiktok_sku_id     text,
  p_pos_stock_after   int,
  p_tiktok_qty_before int,
  p_tiktok_qty_after  int,
  p_status            text,
  p_error_message     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_existing bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;

  IF p_status = 'success' THEN
    SELECT id INTO v_existing
      FROM public.tiktok_inventory_sync_log
     WHERE receive_order_id = p_receive_order_id
       AND product_id = p_product_id
       AND status = 'success'
     LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true);
    END IF;
  END IF;

  INSERT INTO public.tiktok_inventory_sync_log (
    receive_order_id, product_id, tiktok_sku_id,
    pos_stock_after, tiktok_qty_before, tiktok_qty_after,
    status, error_message, created_by
  ) VALUES (
    p_receive_order_id, p_product_id, p_tiktok_sku_id,
    p_pos_stock_after, p_tiktok_qty_before, p_tiktok_qty_after,
    p_status, p_error_message, auth.uid()
  );

  RETURN jsonb_build_object('ok', true, 'duplicate', false);
END;
$$;

REVOKE ALL ON FUNCTION public.log_tiktok_inventory_sync(bigint, bigint, text, int, int, int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_tiktok_inventory_sync(bigint, bigint, text, int, int, int, text, text) TO authenticated;

-- ── set default warehouse (admin) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_tiktok_default_warehouse(p_warehouse_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tiktok_tokens
     SET default_warehouse_id = NULLIF(trim(p_warehouse_id), ''),
         updated_at = now()
   WHERE id = 1;
  RETURN jsonb_build_object('ok', true, 'default_warehouse_id', NULLIF(trim(p_warehouse_id), ''));
END;
$$;

REVOKE ALL ON FUNCTION public.set_tiktok_default_warehouse(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tiktok_default_warehouse(text) TO authenticated;

-- ── check prior successful sync ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tiktok_inventory_already_synced(
  p_receive_order_id bigint,
  p_product_id bigint
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tiktok_inventory_sync_log
     WHERE receive_order_id = p_receive_order_id
       AND product_id = p_product_id
       AND status = 'success'
  );
$$;

REVOKE ALL ON FUNCTION public.tiktok_inventory_already_synced(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tiktok_inventory_already_synced(bigint, bigint) TO authenticated;
