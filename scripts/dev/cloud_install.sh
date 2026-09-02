#!/usr/bin/env bash
# Idempotent Cloud install. Never starts servers. Never remirrors prod league.
# Use requirements-ci.txt: no PyQt5/pandasgui/streamlit (evdev fails headless).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! .venv/bin/python -c "import uvicorn, fastapi" 2>/dev/null; then
  python3 -m venv .venv
  .venv/bin/pip install -U pip
  .venv/bin/pip install -r requirements-ci.txt
  .venv/bin/python -c "import uvicorn, fastapi"
fi

if [[ ! -d frontend/node_modules/vite ]]; then
  (cd frontend && npm ci)
fi
