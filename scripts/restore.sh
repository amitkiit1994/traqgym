#!/usr/bin/env bash
# Companion to scripts/backup.sh — restore a gym DB from a backup file.
#
# Usage:
#   ./scripts/restore.sh <gym-subdomain> <path-to-backup.sql.gz>
#
# Example:
#   ./scripts/restore.sh freeformfitness ./backups/freeformfitness-2026-05-16.sql.gz
#
# Will prompt for confirmation before running anything destructive.

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <gym-subdomain> <path-to-backup.sql.gz>" >&2
  exit 1
fi

GYM="$1"
BACKUP="$2"

if [[ ! -f "$BACKUP" ]]; then
  echo "Backup not found: $BACKUP" >&2
  exit 1
fi

# Resolve DATABASE_URL from envs/ — one file per gym.
ENV_FILE="envs/${GYM}.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Env file not found: $ENV_FILE" >&2
  echo "Expected per-gym env file at envs/<subdomain>.env containing DATABASE_URL" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set in $ENV_FILE" >&2
  exit 1
fi

echo "=== RESTORE PLAN ==="
echo "Gym:      $GYM"
echo "Backup:   $BACKUP"
echo "Target:   ${DATABASE_URL%%@*}@... (host hidden)"
echo ""
echo "This will DROP existing tables and replace with backup contents."
read -r -p "Type 'RESTORE $GYM' to confirm: " CONFIRM
if [[ "$CONFIRM" != "RESTORE $GYM" ]]; then
  echo "Aborted." >&2
  exit 1
fi

echo "Restoring..."
gunzip -c "$BACKUP" | psql "$DATABASE_URL"
echo "Done. Verify with: psql \"$DATABASE_URL\" -c 'SELECT count(*) FROM \"MemberTicket\";'"
