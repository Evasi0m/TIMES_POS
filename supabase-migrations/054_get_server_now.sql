-- Read-only helper for client-side server clock sync (timezone plan Phase 3).
-- Does NOT modify any existing rows.

CREATE OR REPLACE FUNCTION public.get_server_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$ SELECT now() $$;

REVOKE ALL ON FUNCTION public.get_server_now() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_server_now() TO authenticated;
