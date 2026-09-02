#!/usr/bin/env bash
# Per-boot local .env for Cloud / Linux agents. Does not start servers.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  exit 0
fi

printf 'AUTH_REQUIRED=false\nHUB_AUTH_REQUIRED=false\nPYTHONPATH=.\nFRONTEND_URL=http://127.0.0.1:5173\nJWT_SECRET=%s\n' \
  "$(openssl rand -hex 32)" > .env
echo "wrote $ROOT/.env (auth off for local Cloud agents)"
