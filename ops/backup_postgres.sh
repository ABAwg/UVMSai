#!/usr/bin/env sh
set -eu

COMPOSE_FILE="${UVMS_COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${UVMS_BACKUP_DIR:-backups}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FINAL="$BACKUP_DIR/uvms-ai-$STAMP.dump"
TMP="$FINAL.tmp"

cleanup() { rm -f "$TMP"; }
trap cleanup EXIT HUP INT TERM

echo "Creating PostgreSQL backup..."
# Expand credentials inside the postgres container, where Compose has already
# applied POSTGRES_USER/POSTGRES_DB. This keeps custom .env values working.
docker compose -f "$COMPOSE_FILE" exec -T postgres sh -ec \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TMP"

test -s "$TMP"
# Validate the custom-format archive before publishing it as a usable backup.
cat "$TMP" | docker compose -f "$COMPOSE_FILE" exec -T postgres pg_restore --list >/dev/null
mv "$TMP" "$FINAL"
trap - EXIT HUP INT TERM

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$FINAL" > "$FINAL.sha256"
fi

echo "Backup verified: $FINAL"
