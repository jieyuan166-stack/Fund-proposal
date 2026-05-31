#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/tax-rates-update.$STAMP.log"

mkdir -p "$LOG_DIR"

{
  echo "[$(date -Iseconds)] Starting Triton investment tax rate update"
  /usr/bin/python3 "$ROOT/scripts/update-tax-rates.py" \
    --file "$ROOT/investment_tax_calculator.html" \
    --year "$(date +%Y)"
  echo "[$(date -Iseconds)] Completed Triton investment tax rate update"
} >> "$LOG_FILE" 2>&1

rm -f "$ROOT/investment_tax_calculator.html.bak"
find "$LOG_DIR" -name 'tax-rates-update.*.log' -type f -mtime +180 -delete
