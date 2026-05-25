-- 020_edit_sale_order.sql
-- Admin-only, atomic edit of an existing active sale_order. Allows
-- correcting cashier-entry mistakes after the fact (wrong channel,
-- wrong payment method, wrong quantity) WITHOUT having to void+recreate
-- the bill. Every change is recorded in `sale_order_edits` so the
-- shop owner has a full audit trail of who changed what, when, and why.
--
-- Scope (deliberately narrow — to keep the audit semantics simple):
--   * sale_orders.channel
--   * sale_orders.payment_method
--   * sale_order_items.quantity   (per line)
--
-- Out of scope (must still go via void+recreate):
--   * Adding/removing line items
--   * Editing unit_price, discounts, cost_price
--   * Editing the customer-facing grand_total directly
--   * Editing tax invoice fields, sale_date, net_received
--     (net_received has its own admin inline-edit in SalesView)
--
-- Side-effects when an item quantity changes:
--   * Stock is auto-adjusted via public.adjust_stock (delta = old - new),
--     stamping the movement with reason='sale_edit' so the stock log
--     reads cleanly.
--   * Order totals are recomputed server-side (subtotal /
--     total_after_discount / vat_amount / grand_total) — server is the
--     authoritative source so the client can't smuggle in a
--     mathematically-impossible bill.
--   * If the original discount_type was 'net' (cashier typed the
--     after-discount total directly), the net stays fixed and the stored
--     discount_value adjusts to match the new subtotal. For 'baht' /
--     'percent' / null, we apply the rule afresh so the bill semantics
--     match what the cashier originally meant.
--
-- The RPC is idempotent in the no-op sense: if nothing actually
-- changes, it does nothing and inserts no audit row. This keeps the
-- audit log honest (no "edits" that didn't edit anything).

-- ====================================================================
-- 1. Audit table
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.sale_order_edits (
  id              bigserial   PRIMARY KEY,
  sale_order_id   bigint      NOT NULL REFERENCES public.sale_orders(id) ON DELETE CASCADE,
  edited_at       timestamptz NOT NULL DEFAULT now(),
  edited_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Snapshotted at write time. We never want the audit log to "forget"
  -- who did the edit if the user account is later deleted/disabled, and
  -- we don't want to JOIN to auth.users every time we render history.
  edited_by_email text,
  -- JSON array of change records, each shape one of:
  --   { "field": "channel",        "old": "tiktok",  "new": "shopee" }
  --   { "field": "payment_method", "old": "transfer","new": "card"   }
  --   { "field": "quantity",       "old": 2,         "new": 1,
  --     "item_id": 99001, "product_id": 10519, "product_name": "GBD-200SM-1A5DR" }
  -- Recomputed totals are NOT recorded as separate rows because they're
  -- derivative — derivable from the line+header changes plus the bill
  -- snapshot. This keeps the log scannable.
  changes         jsonb       NOT NULL,
  reason          text
);

CREATE INDEX IF NOT EXISTS idx_sale_order_edits_order
  ON public.sale_order_edits(sale_order_id, edited_at DESC);

ALTER TABLE public.sale_order_edits ENABLE ROW LEVEL SECURITY;

-- Admin (or super_admin) can read the full edit log. Cashiers/visitors
-- have no business seeing who edited what. Writes happen ONLY via the
-- SECURITY DEFINER RPC below — no direct INSERT policy needed.
DROP POLICY IF EXISTS sale_order_edits_admin_read ON public.sale_order_edits;
CREATE POLICY sale_order_edits_admin_read
  ON public.sale_order_edits
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ====================================================================
-- 2. Helper: replicate the JS applyDiscounts() math server-side
-- ====================================================================
-- Mirrors src/main.jsx applyDiscounts(). Rounds at every intermediate
-- step to 2dp so float drift can't cause the displayed total to disagree
-- with the persisted total. Returns the per-line revenue (post both
-- line-level discounts, multiplied by qty).
CREATE OR REPLACE FUNCTION public._line_revenue(
  unit_price numeric,
  qty        integer,
  d1v        numeric,
  d1t        text,
  d2v        numeric,
  d2t        text
) RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  WITH s1 AS (
    SELECT CASE
      WHEN d1t = 'percent' THEN round(round(coalesce(unit_price,0), 2) * (1 - coalesce(d1v,0)/100), 2)
      WHEN d1t = 'baht'    THEN round(round(coalesce(unit_price,0), 2) - coalesce(d1v,0), 2)
      ELSE round(coalesce(unit_price,0), 2)
    END AS v
  ),
  s2 AS (
    SELECT CASE
      WHEN d2t = 'percent' THEN round((SELECT v FROM s1) * (1 - coalesce(d2v,0)/100), 2)
      WHEN d2t = 'baht'    THEN round((SELECT v FROM s1) - coalesce(d2v,0), 2)
      ELSE (SELECT v FROM s1)
    END AS v
  )
  SELECT round(GREATEST(0, (SELECT v FROM s2)) * coalesce(qty,0), 2);
$$;

REVOKE ALL ON FUNCTION public._line_revenue(numeric,integer,numeric,text,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._line_revenue(numeric,integer,numeric,text,numeric,text) TO authenticated;

-- ====================================================================
-- 3. Main RPC
-- ====================================================================
CREATE OR REPLACE FUNCTION public.edit_sale_order(
  p_sale_order_id  bigint,
  p_channel        text    DEFAULT NULL,
  p_payment_method text    DEFAULT NULL,
  p_items          jsonb   DEFAULT '[]'::jsonb,  -- [{id: bigint, quantity: int}, ...]
  p_reason         text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_order      public.sale_orders%ROWTYPE;
  v_changes    jsonb := '[]'::jsonb;
  v_item       jsonb;
  v_old_qty    integer;
  v_new_qty    integer;
  v_item_id    bigint;
  v_product_id bigint;
  v_product_nm text;
  v_old_chan   text;
  v_old_pay    text;
  v_email      text;
  v_uid        uuid;
  v_subtotal   numeric;
  v_total_ad   numeric;
  v_grand      numeric;
  v_disc_val   numeric;
  v_disc_type  text;
  v_vat_rate   numeric;
  v_vat_amt    numeric;
BEGIN
  -- ── Auth + role gate ──────────────────────────────────────────────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be logged in' USING ERRCODE = '28000';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admin can edit sale orders' USING ERRCODE = '42501';
  END IF;

  -- ── Load + lock the order ─────────────────────────────────────────
  SELECT * INTO v_order FROM public.sale_orders
   WHERE id = p_sale_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale order % not found', p_sale_order_id USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status <> 'active' THEN
    RAISE EXCEPTION 'Cannot edit a voided sale order' USING ERRCODE = '22023';
  END IF;

  -- Validate channel / payment if provided.
  IF p_channel IS NOT NULL AND p_channel NOT IN ('tiktok','shopee','facebook','store','lazada') THEN
    RAISE EXCEPTION 'Invalid channel: %', p_channel USING ERRCODE = '22023';
  END IF;
  IF p_payment_method IS NOT NULL AND p_payment_method NOT IN ('cash','transfer','card','paylater','cod') THEN
    RAISE EXCEPTION 'Invalid payment_method: %', p_payment_method USING ERRCODE = '22023';
  END IF;

  -- ── Diff: header fields ───────────────────────────────────────────
  v_old_chan := v_order.channel;
  v_old_pay  := v_order.payment_method;

  IF p_channel IS NOT NULL AND p_channel IS DISTINCT FROM v_old_chan THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'channel',
      'old',   to_jsonb(v_old_chan),
      'new',   to_jsonb(p_channel)
    );
  END IF;

  IF p_payment_method IS NOT NULL AND p_payment_method IS DISTINCT FROM v_old_pay THEN
    v_changes := v_changes || jsonb_build_object(
      'field', 'payment_method',
      'old',   to_jsonb(v_old_pay),
      'new',   to_jsonb(p_payment_method)
    );
  END IF;

  -- ── Diff: per-line quantities + apply stock adjustments ───────────
  IF jsonb_typeof(p_items) = 'array' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_item_id := (v_item->>'id')::bigint;
      v_new_qty := (v_item->>'quantity')::integer;
      IF v_item_id IS NULL OR v_new_qty IS NULL THEN
        RAISE EXCEPTION 'Each item must include id + quantity' USING ERRCODE = '22023';
      END IF;
      IF v_new_qty < 1 THEN
        RAISE EXCEPTION 'Quantity must be >= 1 (item id=%)', v_item_id USING ERRCODE = '22023';
      END IF;

      -- Pull the old qty + product reference (locked under the order's row lock).
      SELECT quantity, product_id, product_name
        INTO v_old_qty, v_product_id, v_product_nm
        FROM public.sale_order_items
       WHERE id = v_item_id AND sale_order_id = p_sale_order_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Line item % does not belong to sale order %', v_item_id, p_sale_order_id USING ERRCODE = '22023';
      END IF;

      IF v_new_qty <> v_old_qty THEN
        UPDATE public.sale_order_items
           SET quantity = v_new_qty
         WHERE id = v_item_id;

        -- Stock: positive delta puts units BACK in stock when qty goes
        -- down (we sold fewer than we thought); negative delta removes
        -- more from stock when qty goes up (we sold more than we
        -- thought). Reason 'sale_edit' is distinct from 'sale' /
        -- 'sale_void' so the stock log audit trail is unambiguous.
        IF v_product_id IS NOT NULL THEN
          PERFORM public.adjust_stock(
            p_id        => v_product_id,
            qty_delta   => (v_old_qty - v_new_qty),
            p_reason    => 'sale_edit',
            p_ref_table => 'sale_orders',
            p_ref_id    => p_sale_order_id
          );
        END IF;

        v_changes := v_changes || jsonb_build_object(
          'field',         'quantity',
          'old',           to_jsonb(v_old_qty),
          'new',           to_jsonb(v_new_qty),
          'item_id',       to_jsonb(v_item_id),
          'product_id',    to_jsonb(v_product_id),
          'product_name',  to_jsonb(v_product_nm)
        );
      END IF;
    END LOOP;
  END IF;

  -- No-op: nothing actually changed → return current row, skip audit.
  IF jsonb_array_length(v_changes) = 0 THEN
    RETURN to_jsonb(v_order);
  END IF;

  -- ── Apply header field changes ───────────────────────────────────
  IF p_channel IS NOT NULL AND p_channel IS DISTINCT FROM v_old_chan THEN
    UPDATE public.sale_orders SET channel = p_channel WHERE id = p_sale_order_id;
  END IF;
  IF p_payment_method IS NOT NULL AND p_payment_method IS DISTINCT FROM v_old_pay THEN
    UPDATE public.sale_orders SET payment_method = p_payment_method WHERE id = p_sale_order_id;
  END IF;

  -- ── Recompute order totals from the (possibly updated) line items ─
  -- Authoritative server-side recomputation. We re-read everything
  -- from sale_order_items so any qty edit done above is reflected.
  SELECT COALESCE(SUM(public._line_revenue(
           unit_price, quantity,
           discount1_value, discount1_type,
           discount2_value, discount2_type)), 0)
    INTO v_subtotal
    FROM public.sale_order_items
   WHERE sale_order_id = p_sale_order_id;

  v_disc_val  := COALESCE(v_order.discount_value, 0);
  v_disc_type := v_order.discount_type;

  -- For 'net'-type bills the cashier originally typed the customer-net
  -- directly. Preserve that net (the customer paid what they paid),
  -- and instead derive a fresh discount_value so the math reconciles.
  IF v_disc_type = 'net' THEN
    v_total_ad := COALESCE(v_order.total_after_discount, v_subtotal);
    v_disc_val := GREATEST(0, round(v_subtotal - v_total_ad, 2));
  ELSIF v_disc_type = 'percent' THEN
    v_total_ad := round(GREATEST(0, v_subtotal * (1 - v_disc_val/100)), 2);
  ELSIF v_disc_type = 'baht' THEN
    v_total_ad := round(GREATEST(0, v_subtotal - v_disc_val), 2);
  ELSE
    v_total_ad := round(v_subtotal, 2);
  END IF;

  v_grand    := round(v_total_ad, 2);
  v_vat_rate := COALESCE(v_order.vat_rate, 7);
  -- VAT-inclusive pricing (Thai retail standard) — same formula as
  -- vatBreakdown() in main.jsx.
  IF v_vat_rate > 0 THEN
    v_vat_amt := round(v_grand - round(v_grand / (1 + v_vat_rate/100), 2), 2);
  ELSE
    v_vat_amt := 0;
  END IF;

  UPDATE public.sale_orders
     SET subtotal              = round(v_subtotal, 2),
         discount_value        = v_disc_val,
         total_after_discount  = v_total_ad,
         grand_total           = v_grand,
         vat_amount            = v_vat_amt,
         updated_at            = now()
   WHERE id = p_sale_order_id;

  -- ── Audit row ────────────────────────────────────────────────────
  -- Snapshot the email so we never lose attribution when an account is
  -- later removed.
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  INSERT INTO public.sale_order_edits (
    sale_order_id, edited_by, edited_by_email, changes, reason
  ) VALUES (
    p_sale_order_id, v_uid, v_email, v_changes, NULLIF(trim(p_reason), '')
  );

  -- Return the updated row so the client can refresh its view in one
  -- round-trip.
  SELECT * INTO v_order FROM public.sale_orders WHERE id = p_sale_order_id;
  RETURN to_jsonb(v_order);
END;
$$;

REVOKE ALL ON FUNCTION public.edit_sale_order(bigint, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edit_sale_order(bigint, text, text, jsonb, text) TO authenticated;
