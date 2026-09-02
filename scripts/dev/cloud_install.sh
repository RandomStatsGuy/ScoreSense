#!/usr/bin/env bash
# Idempotent Cloud install. Never starts servers. Never remirrors prod league.
# Use requirements-ci.txt: no PyQt5/pandasgui/streamlit (evdev fails headless).
#
# Cursor's default Ubuntu image often omits python3-venv / ensurepip. Recurring
# environment builds clone a clean workspace, then `python3 -m venv` exits 1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

venv_ready() {
  [[ -x .venv/bin/python ]] && .venv/bin/python -c "import uvicorn, fastapi" 2>/dev/null
}

ensure_venv_toolchain() {
  if python3 -c "import ensurepip" 2>/dev/null; then
    return 0
  fi
  echo "ensurepip missing; installing python3-venv"
  sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3-venv
  python3 -c "import ensurepip"
}

create_venv() {
  rm -rf .venv
  if python3 -c "import ensurepip" 2>/dev/null; then
    python3 -m venv .venv
    return
  fi
  echo "creating venv without ensurepip, then bootstrapping pip"
  python3 -m venv --without-pip .venv
  curl -fsSL https://bootstrap.pypa.io/get-pip.py | .venv/bin/python
}

if ! venv_ready; then
  ensure_venv_toolchain || true
  create_venv
  .venv/bin/pip install -U pip
  .venv/bin/pip install -r requirements-ci.txt
  .venv/bin/python -c "import uvicorn, fastapi"
fi

if [[ ! -d frontend/node_modules/vite ]]; then
  (cd frontend && npm ci)
fi
