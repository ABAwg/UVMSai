#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: UVMS_ALLOW_RESTORE=YES $0 backups/file.dump" >&2
  exit 2
fi
if [ "${UVMS_ALLOW_RESTORE:-}" != "YES" ]; then
  echo "Refusing destructive restore. Re-run with UVMS_ALLOW_RESTORE=YES after reviewing the runbook." >&2
  exit 2
fi

FILE="$1"
COMPOSE_FILE="${UVMS_COMPOSE_FILE:-docker-compose.prod.yml}"
test -f "$FILE"

# Validate before taking user traffic down.
cat "$FILE" | docker compose -f "$COMPOSE_FILE" exec -T postgres pg_restore --list >/dev/null

if [ "${UVMS_SKIP_PRE_RESTORE_BACKUP:-0}" != "1" ]; then
  echo "Creating automatic pre-restore backup..."
  UVMS_COMPOSE_FILE="$COMPOSE_FILE" "$(dirname "$0")/backup_postgres.sh"
fi

echo "Stopping public/application services for a consistent restore..."
docker compose -f "$COMPOSE_FILE" stop nginx web api >/dev/null

restart_stack() {
  echo "Starting application services..."
  docker compose -f "$COMPOSE_FILE" up -d api web nginx >/dev/null
}
trap 'restart_stack || true' EXIT HUP INT TERM

echo "Restoring PostgreSQL archive..."
cat "$FILE" | docker compose -f "$COMPOSE_FILE" exec -T postgres sh -ec \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges'

# API startup performs Alembic upgrade + idempotent reference seeding exactly
# once before starting its worker pool.
restart_stack
trap - EXIT HUP INT TERM

echo "Restore completed. Verify /ready and run the production smoke test."
