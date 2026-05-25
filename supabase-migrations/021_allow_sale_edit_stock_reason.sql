-- 021_allow_sale_edit_stock_reason.sql
-- Allow the sale-order edit RPC to leave clear stock audit rows when a
-- historical sale quantity is corrected. The `edit_sale_order` RPC calls
-- adjust_stock(..., p_reason => 'sale_edit', ...), so the stock_movements
-- reason CHECK constraint must explicitly permit that value.

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reason_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_reason_check
  CHECK (reason = ANY (ARRAY[
    'sale'::text,
    'sale_void'::text,
    'sale_edit'::text,
    'receive'::text,
    'receive_void'::text,
    'return_in'::text,
    'return_void'::text,
    'manual_adjust'::text,
    'initial'::text,
    'supplier_claim'::text,
    'supplier_claim_void'::text
  ]));
