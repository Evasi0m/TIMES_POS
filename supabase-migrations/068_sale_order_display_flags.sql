-- 068: Denormalized display flags on sale_orders for list/status badges.
-- has_substitution — synced from sale_order_items.is_sku_substitution
-- has_edits        — synced from sale_order_edits inserts

ALTER TABLE public.sale_orders
  ADD COLUMN IF NOT EXISTS has_substitution boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_edits boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.sale_orders.has_substitution IS
  'True when any line has is_sku_substitution. Maintained by trigger on sale_order_items.';
COMMENT ON COLUMN public.sale_orders.has_edits IS
  'True when the bill has at least one row in sale_order_edits. Set by trigger; never cleared.';

-- ── sync has_substitution ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_sale_order_has_substitution(p_order_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.sale_orders so
     SET has_substitution = EXISTS (
       SELECT 1
         FROM public.sale_order_items soi
        WHERE soi.sale_order_id = p_order_id
          AND soi.is_sku_substitution
     ),
         updated_at = now()
   WHERE so.id = p_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sale_order_items_sync_substitution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_order_id := OLD.sale_order_id;
  ELSE
    v_order_id := NEW.sale_order_id;
  END IF;
  PERFORM public.sync_sale_order_has_substitution(v_order_id);
  IF TG_OP = 'UPDATE' AND OLD.sale_order_id IS DISTINCT FROM NEW.sale_order_id THEN
    PERFORM public.sync_sale_order_has_substitution(OLD.sale_order_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sale_order_items_sync_substitution ON public.sale_order_items;
CREATE TRIGGER sale_order_items_sync_substitution
  AFTER INSERT OR UPDATE OF is_sku_substitution, sale_order_id OR DELETE
  ON public.sale_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sale_order_items_sync_substitution();

-- ── sync has_edits ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_sale_order_edits_set_has_edits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sale_orders
     SET has_edits = true,
         updated_at = now()
   WHERE id = NEW.sale_order_id
     AND NOT has_edits;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sale_order_edits_set_has_edits ON public.sale_order_edits;
CREATE TRIGGER sale_order_edits_set_has_edits
  AFTER INSERT ON public.sale_order_edits
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sale_order_edits_set_has_edits();

-- ── backfill ────────────────────────────────────────────────────────────────

UPDATE public.sale_orders so
   SET has_substitution = EXISTS (
     SELECT 1
       FROM public.sale_order_items soi
      WHERE soi.sale_order_id = so.id
        AND soi.is_sku_substitution
   )
 WHERE so.has_substitution IS DISTINCT FROM EXISTS (
   SELECT 1
     FROM public.sale_order_items soi
    WHERE soi.sale_order_id = so.id
      AND soi.is_sku_substitution
 );

UPDATE public.sale_orders so
   SET has_edits = EXISTS (
     SELECT 1
       FROM public.sale_order_edits e
      WHERE e.sale_order_id = so.id
   )
 WHERE so.has_edits IS DISTINCT FROM EXISTS (
   SELECT 1
     FROM public.sale_order_edits e
    WHERE e.sale_order_id = so.id
 );

CREATE INDEX IF NOT EXISTS idx_sale_orders_display_flags
  ON public.sale_orders (status, has_substitution, has_edits, net_received_pending);

-- ── view for reports / SQL ──────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.sale_orders_with_display_status AS
SELECT
  so.*,
  CASE
    WHEN so.status = 'voided'
      AND so.channel = 'tiktok'
      AND position('cancel' in lower(coalesce(so.void_reason, ''))) > 0
      THEN 'cancelled_tiktok'
    WHEN so.status = 'voided' THEN 'cancelled'
    WHEN so.status = 'pending' THEN 'pending_confirm'
    WHEN so.has_substitution THEN 'substitution'
    WHEN so.net_received_pending THEN 'pending_price'
    WHEN so.has_edits THEN 'edited'
    ELSE 'normal'
  END AS display_status
FROM public.sale_orders so;

COMMENT ON VIEW public.sale_orders_with_display_status IS
  'Sale orders with a single display_status code for list badges and reports.';
