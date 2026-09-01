#!/usr/bin/env bash
# Foreground Vite for Cloud terminals. Binds 127.0.0.1:5173 and proxies /api to :8000.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/frontend"
export SCORESENSE_API_PORT="${SCORESENSE_API_PORT:-8000}"
exec npm run dev -- --host 127.0.0.1 --port 5173
