#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env.migrate"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${NEW_DB_PASSWORD:?NEW_DB_PASSWORD missing in .env.migrate}"
: "${NEW_SUPABASE_PROJECT_REF:?NEW_SUPABASE_PROJECT_REF missing}"

PSQL="/opt/homebrew/opt/libpq/bin/psql"
export PGPASSWORD="$NEW_DB_PASSWORD"
DB="postgresql://postgres@db.${NEW_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres?sslmode=require"

echo "Applying migrations to ${NEW_SUPABASE_PROJECT_REF}..."
for f in $(ls "$ROOT"/supabase-migrations/*.sql | sort); do
  echo "  $(basename "$f")"
  "$PSQL" "$DB" -v ON_ERROR_STOP=1 -f "$f" -q
done
