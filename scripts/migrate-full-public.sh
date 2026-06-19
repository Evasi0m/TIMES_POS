#!/usr/bin/env bash
# Full public schema dump (schema+data) from OLD ? restore to NEW via Supabase pooler.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env.migrate"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

PG_DUMP="/opt/homebrew/opt/libpq/bin/pg_dump"
PSQL="/opt/homebrew/opt/libpq/bin/psql"
DUMP="${ROOT}/.migrate-full-public.sql"

OLD_POOLER="${OLD_POOLER_HOST:-aws-1-ap-southeast-1.pooler.supabase.com}"
NEW_POOLER="${NEW_POOLER_HOST:-aws-1-ap-southeast-1.pooler.supabase.com}"

# Use PG* env vars ù avoids libpq mis-parsing "postgres.<ref>" in a URI.
pg_connect() {
  local pooler="$1" ref="$2" pass="$3"
  export PGHOST="$pooler"
  export PGPORT=5432
  export PGUSER="postgres.${ref}"
  export PGDATABASE=postgres
  export PGPASSWORD="$pass"
  export PGSSLMODE=require
}

test_connect() {
  local label="$1"
  echo -n "Testing ${label} (${PGUSER}@${PGHOST})ù "
  if "$PSQL" -c "SELECT 1 AS ok;" >/dev/null 2>&1; then
    echo "OK"
  else
    echo "FAILED"
    echo ""
    echo "Connection failed. Check:"
    echo "  1. ${label}_DB_PASSWORD in .env.migrate matches Dashboard ? Database ? password"
    echo "  2. Password with special chars (@ # !) ù wrap in quotes: OLD_DB_PASSWORD='...'"
    echo "  3. Pooler host ù try OLD_POOLER_HOST=aws-0-ap-southeast-1.pooler.supabase.com"
    exit 1
  fi
}

pg_connect "$OLD_POOLER" "$OLD_SUPABASE_PROJECT_REF" "$OLD_DB_PASSWORD"
test_connect "OLD"

echo "Dumping OLD public (schema+data)ù"
"$PG_DUMP" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --exclude-table=public.product_cost_normalize_backup_2026_05_24 \
  --exclude-table=public.sale_item_cost_normalize_backup_2026_05_24 \
  --exclude-table=public.ai_usage_log \
  -f "$DUMP"

AUTH_DUMP="${ROOT}/.migrate-auth.sql"
echo "Dumping auth.users + auth.identities..."
"$PG_DUMP" \
  --schema=auth \
  --table=auth.users \
  --table=auth.identities \
  --no-owner \
  --no-privileges \
  --data-only \
  -f "$AUTH_DUMP"

pg_connect "$NEW_POOLER" "$NEW_SUPABASE_PROJECT_REF" "$NEW_DB_PASSWORD"
test_connect "NEW"

echo "Restoring auth users..."
"$PSQL" -v ON_ERROR_STOP=1 -c "TRUNCATE auth.identities, auth.users CASCADE;"
{
  echo "SET session_replication_role = replica;"
  cat "$AUTH_DUMP"
  echo "SET session_replication_role = DEFAULT;"
} | "$PSQL" -v ON_ERROR_STOP=1

echo "Restoring to NEW..."
"$PSQL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE;"

# Disable FK checks during restore (ai_usage_log ? auth.users etc.)
{
  echo "SET session_replication_role = replica;"
  cat "$DUMP"
  echo "SET session_replication_role = DEFAULT;"
} | "$PSQL" -v ON_ERROR_STOP=1

echo "Applying post-migrate patches (072 cron URL + vault)..."
export SUPABASE_ACCESS_TOKEN
cd "$ROOT"
/Users/j3da1/.supabase/bin/supabase db query --linked -f supabase-migrations/072_cron_project_url_new_project.sql

echo "Applying post-migrate grants (073 ù fix authenticated schema access)..."
/Users/j3da1/.supabase/bin/supabase db query --linked -f supabase-migrations/073_fix_post_restore_grants.sql

echo "Applying post-migrate telegram cron fix (074)..."
/Users/j3da1/.supabase/bin/supabase db query --linked -f supabase-migrations/074_telegram_cron_v2_fix.sql

echo "Vault service_role_keyù"
"$PSQL" <<EOSQL
DO \$\$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'service_role_key';
  PERFORM vault.create_secret('${NEW_SUPABASE_SERVICE_ROLE_KEY}', 'service_role_key', 'cron edge invoke');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'vault: %', SQLERRM;
END \$\$;
EOSQL

echo "Patch Storage URLs in product_imagesù"
"$PSQL" -v ON_ERROR_STOP=1 -c "
UPDATE public.product_images
SET image_url = replace(image_url, 'zrymhhkqdcttqsdczfcr.supabase.co', 'pxenybeudcsddsnkduaj.supabase.co')
WHERE image_url LIKE '%zrymhhkqdcttqsdczfcr.supabase.co%';
"

echo "Full migrate complete. Dump size: $(wc -c < "$DUMP" | tr -d ' ') bytes"
