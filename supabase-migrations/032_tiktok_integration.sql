-- 032_tiktok_integration.sql — TikTok Shop OAuth, order import, invoice requests

-- ── tiktok_tokens (singleton) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tiktok_tokens (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  access_token text,
  refresh_token text,
  shop_cipher text,
  shop_id text,
  shop_name text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  oauth_state text,
  oauth_state_at timestamptz,
  last_error text,
  last_refresh_error text,
  connected_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.tiktok_tokens (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.tiktok_tokens ENABLE ROW LEVEL SECURITY;

-- Admin sees status only — never raw tokens
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
    'token_expired', v_row.access_token_expires_at IS NOT NULL
      AND v_row.access_token_expires_at < now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tiktok_connection_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tiktok_connection_status() TO authenticated;

-- ห้าม client อ่าน token โดยตรง — ใช้ get_tiktok_connection_status() เท่านั้น
CREATE POLICY tiktok_tokens_no_client ON public.tiktok_tokens
  FOR ALL TO authenticated
  USING (false);

-- ── sale_orders TikTok columns ──────────────────────────────────────────────
ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS tiktok_order_id text,
  ADD COLUMN IF NOT EXISTS tiktok_order_status text,
  ADD COLUMN IF NOT EXISTS tiktok_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS sale_orders_tiktok_order_id_uidx
  ON public.sale_orders (tiktok_order_id)
  WHERE tiktok_order_id IS NOT NULL;

-- ── product mapping queue ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tiktok_product_mappings (
  tiktok_sku_id text PRIMARY KEY,
  product_id bigint REFERENCES public.products(id) ON DELETE SET NULL,
  seller_sku text,
  tiktok_product_name text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.tiktok_product_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tiktok_mappings_admin ON public.tiktok_product_mappings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── invoice request tokens (Phase 3) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tiktok_invoice_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id bigint NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  buyer_name text,
  buyer_tax_id text,
  buyer_address text,
  buyer_branch text,
  submitted_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.tiktok_invoice_requests ENABLE ROW LEVEL SECURITY;

-- No direct client access — Edge Functions use service_role
CREATE POLICY tiktok_invoice_no_client ON public.tiktok_invoice_requests
  FOR ALL TO authenticated
  USING (false);

-- ── import_tiktok_sale_order (service_role only) ────────────────────────────
CREATE OR REPLACE FUNCTION public.import_tiktok_sale_order(
  p_header jsonb,
  p_items  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tiktok_id  text;
  v_order_id   bigint;
  v_order_row  sale_orders%ROWTYPE;
  v_item       jsonb;
  v_tax_no     text;
  v_sale_date  timestamptz;
  v_status     text;
BEGIN
  v_tiktok_id := NULLIF(p_header->>'tiktok_order_id', '');
  IF v_tiktok_id IS NULL THEN
    RAISE EXCEPTION 'tiktok_order_id is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_order_id FROM sale_orders WHERE tiktok_order_id = v_tiktok_id;
  IF FOUND THEN
    UPDATE sale_orders SET
      tiktok_order_status = COALESCE(p_header->>'tiktok_order_status', tiktok_order_status),
      tiktok_synced_at    = now(),
      payment_method      = COALESCE(NULLIF(p_header->>'payment_method', ''), payment_method),
      notes               = COALESCE(NULLIF(p_header->>'notes', ''), notes),
      updated_at          = now()
    WHERE id = v_order_id
    RETURNING * INTO v_order_row;
    RETURN to_jsonb(v_order_row);
  END IF;

  v_sale_date := COALESCE((p_header->>'sale_date')::timestamptz, now());
  v_status := COALESCE(p_header->>'tiktok_order_status', 'imported');

  INSERT INTO sale_orders (
    sale_date, channel, payment_method,
    discount_value, discount_type,
    subtotal, total_after_discount, grand_total,
    vat_rate, vat_amount, price_includes_vat,
    tax_invoice_no, buyer_name, buyer_tax_id, buyer_address, buyer_branch,
    notes, net_received, net_received_pending,
    tiktok_order_id, tiktok_order_status, tiktok_synced_at
  )
  SELECT
    v_sale_date,
    'tiktok',
    COALESCE(NULLIF(p_header->>'payment_method', ''), 'transfer'),
    COALESCE((p_header->>'discount_value')::numeric, 0),
    COALESCE(p_header->>'discount_type', 'amount'),
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
    NULLIF(p_header->>'net_received', '')::numeric,
    COALESCE((p_header->>'net_received_pending')::boolean, true),
    v_tiktok_id,
    v_status,
    now()
  RETURNING id INTO v_order_id;

  IF NULLIF(p_header->>'tax_invoice_no', '') IS NULL THEN
    v_tax_no := public.next_tax_invoice_no(v_sale_date);
    UPDATE sale_orders
       SET tax_invoice_no = v_tax_no, tax_invoice_issued_at = now()
     WHERE id = v_order_id;
  END IF;

  INSERT INTO sale_order_items (
    sale_order_id, product_id, product_name,
    quantity, unit_price, display_unit_price,
    discount1_value, discount1_type,
    discount2_value, discount2_type,
    cost_price
  )
  SELECT
    v_order_id, pid, item->>'product_name',
    COALESCE((item->>'quantity')::integer, 0),
    COALESCE((item->>'unit_price')::numeric, 0),
    NULLIF(item->>'display_unit_price','')::numeric,
    COALESCE((item->>'discount1_value')::numeric, 0),
    item->>'discount1_type',
    COALESCE((item->>'discount2_value')::numeric, 0),
    item->>'discount2_type',
    COALESCE(NULLIF(item->>'cost_price','')::numeric, p.cost_price)
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

REVOKE ALL ON FUNCTION public.import_tiktok_sale_order(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_tiktok_sale_order(jsonb, jsonb) TO service_role;

-- ── void by tiktok_order_id (service_role) ──────────────────────────────────
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
  r record;
BEGIN
  SELECT id INTO v_id FROM sale_orders
   WHERE tiktok_order_id = p_tiktok_order_id AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'not_found_or_already_voided');
  END IF;

  UPDATE sale_orders
     SET status = 'voided', voided_at = now(), void_reason = p_reason, updated_at = now()
   WHERE id = v_id AND status = 'active';

  FOR r IN
    SELECT product_id, quantity FROM sale_order_items
     WHERE sale_order_id = v_id AND product_id IS NOT NULL
  LOOP
    PERFORM public.adjust_stock(
      r.product_id, r.quantity, 'sale_void', 'sale_orders', v_id
    );
  END LOOP;

  RETURN (SELECT to_jsonb(so) FROM sale_orders so WHERE id = v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.void_tiktok_sale_order(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_tiktok_sale_order(text, text) TO service_role;

-- ── create invoice request link (admin) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_tiktok_invoice_request(
  p_sale_order_id bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_order sale_orders%ROWTYPE;
  v_token text;
  v_hash  text;
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can create invoice request links' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_order FROM sale_orders WHERE id = p_sale_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % not found', p_sale_order_id USING ERRCODE = 'P0002';
  END IF;
  IF v_order.channel IS DISTINCT FROM 'tiktok' THEN
    RAISE EXCEPTION 'Invoice request links are for TikTok channel only' USING ERRCODE = '22023';
  END IF;
  IF v_order.status = 'voided' THEN
    RAISE EXCEPTION 'Cannot create link for voided order' USING ERRCODE = '22023';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_hash  := encode(digest(v_token, 'sha256'), 'hex');

  INSERT INTO tiktok_invoice_requests (sale_order_id, token_hash, expires_at)
  VALUES (p_sale_order_id, v_hash, now() + interval '30 days')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', now() + interval '30 days');
END;
$$;

REVOKE ALL ON FUNCTION public.create_tiktok_invoice_request(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_tiktok_invoice_request(bigint) TO authenticated;

-- ── submit buyer info by token (service_role via Edge Function) ─────────────
CREATE OR REPLACE FUNCTION public.submit_tiktok_invoice_buyer(
  p_token text,
  p_buyer jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_req  tiktok_invoice_requests%ROWTYPE;
  v_tax  text;
  v_row  sale_orders%ROWTYPE;
  v_name text;
  v_tax_id text;
  v_addr text;
  v_branch text;
BEGIN
  v_hash := encode(digest(p_token, 'sha256'), 'hex');
  SELECT * INTO v_req FROM tiktok_invoice_requests
   WHERE token_hash = v_hash AND submitted_at IS NULL AND expires_at > now();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invoice request token' USING ERRCODE = '22023';
  END IF;

  v_name   := NULLIF(trim(p_buyer->>'buyer_name'), '');
  v_tax_id := regexp_replace(COALESCE(p_buyer->>'buyer_tax_id', ''), '\D', '', 'g');
  v_addr   := NULLIF(trim(p_buyer->>'buyer_address'), '');
  v_branch := NULLIF(trim(p_buyer->>'buyer_branch'), '');

  IF v_name IS NULL OR v_addr IS NULL OR length(v_tax_id) < 10 OR length(v_tax_id) > 13 THEN
    RAISE EXCEPTION 'Invalid buyer details' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM sale_orders WHERE id = v_req.sale_order_id;
  IF v_row.status = 'voided' THEN
    RAISE EXCEPTION 'Order has been voided' USING ERRCODE = '22023';
  END IF;

  IF v_row.tax_invoice_no IS NULL THEN
    v_tax := public.next_tax_invoice_no(now());
  ELSE
    v_tax := v_row.tax_invoice_no;
  END IF;

  UPDATE sale_orders SET
    buyer_name = v_name,
    buyer_tax_id = v_tax_id,
    buyer_address = v_addr,
    buyer_branch = COALESCE(v_branch, buyer_branch, 'สำนักงานใหญ่'),
    tax_invoice_no = v_tax,
    tax_invoice_issued_at = COALESCE(tax_invoice_issued_at, now()),
    updated_at = now()
  WHERE id = v_req.sale_order_id
  RETURNING * INTO v_row;

  UPDATE tiktok_invoice_requests SET
    buyer_name = v_name, buyer_tax_id = v_tax_id,
    buyer_address = v_addr, buyer_branch = v_branch,
    submitted_at = now()
  WHERE id = v_req.id;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_tiktok_invoice_buyer(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_tiktok_invoice_buyer(text, jsonb) TO service_role;

-- ── unmatched TikTok line items (admin queue) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_tiktok_unmatched_items(
  p_limit int DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    FROM (
      SELECT soi.id, soi.sale_order_id, soi.product_name, so.tiktok_order_id, so.sale_date
      FROM sale_order_items soi
      JOIN sale_orders so ON so.id = soi.sale_order_id
      WHERE so.channel = 'tiktok' AND so.status = 'active' AND soi.product_id IS NULL
      ORDER BY so.sale_date DESC
      LIMIT GREATEST(1, LEAST(p_limit, 200))
    ) t
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tiktok_unmatched_items(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tiktok_unmatched_items(int) TO authenticated;
