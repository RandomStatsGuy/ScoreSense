# Deploy ScoreSense on Render

Blueprint file: [`render.yaml`](../render.yaml) at the repo root. Apply it from the [Render Dashboard](https://dashboard.render.com/) → **New** → **Blueprint**.

This is an alternative to the VPS + Cloudflare Tunnel path in [DEPLOY_CLOUDFLARE_TUNNEL.md](./DEPLOY_CLOUDFLARE_TUNNEL.md). Production today is still the VPS. Use this when you want Render to build `deploy/Dockerfile` and host the same FastAPI + React image.

## What the Blueprint creates

| Resource | Why |
|----------|-----|
| Web service `scoresense` (`runtime: docker`, plan `2c-4g`) | Serves `/api/*` and the built dashboard. Cold projection inference needs more than 512 MB. |
| Persistent disk `scoresense-runtime` (10 GB at `/var/data`) | Keeps Fantasy SQLite (`data/draft_hub/`, `data/auth/`) and live projection artifacts across deploys. Render’s container filesystem is ephemeral. |
| Env group `scoresense-secrets` | Patreon, SMTP, and optional API keys. First apply prompts; later Blueprint syncs do not overwrite them. |

`JWT_SECRET` is generated once by Render. Do not rotate it from the Blueprint later unless you intend to sign everyone out.

There is **no** Render cron. Cron jobs cannot attach a disk, so a scheduled `weekly_refresh` would write to a throwaway filesystem. Keep refresh on GitHub Actions (`.github/workflows/weekly-refresh.yml`) or **Admin → Refresh** (`POST /api/refresh`) so it writes on the web service disk.

## Apply

1. Merge this Blueprint to the branch Render should deploy (usually `master` after it ships through `develop`).
2. Render Dashboard → **New** → **Blueprint** → select this repo. Leave auto-sync on if you want later `render.yaml` edits applied automatically.
3. Fill the secret prompts. Empty is fine for optional keys (`SMTP_*`, FantasyPros, Odds, YouTube, OpenAI). `ADMIN_EMAILS` is a comma-separated list; without it the Admin portal stays closed.
4. First deploy builds the multi-stage image (Node frontend, then Python). Expect several minutes.
5. Confirm `https://<service>.onrender.com/api/health` returns `"status": "ok"`.
6. In the [Patreon developer portal](https://www.patreon.com/portal/registration/register-clients), set the redirect URI to `https://<service>.onrender.com/api/auth/patreon/callback` (must match `PATREON_REDIRECT_URI`).
7. After you add a custom domain in Render, set `FRONTEND_URL` and `PATREON_REDIRECT_URI` on the service (or they stay the `onrender.com` values derived at boot).

`deploy/render/start.sh` binds uvicorn to `0.0.0.0:$PORT` (Render injects `PORT`, usually `10000`). If `FRONTEND_URL` is unset it uses `RENDER_EXTERNAL_URL`. On first boot it copies image `data/` and `artifacts/` onto the disk, then symlinks `/app/data` and `/app/artifacts` there so later deploys do not clobber live league state with git fallbacks.

## After deploy

| Check | Expect |
|-------|--------|
| `GET /api/health` | JSON `status: ok` |
| Patreon login | Callback URI matches the service URL |
| Fantasy | League SQLite survives the next deploy |
| Admin refresh | Writes new draft-pool / weekly artifacts on the disk |

WebSockets for live draft (`/api/hub/ws/{league_id}`) go through Render’s proxy; no extra nginx upgrade block.

A service with a disk cannot scale past one instance, and Render does not allow `maxShutdownDelaySeconds` on disk-backed services. Redeploys attach the disk to the new instance, so you get a short cutover rather than overlapping zero-downtime copies.

## Plans and cost

`2c-4g` is the Blueprint default so a cold draft-pool build does not OOM. If you always pre-warm artifacts (Admin refresh or a mirrored cache) you can drop the service to `1c-2g` in the dashboard. Free / `0.5c-512mb` will not hold this stack, and free instances cannot attach a disk.

To point the Blueprint at a different git branch, set `branch` on the web service in `render.yaml` (omit it to use the repo default).
