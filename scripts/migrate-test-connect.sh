#!/usr/bin/env bash
# Quick test: can we connect to OLD and NEW pooler with .env.migrate passwords?
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a
# shellcheck disable=SC1090
source "${ROOT}/.env.migrate"
set +a

PSQL="/opt/homebrew/opt/libpq/bin/psql"

try() {
  local label="$1" pooler="$2" ref="$3" pass="$4"
  export PGHOST="$pooler" PGPORT=5432 PGUSER="postgres.${ref}" PGDATABASE=postgres
  export PGPASSWORD="$pass" PGSSLMODE=require
  printf "%-6s %-40s " "$label" "${PGUSER}@${pooler}"
  if "$PSQL" -c "SELECT 1;" >/dev/null 2>&1; then echo "OK"; return 0; fi
  echo "FAIL"
  return 1
}

ok=0
for pooler in aws-1-ap-southeast-1.pooler.supabase.com aws-0-ap-southeast-1.pooler.supabase.com; do
  try "OLD" "$pooler" "$OLD_SUPABASE_PROJECT_REF" "$OLD_DB_PASSWORD" && ok=1 && break
done

try "NEW" "${NEW_POOLER_HOST:-aws-1-ap-southeast-1.pooler.supabase.com}" "$NEW_SUPABASE_PROJECT_REF" "$NEW_DB_PASSWORD" || true

if [[ "$ok" -eq 0 ]]; then
  echo ""
  echo "OLD connection failed on all poolers."
  echo "? ?????????? Reset ?????? OLD_DB_PASSWORD (??? quotes ????? @ ???? #)"
  echo "   OLD_DB_PASSWORD='your-new-password'"
  exit 1
fi
