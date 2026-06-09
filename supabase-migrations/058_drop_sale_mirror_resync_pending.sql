-- 058: stop surfacing stale pending sale-mirror bills in health (manual TikTok stock baseline).

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
    'catalog_mirror_max_skus', 500,
    'checked_at', now()
  );
END;
$$;
