-- 002_create_stock_movement_with_items.sql
-- Atomic stock movement: header + items + adjust_stock in one transaction.
-- Covers all three kinds the client supports:
--   'receive' → receive_orders / receive_order_items, stock +qty
--   'claim'   → supplier_claim_orders / supplier_claim_order_items, stock -qty
--   'return'  → return_orders / return_order_items, stock +qty
--
-- Why: same correctness reason as 001 — the previous client did 3 calls
-- (insert header → insert items → Promise.all(adjust_stock)). A failure mid-flow
-- left orphaned rows and inconsistent stock.
--
-- Signature:
--   create_stock_movement_with_items(p_kind text, p_header jsonb, p_items jsonb) RETURNS jsonb
-- Returns: the inserted header row as JSON.

CREATE OR REPLACE FUNCTION public.create_stock_movement_with_items(
  p_kind   text,
  p_header jsonb,
  p_items  jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_header_table text;
  v_item_table   text;
  v_date_field   text;
  v_fk_field     text;
  v_stock_reason text;
  v_stock_sign   int;
  v_id           bigint;
  v_sql          text;
  v_header_row   jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: must be a logged-in user' USING ERRCODE = '28000';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'p_items must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;

  -- Map the kind to the per-flow table/field names.
  CASE p_kind
    WHEN 'receive' THEN
      v_header_table := 'receive_orders';
      v_item_table   := 'receive_order_items';
      v_date_field   := 'receive_date';
      v_fk_field     := 'receive_order_id';
      v_stock_reason := 'receive';
      v_stock_sign   := 1;
    WHEN 'claim' THEN
      v_header_table := 'supplier_claim_orders';
      v_item_table   := 'supplier_claim_order_items';
      v_date_field   := 'claim_date';
      v_fk_field     := 'supplier_claim_order_id';
      v_stock_reason := 'supplier_claim';
      v_stock_sign   := -1;
    WHEN 'return' THEN
      v_header_table := 'return_orders';
      v_item_table   := 'return_order_items';
      v_date_field   := 'return_date';
      v_fk_field     := 'return_order_id';
      v_stock_reason := 'return_in';
      v_stock_sign   := 1;
    ELSE
      RAISE EXCEPTION 'Unknown movement kind: %', p_kind USING ERRCODE = '22023';
  END CASE;

  -- Insert header. Different kinds use different columns; we hand-craft per kind
  -- to avoid silently dropping unknown fields.
  IF p_kind = 'receive' OR p_kind = 'claim' THEN
    v_sql := format(
      'INSERT INTO %I (%I, total_value, notes, vat_rate, vat_amount, supplier_name, supplier_invoice_no%s) '
      'VALUES ($1, $2, $3, $4, $5, $6, $7%s) RETURNING id',
      v_header_table, v_date_field,
      CASE WHEN p_kind = 'claim' THEN ', claim_reason' ELSE '' END,
      CASE WHEN p_kind = 'claim' THEN ', $8' ELSE '' END
    );
    IF p_kind = 'claim' THEN
      EXECUTE v_sql INTO v_id USING
        COALESCE((p_header->>v_date_field)::timestamptz, now()),
        COALESCE((p_header->>'total_value')::numeric, 0),
        NULLIF(p_header->>'notes',''),
        COALESCE((p_header->>'vat_rate')::numeric, 0),
        COALESCE((p_header->>'vat_amount')::numeric, 0),
        NULLIF(p_header->>'supplier_name',''),
        NULLIF(p_header->>'supplier_invoice_no',''),
        NULLIF(p_header->>'claim_reason','');
    ELSE
      EXECUTE v_sql INTO v_id USING
        COALESCE((p_header->>v_date_field)::timestamptz, now()),
        COALESCE((p_header->>'total_value')::numeric, 0),
        NULLIF(p_header->>'notes',''),
        COALESCE((p_header->>'vat_rate')::numeric, 0),
        COALESCE((p_header->>'vat_amount')::numeric, 0),
        NULLIF(p_header->>'supplier_name',''),
        NULLIF(p_header->>'supplier_invoice_no','');
    END IF;
  ELSE -- 'return'
    EXECUTE format(
      'INSERT INTO %I (%I, total_value, notes, channel, return_reason, original_sale_order_id) '
      'VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      v_header_table, v_date_field
    ) INTO v_id USING
      COALESCE((p_header->>v_date_field)::timestamptz, now()),
      COALESCE((p_header->>'total_value')::numeric, 0),
      NULLIF(p_header->>'notes',''),
      COALESCE(p_header->>'channel','store'),
      NULLIF(p_header->>'return_reason',''),
      NULLIF(p_header->>'original_sale_order_id','')::bigint;
  END IF;

  -- Insert items. All three flows share the same item shape.
  EXECUTE format(
    'INSERT INTO %I (%I, product_id, product_name, quantity, unit, unit_price, '
    'discount1_value, discount1_type, discount2_value, discount2_type) '
    'SELECT $1, NULLIF(item->>''product_id'','''')::bigint, item->>''product_name'', '
    '       COALESCE((item->>''quantity'')::numeric, 0), '
    '       item->>''unit'', '
    '       COALESCE((item->>''unit_price'')::numeric, 0), '
    '       COALESCE((item->>''discount1_value'')::numeric, 0), item->>''discount1_type'', '
    '       COALESCE((item->>''discount2_value'')::numeric, 0), item->>''discount2_type'' '
    'FROM jsonb_array_elements($2) AS item',
    v_item_table, v_fk_field
  ) USING v_id, p_items;

  -- Stock adjustments — reuse adjust_stock so stock_movements audit stays consistent.
  PERFORM public.adjust_stock(
    p_id        => (item->>'product_id')::bigint,
    qty_delta   => v_stock_sign * (item->>'quantity')::numeric,
    p_reason    => v_stock_reason,
    p_ref_table => v_header_table,
    p_ref_id    => v_id
  )
  FROM jsonb_array_elements(p_items) AS item
  WHERE NULLIF(item->>'product_id','') IS NOT NULL;

  EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1', v_header_table)
    INTO v_header_row USING v_id;
  RETURN v_header_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_stock_movement_with_items(text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_stock_movement_with_items(text, jsonb, jsonb) TO authenticated;
