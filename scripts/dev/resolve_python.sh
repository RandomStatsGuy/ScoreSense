#!/usr/bin/env bash
# Print a Python that can import uvicorn.
# Prefer repo .venv (Cloud / local). GitHub Actions pip-installs into PATH Python.
set -euo pipefail

ROOT="${1:-}"
if [[ -z "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi

has_uvicorn() {
  "$1" -c "import uvicorn" >/dev/null 2>&1
}

if [[ -x "$ROOT/.venv/bin/python" ]] && has_uvicorn "$ROOT/.venv/bin/python"; then
  printf '%s\n' "$ROOT/.venv/bin/python"
  exit 0
fi

for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && has_uvicorn "$cand"; then
    command -v "$cand"
    exit 0
  fi
done

echo "ERROR: no Python with uvicorn (tried $ROOT/.venv/bin/python, python3, python)" >&2
exit 1
