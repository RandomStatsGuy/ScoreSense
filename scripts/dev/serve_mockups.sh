#!/usr/bin/env bash
# Serve docs/mockups on :5174. Static HTML only. Not product.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${MOCKUP_PORT:-5174}"
DIR="$ROOT/docs/mockups"

ready() {
  curl -sf --max-time 2 "http://127.0.0.1:${PORT}/" >/dev/null
}

if ready; then
  echo "Mockups already at http://127.0.0.1:${PORT}/"
  exit 0
fi

TMUX_CONF="/exec-daemon/tmux.portal.conf"
tmux_bin() {
  if [[ -f "$TMUX_CONF" ]]; then
    tmux -f "$TMUX_CONF" "$@"
  else
    tmux "$@"
  fi
}

if command -v tmux >/dev/null 2>&1; then
  if ! tmux_bin has-session -t "=scoresense-mockups" 2>/dev/null; then
    tmux_bin new-session -d -s "scoresense-mockups" -c "$DIR" -- \
      python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR"
  fi
  echo "started mockups tmux session scoresense-mockups"
else
  mkdir -p "$ROOT/data/dev"
  nohup python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR" \
    >"$ROOT/data/dev/mockups-5174.log" 2>&1 &
  echo "started mockups pid $!"
fi

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ready; then
    echo "Mockups at http://127.0.0.1:${PORT}/"
    exit 0
  fi
  sleep 0.2
done

echo "Mockups server did not become ready on :${PORT}" >&2
exit 1
