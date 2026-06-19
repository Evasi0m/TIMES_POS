-- 071: Receive-cost RPCs — one round-trip instead of paginated receive_order_items joins.
-- Hot path: ProductsView "?????????", sales/PnL reports (as-of-sale cost lookup).

CREATE OR REPLACE FUNCTION public.get_product_latest_receive_costs()
RETURNS TABLE (
  product_id   bigint,
  unit_price   numeric,
  receive_date timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (roi.product_id)
    roi.product_id,
    roi.unit_price,
    ro.receive_date
  FROM public.receive_order_items roi
  INNER JOIN public.receive_orders ro ON ro.id = roi.receive_order_id
  WHERE ro.voided_at IS NULL
  ORDER BY roi.product_id, ro.receive_date DESC, roi.id DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_receive_cost_timeline(
  p_product_ids bigint[],
  p_before      timestamptz DEFAULT NULL
)
RETURNS TABLE (
  product_id   bigint,
  receive_date timestamptz,
  unit_price   numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    roi.product_id,
    ro.receive_date,
    roi.unit_price
  FROM public.receive_order_items roi
  INNER JOIN public.receive_orders ro ON ro.id = roi.receive_order_id
  WHERE roi.product_id = ANY(p_product_ids)
    AND ro.voided_at IS NULL
    AND (p_before IS NULL OR ro.receive_date <= p_before)
  ORDER BY roi.product_id, ro.receive_date DESC;
$$;

REVOKE ALL ON FUNCTION public.get_product_latest_receive_costs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_receive_cost_timeline(bigint[], timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_latest_receive_costs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_receive_cost_timeline(bigint[], timestamptz) TO authenticated;
