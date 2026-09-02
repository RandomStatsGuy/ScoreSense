#!/usr/bin/env bash
# Wait until API :8000 and Vite :5173 answer. Does not start them.
set -euo pipefail

API_URL="${SCORESENSE_API_HEALTH:-http://127.0.0.1:8000/api/health}"
VITE_URL="${SCORESENSE_VITE_URL:-http://127.0.0.1:5173/}"
DEADLINE="${SCORESENSE_DEV_WAIT_SEC:-90}"

ready() {
  local url="$1"
  curl -sf --max-time 2 "$url" >/dev/null
}

started="$(date +%s)"
api_ok=0
vite_ok=0
while (( "$(date +%s)" - started < DEADLINE )); do
  if (( api_ok == 0 )) && ready "$API_URL"; then
    echo "API ready $API_URL"
    api_ok=1
  fi
  if (( vite_ok == 0 )) && ready "$VITE_URL"; then
    echo "Vite ready $VITE_URL"
    vite_ok=1
  fi
  if (( api_ok == 1 && vite_ok == 1 )); then
    exit 0
  fi
  sleep 0.5
done

echo "ERROR: dev servers not ready within ${DEADLINE}s (api=$api_ok vite=$vite_ok)" >&2
echo "API $API_URL  Vite $VITE_URL" >&2
exit 1
