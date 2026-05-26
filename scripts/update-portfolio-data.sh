#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"

STAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
LOG_FILE="$LOG_DIR/portfolio-update.$STAMP.log"

{
  echo "[$(date -Iseconds)] Starting portfolio data update"
  cd "$ROOT"
  /usr/bin/node "$ROOT/scripts/update-portfolio-data.js"
  echo "[$(date -Iseconds)] Portfolio data update completed"
} >> "$LOG_FILE" 2>&1

find "$LOG_DIR" -name 'portfolio-update.*.log' -type f -mtime +180 -delete
find "$ROOT/backups/portfolio-data" -name 'portfolio_data.*.json' -type f -mtime +370 -delete 2>/dev/null || true
