#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env.migrate"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${OLD_DB_PASSWORD:?}"
: "${OLD_SUPABASE_PROJECT_REF:?}"

PG_DUMP="/opt/homebrew/opt/libpq/bin/pg_dump"
OUT="${ROOT}/.migrate-data-public.sql"
OUT_AUTH="${ROOT}/.migrate-data-auth.sql"
export PGPASSWORD="$OLD_DB_PASSWORD"
DB="postgresql://postgres@db.${OLD_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require"

echo "Dumping public data from ${OLD_SUPABASE_PROJECT_REF}..."
"$PG_DUMP" "$DB" \
  --data-only \
  --schema=public \
  --no-owner \
  --disable-triggers \
  --exclude-table=public.product_cost_normalize_backup_2026_05_24 \
  --exclude-table=public.sale_item_cost_normalize_backup_2026_05_24 \
  -f "$OUT"

if [[ "${MIGRATE_AUTH_USERS:-false}" == "true" ]]; then
  echo "Dumping auth.users + auth.identities..."
  "$PG_DUMP" "$DB" \
    --data-only \
    --schema=auth \
    --table=auth.users \
    --table=auth.identities \
    --no-owner \
    --disable-triggers \
    -f "$OUT_AUTH"
fi

echo "Dump written: $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
