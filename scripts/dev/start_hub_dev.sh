#!/usr/bin/env bash
# Start API + Vite if they are down, then wait. Idempotent. Does not remirror 0BBESQ.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
bash "$ROOT/scripts/dev/ensure_cloud_env.sh"

TMUX_CONF="/exec-daemon/tmux.portal.conf"
tmux_bin() {
  if [[ -f "$TMUX_CONF" ]]; then
    tmux -f "$TMUX_CONF" "$@"
  else
    tmux "$@"
  fi
}

api_ready() {
  curl -sf --max-time 2 "http://127.0.0.1:8000/api/health" >/dev/null
}

vite_ready() {
  curl -sf --max-time 2 "http://127.0.0.1:5173/" >/dev/null
}

ensure_session() {
  local name="$1"
  shift
  if tmux_bin has-session -t "=$name" 2>/dev/null; then
    return 0
  fi
  tmux_bin new-session -d -s "$name" -c "$ROOT" -- "$@"
}

if api_ready; then
  echo "API already up on http://127.0.0.1:8000"
elif command -v tmux >/dev/null 2>&1; then
  ensure_session scoresense-api bash "$ROOT/scripts/dev/run_api.sh"
  echo "started API tmux session scoresense-api"
else
  mkdir -p "$ROOT/data/dev"
  nohup bash "$ROOT/scripts/dev/run_api.sh" >"$ROOT/data/dev/api-8000.log" 2>&1 &
  echo "started API pid $! (no tmux)"
fi

if vite_ready; then
  echo "Vite already up on http://127.0.0.1:5173"
elif command -v tmux >/dev/null 2>&1; then
  ensure_session scoresense-vite bash "$ROOT/scripts/dev/run_vite.sh"
  echo "started Vite tmux session scoresense-vite"
else
  mkdir -p "$ROOT/data/dev"
  nohup bash "$ROOT/scripts/dev/run_vite.sh" >"$ROOT/data/dev/vite-5173.log" 2>&1 &
  echo "started Vite pid $! (no tmux)"
fi

exec bash "$ROOT/scripts/dev/wait_for_dev.sh"
