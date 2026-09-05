#!/usr/bin/env bash
# Foreground API for Cloud terminals and GitHub Actions. Binds 127.0.0.1:8000.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
bash "$ROOT/scripts/dev/ensure_cloud_env.sh"
export PYTHONPATH="${PYTHONPATH:-.}"
PY="$(bash "$ROOT/scripts/dev/resolve_python.sh" "$ROOT")"
echo "API python $PY"
exec "$PY" -m uvicorn app.api:app --reload --host 127.0.0.1 --port 8000
