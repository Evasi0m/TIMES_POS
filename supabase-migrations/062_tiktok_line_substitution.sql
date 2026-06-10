-- 062: TikTok line-item substitution audit + skip mapping upsert when substitute=true

ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS is_sku_substitution boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS substitution_note text,
  ADD COLUMN IF NOT EXISTS fulfilled_product_id bigint REFERENCES public.products(id);

COMMENT ON COLUMN public.sale_order_items.is_sku_substitution IS
  'True when cashier confirmed a different POS product than the TikTok seller_sku on this line.';
COMMENT ON COLUMN public.sale_order_items.substitution_note IS
  'Optional note when shipping a different model than ordered on TikTok (e.g. customer requested color change).';
COMMENT ON COLUMN public.sale_order_items.fulfilled_product_id IS
  'Product actually shipped; equals product_id after confirm when is_sku_substitution is true.';

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
  v_substitute boolean;
  v_sub_note   text;
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
      v_substitute := COALESCE((v_entry->>'substitute')::boolean, false);
      v_sub_note   := NULLIF(trim(v_entry->>'substitution_note'), '');
      IF v_item_id IS NULL OR v_product_id IS NULL THEN
        CONTINUE;
      END IF;
      UPDATE sale_order_items soi
         SET product_id            = v_product_id,
             product_name          = p.name,
             cost_price            = COALESCE(soi.cost_price, p.cost_price),
             is_sku_substitution   = v_substitute,
             substitution_note     = CASE WHEN v_substitute THEN v_sub_note ELSE NULL END,
             fulfilled_product_id  = CASE WHEN v_substitute THEN v_product_id ELSE NULL END
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

  -- Skip mapping upsert for substituted lines (one-off fulfillment, not permanent SKU map).
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
      NULLIF(trim(elem->>'warehouse_id'), '') AS warehouse_id,
      COALESCE((elem->>'substitute')::boolean, false) AS substitute
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) elem
    WHERE NULLIF(elem->>'item_id', '')::bigint = soi.id
    LIMIT 1
  ) pi ON true
  LEFT JOIN public.tiktok_product_mappings em
    ON em.tiktok_sku_id = soi.tiktok_sku_id
  WHERE soi.sale_order_id = p_order_id
    AND soi.tiktok_sku_id IS NOT NULL
    AND soi.product_id IS NOT NULL
    AND COALESCE(pi.substitute, soi.is_sku_substitution, false) = false
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

REVOKE ALL ON FUNCTION public.confirm_tiktok_sale_order(bigint, jsonb, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_tiktok_sale_order(bigint, jsonb, numeric) TO authenticated;
