-- 093_merge_products.sql
-- Merge a duplicate product into the one to keep (e.g. "AQ-240B-7A2DF" keyed
-- by mistake for "AQ-240E-7A2"). Every reference moves to the keeper, the
-- duplicate is deleted, and the whole thing is recorded in deletion_audit.
--
--   merge_products(p_keep, p_dup, p_final_stock, p_reason)
--     p_final_stock  keeper's stock after the merge (UI default = keep + dup).
--                    A difference from the keeper's current stock is booked
--                    through adjust_stock(..., 'manual_adjust') so it is in the
--                    stock log and goes out to BigSeller like any adjustment.
--   merge_products_preview(p_keep, p_dup) → reference counts, no changes.
--
-- Moved: sale / receive / return / supplier-claim lines, stock_movements,
-- stock_manual_adjustments, TikTok mappings + sync log, image jobs.
-- product_images / bigseller_sku_map are one-per-product: the keeper's row
-- wins, the duplicate's moves over only when the keeper has none.
-- History keeps its own text (sale lines keep product_name as sold).
--
-- Super admin only: the guard key 'products.merge' is granted to no role.
-- Idempotent.

ALTER TABLE public.deletion_audit DROP CONSTRAINT IF EXISTS deletion_audit_entity_type_check;
ALTER TABLE public.deletion_audit
  ADD CONSTRAINT deletion_audit_entity_type_check
  CHECK (entity_type IN ('product', 'receive_line', 'receive_order', 'product_merge'));

CREATE OR REPLACE FUNCTION public.merge_products_preview(p_keep bigint, p_dup bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'keep', (SELECT jsonb_build_object('id', id, 'name', name, 'stock', current_stock, 'barcode', barcode) FROM products WHERE id = p_keep),
    'dup',  (SELECT jsonb_build_object('id', id, 'name', name, 'stock', current_stock, 'barcode', barcode) FROM products WHERE id = p_dup),
    'sale_lines',     (SELECT count(*) FROM sale_order_items WHERE product_id = p_dup),
    'receive_lines',  (SELECT count(*) FROM receive_order_items WHERE product_id = p_dup),
    'return_lines',   (SELECT count(*) FROM return_order_items WHERE product_id = p_dup),
    'claim_lines',    (SELECT count(*) FROM supplier_claim_order_items WHERE product_id = p_dup),
    'movements',      (SELECT count(*) FROM stock_movements WHERE product_id = p_dup),
    'tiktok_skus',    (SELECT COALESCE(jsonb_agg(seller_sku), '[]'::jsonb) FROM tiktok_product_mappings WHERE product_id = p_dup),
    'dup_bigseller',  (SELECT merchant_sku FROM bigseller_sku_map WHERE product_id = p_dup),
    'keep_bigseller', (SELECT merchant_sku FROM bigseller_sku_map WHERE product_id = p_keep)
  );
$$;

CREATE OR REPLACE FUNCTION public.merge_products(
  p_keep        bigint,
  p_dup         bigint,
  p_final_stock integer,
  p_reason      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_keep   products%ROWTYPE;
  v_dup    products%ROWTYPE;
  v_counts jsonb;
  v_delta  integer;
BEGIN
  IF p_keep IS NULL OR p_dup IS NULL OR p_keep = p_dup THEN
    RAISE EXCEPTION 'เลือกสินค้าหลักและสินค้าซ้ำให้ต่างกัน' USING ERRCODE = '22023';
  END IF;
  IF p_final_stock IS NULL THEN
    RAISE EXCEPTION 'ต้องระบุสต็อกหลังรวม' USING ERRCODE = '22023';
  END IF;

  -- Lock both rows in id order (no deadlock with a concurrent merge).
  PERFORM 1 FROM products WHERE id IN (p_keep, p_dup) ORDER BY id FOR UPDATE;
  SELECT * INTO v_keep FROM products WHERE id = p_keep;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบสินค้าหลัก #%', p_keep USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_dup FROM products WHERE id = p_dup;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบสินค้าซ้ำ #%', p_dup USING ERRCODE = 'P0002'; END IF;

  v_counts := public.merge_products_preview(p_keep, p_dup);

  UPDATE sale_order_items           SET product_id = p_keep WHERE product_id = p_dup;
  UPDATE receive_order_items        SET product_id = p_keep WHERE product_id = p_dup;
  UPDATE return_order_items         SET product_id = p_keep WHERE product_id = p_dup;
  UPDATE supplier_claim_order_items SET product_id = p_keep WHERE product_id = p_dup;
  UPDATE stock_movements            SET product_id = p_keep WHERE product_id = p_dup;
  UPDATE stock_manual_adjustments   SET product_id = p_keep WHERE product_id = p_dup;
  UPDATE tiktok_product_mappings    SET product_id = p_keep, updated_at = now() WHERE product_id = p_dup;
  UPDATE tiktok_inventory_sync_log  SET product_id = p_keep WHERE product_id = p_dup;
  UPDATE product_image_jobs         SET product_id = p_keep WHERE product_id = p_dup;

  IF EXISTS (SELECT 1 FROM product_images WHERE product_id = p_keep) THEN
    DELETE FROM product_images WHERE product_id = p_dup;
  ELSE
    UPDATE product_images SET product_id = p_keep WHERE product_id = p_dup;
  END IF;
  IF EXISTS (SELECT 1 FROM bigseller_sku_map WHERE product_id = p_keep) THEN
    DELETE FROM bigseller_sku_map WHERE product_id = p_dup;
  ELSE
    UPDATE bigseller_sku_map SET product_id = p_keep WHERE product_id = p_dup;
  END IF;

  -- Keeper inherits a missing barcode ('' or the '-' placeholder).
  IF NULLIF(NULLIF(btrim(v_keep.barcode), ''), '-') IS NULL
     AND NULLIF(NULLIF(btrim(v_dup.barcode), ''), '-') IS NOT NULL THEN
    UPDATE products SET barcode = NULL WHERE id = p_dup;
    UPDATE products SET barcode = v_dup.barcode WHERE id = p_keep;
  END IF;

  DELETE FROM products WHERE id = p_dup;

  v_delta := p_final_stock - v_keep.current_stock;
  IF v_delta <> 0 THEN
    PERFORM public.adjust_stock(p_keep, v_delta, 'manual_adjust', 'products', p_dup);
  END IF;

  INSERT INTO deletion_audit (entity_type, entity_id, snapshot, side_effects, reason, deleted_by, deleted_by_email)
  VALUES (
    'product_merge', p_dup,
    jsonb_build_object('dup', to_jsonb(v_dup), 'keep', to_jsonb(v_keep)),
    v_counts || jsonb_build_object('final_stock', p_final_stock, 'stock_delta', v_delta),
    p_reason, auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid())
  );

  RETURN v_counts || jsonb_build_object('final_stock', p_final_stock, 'stock_delta', v_delta);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_products_preview(bigint, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.merge_products(bigint, bigint, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_products_preview(bigint, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.merge_products(bigint, bigint, integer, text) TO authenticated;

-- Super admin only: make sure no editable role carries the key.
UPDATE public.role_permissions
   SET permissions = permissions - 'products.merge', updated_at = now()
 WHERE permissions ? 'products.merge';

INSERT INTO public.rpc_perm_guards (fn_name, perm, arg_name, arg_perms) VALUES
  ('merge_products_preview', 'products.merge', NULL, NULL),
  ('merge_products',         'products.merge', NULL, NULL)
ON CONFLICT (fn_name) DO UPDATE SET perm = EXCLUDED.perm;

SELECT public.apply_perm_guards();
