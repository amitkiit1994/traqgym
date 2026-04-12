#!/bin/bash
# Daily backup script for TraqGym databases
# Usage: ./scripts/backup.sh
# Cron: 0 2 * * * /path/to/scripts/backup.sh

set -euo pipefail

BACKUP_DIR="$(dirname "$0")/../backups"
RETENTION_DAYS=30
DATE=$(date +%Y%m%d-%H%M)

mkdir -p "$BACKUP_DIR"

# Find all traqgym postgres containers
for container in $(docker ps --format '{{.Names}}' | grep '^traqgym-pg-'); do
  gym_name="${container#traqgym-pg-}"
  db_name="traqgym_${gym_name}"
  backup_file="$BACKUP_DIR/${gym_name}-${DATE}.sql.gz"

  echo "Backing up $db_name from $container..."
  docker exec "$container" pg_dump -U postgres "$db_name" | gzip > "$backup_file"
  echo "  -> $backup_file ($(du -h "$backup_file" | cut -f1))"
done

# Clean up old backups
echo "Removing backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

echo "Backup complete."
