#!/bin/sh
# Render (and any host that mounts a persist volume) entrypoint.
# - Honors $PORT (Render default 10000; Docker/VPS can leave this unset → 8000)
# - Seeds /var/data once from the image, then keeps live SQLite + artifacts
# - Fills FRONTEND_URL / PATREON_REDIRECT_URI from RENDER_EXTERNAL_URL when unset
set -eu

APP_ROOT="${SCORESENSE_APP_ROOT:-/app}"
PERSIST="${SCORESENSE_PERSIST_DIR:-/var/data}"
cd "$APP_ROOT"

if [ -z "${FRONTEND_URL:-}" ] && [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  FRONTEND_URL="${RENDER_EXTERNAL_URL%/}"
  export FRONTEND_URL
fi

if [ -z "${PATREON_REDIRECT_URI:-}" ] && [ -n "${FRONTEND_URL:-}" ]; then
  PATREON_REDIRECT_URI="${FRONTEND_URL%/}/api/auth/patreon/callback"
  export PATREON_REDIRECT_URI
fi

if [ -d "$PERSIST" ] && [ -w "$PERSIST" ]; then
  persist_data="$PERSIST/data"
  persist_art="$PERSIST/artifacts"
  mkdir -p "$persist_data" "$persist_art"

  if [ ! -f "$PERSIST/.seeded" ]; then
    echo "scoresense-render: seeding persist volume from image"
    if [ -d "$APP_ROOT/data" ]; then
      cp -a "$APP_ROOT/data/." "$persist_data/"
    fi
    if [ -d "$APP_ROOT/artifacts" ]; then
      cp -a "$APP_ROOT/artifacts/." "$persist_art/"
    fi
    : > "$PERSIST/.seeded"
  fi

  if [ ! -L "$APP_ROOT/data" ]; then
    rm -rf "$APP_ROOT/data"
    ln -s "$persist_data" "$APP_ROOT/data"
  fi
  if [ ! -L "$APP_ROOT/artifacts" ]; then
    rm -rf "$APP_ROOT/artifacts"
    ln -s "$persist_art" "$APP_ROOT/artifacts"
  fi
  echo "scoresense-render: using persist at $PERSIST"
else
  echo "scoresense-render: no writable persist at $PERSIST; using image filesystem"
fi

export PYTHONPATH="${PYTHONPATH:-$APP_ROOT}"
PORT="${PORT:-8000}"

if [ "${SCORESENSE_RENDER_START_SKIP_SERVER:-}" = "1" ]; then
  if [ -n "${SCORESENSE_RENDER_START_ENV_FILE:-}" ]; then
    {
      echo "PORT=$PORT"
      echo "FRONTEND_URL=${FRONTEND_URL:-}"
      echo "PATREON_REDIRECT_URI=${PATREON_REDIRECT_URI:-}"
    } > "$SCORESENSE_RENDER_START_ENV_FILE"
  fi
  echo "scoresense-render: skip server (PORT=$PORT)"
  exit 0
fi

echo "scoresense-render: starting uvicorn on 0.0.0.0:$PORT"
exec uvicorn app.api:app --host 0.0.0.0 --port "$PORT"
