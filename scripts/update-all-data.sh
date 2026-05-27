#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

sh "$ROOT/scripts/update-portfolio-data.sh"
sh "$ROOT/scripts/update-fidelity-data.sh"
