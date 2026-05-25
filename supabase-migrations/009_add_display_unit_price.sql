-- 009_add_display_unit_price.sql
-- Per-line "display price" override for printed receipts.
--
-- Why: shopkeepers occasionally need the printed receipt to show a
-- different unit price to the customer than what's stored on the
-- product (e.g. discounted package deal, friend-price, complimentary
-- adjustment). Until now this was awkward: editing `unit_price`
-- distorted profit math and the bill-level "ส่วนลดบิล" line cluttered
-- the receipt.
--
-- This column is **display-only**:
--   * Profit/cost math uses products.cost_price × quantity — untouched.
--   * Revenue uses sale_orders.grand_total — untouched.
--   * Stock uses quantity — untouched.
--   * Only the receipt rendering (Receipt component) reads this field.
--
-- NULL = render the actual unit_price (default behaviour, identical to
-- pre-migration bills).

ALTER TABLE sale_order_items
  ADD COLUMN IF NOT EXISTS display_unit_price NUMERIC(12,2) NULL;

COMMENT ON COLUMN sale_order_items.display_unit_price IS
  'Override price shown on the printed receipt only. Does not affect cost/profit/grand_total/stock math. NULL = show actual unit_price.';
