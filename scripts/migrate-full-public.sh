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

old_url="postgresql://postgres.${OLD_SUPABASE_PROJECT_REF}@${OLD_POOLER}:5432/postgres?sslmode=require"
new_url="postgresql://postgres.${NEW_SUPABASE_PROJECT_REF}@${NEW_POOLER}:5432/postgres?sslmode=require"

export PGPASSWORD="$OLD_DB_PASSWORD"
echo "Dumping OLD public (schema+data) via ${OLD_POOLER}..."
"$PG_DUMP" "$old_url" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --exclude-table=public.product_cost_normalize_backup_2026_05_24 \
  --exclude-table=public.sale_item_cost_normalize_backup_2026_05_24 \
  -f "$DUMP"

if [[ "${MIGRATE_AUTH_USERS:-false}" == "true" ]]; then
  AUTH_DUMP="${ROOT}/.migrate-auth.sql"
  "$PG_DUMP" "$old_url" \
    --schema=auth \
    --table=auth.users \
    --table=auth.identities \
    --no-owner \
    --no-privileges \
    -f "$AUTH_DUMP"
fi

export PGPASSWORD="$NEW_DB_PASSWORD"
echo "Restoring to NEW via ${NEW_POOLER}..."
"$PSQL" "$new_url" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"

"$PSQL" "$new_url" -v ON_ERROR_STOP=1 -f "$DUMP"

if [[ -f "${ROOT}/.migrate-auth.sql" && "${MIGRATE_AUTH_USERS:-false}" == "true" ]]; then
  "$PSQL" "$new_url" -v ON_ERROR_STOP=1 -f "${ROOT}/.migrate-auth.sql"
fi

echo "Applying post-migrate patches (072 cron URL + vault)..."
export SUPABASE_ACCESS_TOKEN
cd "$ROOT"
/Users/j3da1/.supabase/bin/supabase db query --linked -f supabase-migrations/072_cron_project_url_new_project.sql

echo "Vault service_role_key..."
"$PSQL" "$new_url" <<EOSQL
DO \$\$
BEGIN
  DELETE FROM vault.secrets WHERE name = 'service_role_key';
  PERFORM vault.create_secret('${NEW_SUPABASE_SERVICE_ROLE_KEY}', 'service_role_key', 'cron edge invoke');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'vault: %', SQLERRM;
END \$\$;
EOSQL

echo "Patch Storage URLs in product_images..."
"$PSQL" "$new_url" -v ON_ERROR_STOP=1 -c "
UPDATE public.product_images
SET image_url = replace(image_url, 'zrymhhkqdcttqsdczfcr.supabase.co', 'pxenybeudcsddsnkduaj.supabase.co')
WHERE image_url LIKE '%zrymhhkqdcttqsdczfcr.supabase.co%';
"

echo "Full migrate complete. Dump size: $(wc -c < "$DUMP" | tr -d ' ') bytes"
