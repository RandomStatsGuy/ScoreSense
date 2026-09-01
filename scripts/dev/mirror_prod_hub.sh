#!/usr/bin/env bash
# Mirror cap-sheet test data into local Fantasy league room 0BBESQ (default).
# Run from anywhere: ./scripts/dev/mirror_prod_hub.sh
# Live Sleeper overlay: SYNC_SLEEPER=1 ./scripts/dev/mirror_prod_hub.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PYTHONPATH="$ROOT"

ROOM="${1:-0BBESQ}"
PY="$ROOT/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  PY="${PYTHON:-python3}"
fi

SYNC=()
if [[ "${SYNC_SLEEPER:-}" == "1" ]]; then
  SYNC=(--sync-sleeper)
fi

echo "==> Importing cap sheet into room ${ROOM} ..."
"$PY" scripts/ops/import_cap_sheet.py \
  "$ROOT/data/draft_hub/cap_sheet_test.tsv" \
  --room-code "$ROOM" \
  --map "$ROOT/data/draft_hub/manager_team_map.yaml" \
  "${SYNC[@]}"

echo ""
echo "==> Verifying roster + trade insights ..."
"$PY" scripts/dev/verify_hub_mirror.py "$ROOM"

echo ""
echo "==> API: http://127.0.0.1:8000  |  UI: http://127.0.0.1:5173"
echo "    Fantasy -> Home on room ${ROOM}"
