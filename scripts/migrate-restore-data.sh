#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env.migrate"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${NEW_DB_PASSWORD:?}"
: "${NEW_SUPABASE_PROJECT_REF:?}"
: "${NEW_SUPABASE_SERVICE_ROLE_KEY:?}"

PSQL="/opt/homebrew/opt/libpq/bin/psql"
DATA="${ROOT}/.migrate-data-public.sql"
DATA_AUTH="${ROOT}/.migrate-data-auth.sql"
export PGPASSWORD="$NEW_DB_PASSWORD"
DB="postgresql://postgres@db.${NEW_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require"

echo "Stashing service_role_key in vault..."
"$PSQL" "$DB" <<EOSQL
DO \$\$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'service_role_key';
  PERFORM vault.create_secret('${NEW_SUPABASE_SERVICE_ROLE_KEY}', 'service_role_key', 'POS cron edge invoke');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'vault: %', SQLERRM;
END \$\$;
EOSQL

echo "Restoring public data..."
"$PSQL" "$DB" -v ON_ERROR_STOP=1 \
  -c "SET session_replication_role = replica;" \
  -f "$DATA" \
  -c "SET session_replication_role = DEFAULT;"

if [[ -f "$DATA_AUTH" && "${MIGRATE_AUTH_USERS:-false}" == "true" ]]; then
  echo "Restoring auth users..."
  "$PSQL" "$DB" -v ON_ERROR_STOP=1 \
    -c "SET session_replication_role = replica;" \
    -f "$DATA_AUTH" \
    -c "SET session_replication_role = DEFAULT;"
fi

echo "Resetting sequences..."
"$PSQL" "$DB" -v ON_ERROR_STOP=1 <<'EOSQL'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS seq, a.attrelid::regclass AS tbl, a.attname AS col
    FROM pg_class c
    JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
    WHERE c.relkind = 'S' AND c.relnamespace = 'public'::regnamespace
  LOOP
    EXECUTE format(
      'SELECT setval(%L, COALESCE((SELECT MAX(%I) FROM %s), 1))',
      r.seq, r.col, r.tbl
    );
  END LOOP;
END $$;
EOSQL

echo "Patching product_images Storage URLs..."
"$PSQL" "$DB" -v ON_ERROR_STOP=1 -c "
UPDATE public.product_images
SET image_url = replace(
  image_url,
  'zrymhhkqdcttqsdczfcr.supabase.co',
  'pxenybeudcsddsnkduaj.supabase.co'
)
WHERE image_url LIKE '%zrymhhkqdcttqsdczfcr.supabase.co%';
"

echo "Data restore complete"
