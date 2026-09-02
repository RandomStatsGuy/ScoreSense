# Hosting ScoreSense for Patreon subscribers

## 1. Patreon OAuth setup

1. Register a client at [Patreon Developer Portal](https://www.patreon.com/portal/registration/register-clients).
2. Set redirect URI to: `https://yourdomain.com/api/auth/patreon/callback`
3. Copy Client ID, Client Secret, and your Campaign ID into `.env` (see `.env.example`).

```env
PATREON_CLIENT_ID=...
PATREON_CLIENT_SECRET=...
PATREON_REDIRECT_URI=https://yourdomain.com/api/auth/patreon/callback
PATREON_CAMPAIGN_ID=...
PATREON_MIN_CENTS=100
AUTH_REQUIRED=true
JWT_SECRET=<openssl rand -hex 32>
FRONTEND_URL=https://yourdomain.com
```

Local dev: keep `AUTH_REQUIRED=false` so projections work without Patreon. Draft Hub still requires a ScoreSense account when `HUB_AUTH_REQUIRED=true` (default).

## 2. Build and run with Docker

```bash
cp .env.example .env
# edit .env with Patreon + JWT values

# Dev / bind-mount stack:
docker compose -f deploy/docker-compose.yml build
docker compose -f deploy/docker-compose.yml up -d api

# Production VPS (immutable image, localhost:8000 only):
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

Open `https://yourdomain.com` — the Dockerfile builds the React app into `frontend/dist` and serves it from FastAPI.

## 3. Weekly auto-refresh

**Option A — GitHub Actions** (already in `.github/workflows/weekly-refresh.yml` if configured).

**Option B — Host cron + Docker:**

```bash
# Every Tuesday 6am UTC (adjust for NFL schedule)
0 6 * * 2 cd /path/to/ScoreSense && docker compose --profile cron run --rm refresh
```

**Option C — Manual:**

```bash
docker compose exec api python -m src.jobs.weekly_refresh --no-retrain
```

## 4. Deploy targets

| Platform | Notes |
|----------|--------|
| **Render** | See **[DEPLOY_RENDER.md](./DEPLOY_RENDER.md)** — repo-root `render.yaml` Blueprint, `deploy/Dockerfile`, disk at `/var/data` |
| **Railway / Fly.io** | Deploy Dockerfile; set env vars; attach persistent volume for `data/`, `artifacts/` |
| **VPS + Cloudflare Tunnel** | See **[DEPLOY_CLOUDFLARE_TUNNEL.md](./DEPLOY_CLOUDFLARE_TUNNEL.md)** — `app.fourthdownlabs.com` → `localhost:8000` |
| **VPS (nginx / A record)** | See **[DEPLOY_VPS.md](./DEPLOY_VPS.md)** — `deploy/docker-compose.prod.yml`, nginx/Caddy, Patreon, `/root/scoresense` |
| **Local Docker (dev-like)** | `docker compose -f deploy/docker-compose.yml up -d` (bind-mounts source for hot reload) |
| **Same machine** | Port 8000; point domain to server |

Use HTTPS in production so Patreon / Google OAuth and JWT cookies are secure.

Google sign-in (optional): create an OAuth client in Google Cloud, set redirect URI to `https://yourdomain.com/api/auth/google/callback`, and add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` to server `.env`.

## 5. Subscriber flow

1. User visits your site → **Log in with Patreon**
2. Patreon OAuth → API verifies active membership → JWT issued
3. Protected routes: `/api/predict`, `/api/ros`, `/api/injuries`, etc.
4. Public routes: `/api/health`, `/api/auth/config`, `/api/auth/patreon/login`

## 6. API endpoints (new)

| Endpoint | Description |
|----------|-------------|
| `GET /api/ros/{position}` | Season + rest-of-season projections |
| `GET /api/auth/patreon/login` | Start Patreon OAuth |
| `GET /api/auth/google/login` | Start Google OAuth |
| `GET /api/auth/me` | Current session |
| `POST /api/auth/logout` | Clear session |

## 7. Transactional email (SMTP)

League invites, email verification, welcome mail, and password reset use stdlib SMTP via [`src/email/smtp.py`](../src/email/smtp.py). Set on the server `.env` (never commit credentials):

| Variable | Example |
|----------|---------|
| `SMTP_HOST` | `smtp.sendgrid.net` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `apikey` |
| `SMTP_PASSWORD` | *(provider secret)* |
| `SMTP_FROM` | `noreply@fourthdownlabs.com` |
| `SMTP_TLS` | `true` |

When `SMTP_HOST` is empty, invites still succeed but commissioners must copy the join link manually (`email_sent: false`).

**Smoke test after deploy:** create a test invite from Draft Hub Setup or send a forgot-password request; confirm mail arrives.

Also set `TERMS_URL`, `PRIVACY_URL`, and `FRONTEND_URL` so verification/reset links point at `https://app.fourthdownlabs.com`.

## 8. Legal

The app links to external Terms and Privacy URLs (`TERMS_URL`, `PRIVACY_URL`). Product disclaimers appear on auth, projections, Props, and DFS tools. Projections are for entertainment/research; not gambling or financial advice.
