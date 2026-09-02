#!/usr/bin/env bash
# Foreground API for Cloud terminals. Binds 127.0.0.1:8000.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
bash "$ROOT/scripts/dev/ensure_cloud_env.sh"
export PYTHONPATH="${PYTHONPATH:-.}"
exec .venv/bin/python -m uvicorn app.api:app --reload --host 127.0.0.1 --port 8000
