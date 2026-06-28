#!/usr/bin/env bash
# One-time VPS prep for ScoreSense (Ubuntu/Debian).
# Run as root on the server:
#   curl -fsSL ... | bash
#   or: bash deploy/server/bootstrap.sh
set -euo pipefail

APP_DIR="${SCORESENSE_APP_DIR:-/root/scoresense}"

echo "==> ScoreSense VPS bootstrap"
echo "    App directory: $APP_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker..."
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

mkdir -p "$APP_DIR/data" "$APP_DIR/artifacts"

# Optional: stop legacy PriceBot stack if still running
if [ -d /root/pricebot ] && [ -f /root/pricebot/docker-compose.yml ]; then
  echo "==> Stopping legacy /root/pricebot stack (if running)..."
  (cd /root/pricebot && docker compose down) || true
fi

echo "==> Done. Next:"
echo "    1. Deploy code to $APP_DIR (see docs/DEPLOY_VPS.md)"
echo "    2. Create $APP_DIR/.env from deploy/env.production.example"
echo "    3. cd $APP_DIR && docker compose -f deploy/docker-compose.prod.yml up -d --build"
echo "    4. Configure nginx/Caddy for YOUR_DOMAIN.com -> 127.0.0.1:8000"
