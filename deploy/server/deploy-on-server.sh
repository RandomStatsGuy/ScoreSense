#!/usr/bin/env bash
# Run ON the VPS inside the app directory after code is uploaded.
#   cd /root/scoresense && bash deploy/server/deploy-on-server.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ -d /root/pricebot ]; then
  echo "==> Stopping legacy PriceBot on port 8000..."
  (cd /root/pricebot && docker compose down) || true
fi

if [ ! -f .env ]; then
  echo "==> Creating .env from deploy/env.production.example (add Patreon secrets after first boot)..."
  cp deploy/env.production.example .env
  JWT="$(openssl rand -hex 32)"
  sed -i "s/^JWT_SECRET=.*/JWT_SECRET=${JWT}/" .env
fi

echo "==> Building and starting ScoreSense (production)..."
# The refresh worker is behind the cron profile. Target it explicitly so a
# manual/scheduled refresh cannot keep running an image from an older release.
docker compose -f deploy/docker-compose.prod.yml build --pull api refresh

# Archive the previous release before replacing its container. Both old and new
# API images serve their own shell; the new API can also serve exact old chunks.
# GitHub deployment stops the API for its SQLite backup before invoking this
# script. Include stopped containers or that path silently loses the old assets.
previous_api="$(docker compose -f deploy/docker-compose.prod.yml ps -a -q api)"
if [ -n "$previous_api" ]; then
  mkdir -p "$ROOT/artifacts"
  asset_stage="$(mktemp -d "$ROOT/artifacts/frontend-assets.XXXXXX")"
  trap 'rm -rf -- "$asset_stage"' EXIT
  docker cp "$previous_api:/app/frontend/dist/assets/." "$asset_stage/"
  docker compose -f deploy/docker-compose.prod.yml run --rm --no-deps api \
    python scripts/ops/archive_frontend_assets.py \
    "/app/artifacts/$(basename "$asset_stage")" /app/artifacts/frontend_assets
fi
docker compose -f deploy/docker-compose.prod.yml up -d --force-recreate

echo "==> Health check..."
sleep 3
if ls artifacts/weekly_predictions/*.meta.json >/dev/null 2>&1 || ls artifacts/draft_pool/*.meta.json >/dev/null 2>&1; then
  docker compose -f deploy/docker-compose.prod.yml exec -T api python scripts/ops/fix_artifact_fingerprints.py || true
fi
curl -sf http://127.0.0.1:8000/api/health && echo " OK" || echo " WARN: health check failed"

docker compose -f deploy/docker-compose.prod.yml ps
