#!/bin/sh
set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
STATUS=0

sh "$ROOT/scripts/update-portfolio-data.sh" || STATUS=1
sh "$ROOT/scripts/update-fidelity-data.sh" || STATUS=1
sh "$ROOT/scripts/update-tax-rates.sh" || STATUS=1

if [ -x "$ROOT/scripts/backup-data-to-github.sh" ]; then
  sh "$ROOT/scripts/backup-data-to-github.sh" || STATUS=1
fi

exit "$STATUS"
