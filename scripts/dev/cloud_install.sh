#!/usr/bin/env bash
# Idempotent Cloud install. Never starts servers. Never remirrors prod league.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -U pip
  .venv/bin/pip install -r requirements.txt
fi

if [[ ! -d frontend/node_modules ]]; then
  (cd frontend && npm ci)
fi
