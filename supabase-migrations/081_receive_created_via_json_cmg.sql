-- Migration 081 — allow JSON CMG bill import provenance.
--
-- BulkReceiveView already writes created_via = 'json_cmg' for JSON imports.
-- receive_orders_created_via_check only allowed 'manual' | 'ai_cmg', so every
-- JSON import failed at RPC time with Postgres 23514 (mapped to a generic
-- validation toast). AI scan (ai_cmg) was unaffected.

ALTER TABLE public.receive_orders
  DROP CONSTRAINT IF EXISTS receive_orders_created_via_check;

ALTER TABLE public.receive_orders
  ADD CONSTRAINT receive_orders_created_via_check
  CHECK (created_via = ANY (ARRAY['manual'::text, 'ai_cmg'::text, 'json_cmg'::text]));
