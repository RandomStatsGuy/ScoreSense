# Deploy ScoreSense with Cloudflare Tunnel (fourthdownlabs.com)

Your Vultr VPS already uses **Cloudflare Tunnel** (`cloudflared`) — the same pattern as the old PriceBot setup on `app.girlmathematics.com`. You do **not** need nginx, certbot, or a public A record for port 8000.

**Recommended URLs**

| URL | Purpose |
|-----|---------|
| `https://app.fourthdownlabs.com` | ScoreSense app (use this in `.env` + Patreon) |
| `https://fourthdownlabs.com` | Company landing (optional, later) |

---

## Architecture

```
Browser → Cloudflare (DNS + HTTPS) → cloudflared on Vultr → http://127.0.0.1:8000 (ScoreSense Docker)
```

- **Vultr** = the server
- **`127.0.0.1:8000`** = ScoreSense on that server (not the internet)
- **Cloudflare** = public hostname + TLS

### Browser recovery after a deployment

Online navigations read the current HTML shell. The service worker keeps a separate shell key (`index.html?__scoresense_offline=1`) for network failures, so an ordinary online reload cannot keep returning an old release. Hashed assets retain their existing cache/retirement policy.

The shared error screen and bounded deployment watcher navigate through `/api/client-recovery?return_to=...`. The previously deployed worker excludes `/api` from its navigation fallback. This endpoint serves the current shell directly with `no-store` and restores the validated local destination before app scripts run; a redirect would reenter the old worker's cache. It never clears cookies, preferences, caches or league state. Automatic recovery still waits on live drafts, editable pages, dialogs and outstanding saves.

If an older tab still has the old recovery button after rollout, open `/api/client-recovery?return_to=%2Fhub%2Fhome` on the production host to load the current client without clearing site data. This endpoint must ship with the frontend change. Verify recovery before removing retained assets.

Local regression: from `frontend/`, run `npm run build`, `npx vite build --config test-fixtures/page-recovery.config.js`, then `node ../scripts/dev/page_recovery_browser.mjs`. This uses an isolated browser and ephemeral fixture server. Backend coverage lives in `tests/test_frontend_static.py`.

---

## Checklist (do in this order)

### Step 1 — Add domain to Cloudflare

If you bought `fourthdownlabs.com` **through Cloudflare**, it is already in your account.

If you bought it elsewhere:

1. Cloudflare Dashboard → **Add a site** → `fourthdownlabs.com`
2. At your registrar, set **nameservers** to the two Cloudflare nameservers shown
3. Wait until Cloudflare shows the domain as **Active**

---

### Step 2 — Add the domain to your tunnel

You can reuse the existing **`pricebot`** tunnel or create a new one (e.g. `fourthdownlabs`). Reusing is fine.

**Cloudflare Dashboard → Zero Trust** (or **Networks → Tunnels**)

1. Open your tunnel (e.g. `pricebot`)
2. **Public Hostname → Add a public hostname**
3. Fill in:

   | Field | Value |
   |-------|-------|
   | Subdomain | `app` |
   | Domain | `fourthdownlabs.com` |
   | Type | HTTP |
   | URL | `localhost:8000` or `127.0.0.1:8000` |

4. Save

Cloudflare usually creates the DNS CNAME to `*.cfargotunnel.com` automatically. Confirm under **DNS → Records**:

```
Type: CNAME (Tunnel)
Name: app
Target: <your-tunnel-id>.cfargotunnel.com
Proxy: Proxied (orange cloud)
```

---

### Step 3 — Deploy ScoreSense on the VPS (if not already)

SSH in:

```bash
ssh root@104.207.158.4
```

First time only:

```bash
mkdir -p /root/scoresense
# upload code (git clone, scp, or deploy_to_vps.py from your PC)
cd /root/scoresense
cp deploy/env.production.example .env
nano .env
bash deploy/server/deploy-on-server.sh
curl -s http://127.0.0.1:8000/api/health
```

If PriceBot is still on port 8000, stop it first:

```bash
cd /root/pricebot && docker compose down
cd /root/scoresense && docker compose -f deploy/docker-compose.prod.yml up -d --build
```

---

### Step 4 — Configure `.env` on the server

Edit `/root/scoresense/.env`:

```env
FRONTEND_URL=https://app.fourthdownlabs.com
PATREON_REDIRECT_URI=https://app.fourthdownlabs.com/api/auth/patreon/callback
AUTH_REQUIRED=true
HUB_AUTH_REQUIRED=true
JWT_SECRET=<openssl rand -hex 32>
PATREON_CLIENT_ID=...
PATREON_CLIENT_SECRET=...
PATREON_CAMPAIGN_ID=...
```

Restart to pick up changes:

```bash
cd /root/scoresense
docker compose -f deploy/docker-compose.prod.yml up -d --force-recreate
```

---

### Step 5 — Patreon Developer Portal

1. [Patreon Developer Portal](https://www.patreon.com/portal/registration/register-clients)
2. Add redirect URI (exact match, https, no trailing slash):

   ```
   https://app.fourthdownlabs.com/api/auth/patreon/callback
   ```

3. You can keep the old `app.girlmathematics.com` URI during migration, then remove it later.

---

### Step 6 — Verify cloudflared is running

On the VPS:

```bash
systemctl status cloudflared
# or
ps aux | grep cloudflared
```

If you edit config on disk (`/etc/cloudflared/config.yml`), see `deploy/cloudflared/config.yml.example`, then:

```bash
sudo cloudflared --config /etc/cloudflared/config.yml tunnel ingress validate
sudo systemctl restart cloudflared
```

**Note:** If you added the hostname in the Cloudflare dashboard (Step 2), you may not need to edit `config.yml` — the dashboard pushes config to the tunnel connector.

---

### Step 7 — Test

From your browser:

1. `https://app.fourthdownlabs.com/api/health` → should return JSON
2. Open `https://app.fourthdownlabs.com` → ScoreSense UI
3. **Log in with Patreon**
4. Draft Hub → start a practice draft (WebSockets should work through the tunnel)

---

### Step 8 — Retire old hostname (optional)

When ScoreSense works on the new URL:

1. **Tunnel** → remove public hostname `app.girlmathematics.com`
2. **DNS** (girlmathematics.com) → delete the old `app` CNAME
3. Clear cookies for the old domain in your browser

---

## Deploy updates from Windows

```powershell
cd C:\Users\Caelp\Desktop\AllStuff\ScoreSense
$env:SCORESENSE_VPS_HOST="104.207.158.4"
python scripts/ops/deploy_to_vps.py
```

`.env` stays on the server — edit there when changing domains.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| **502 / Bad Gateway** | ScoreSense not running — `curl http://127.0.0.1:8000/api/health` on VPS |
| **404 from Cloudflare** | Tunnel hostname not added, or wrong service URL — check Zero Trust → Tunnel → Public Hostname |
| **Patreon login fails** | `PATREON_REDIRECT_URI` must match portal exactly |
| **Wrong app loads** | PriceBot still on 8000 — `docker compose down` in `/root/pricebot` |
| **Draft WS disconnects** | Rare with tunnel; confirm app URL is `https://` and tunnel points to `127.0.0.1:8000` |
| **SSL errors** | Wait a few minutes after adding DNS; ensure proxy is orange-clouded |

---

## Optional: root domain later

To serve `https://fourthdownlabs.com` (marketing page):

1. Add another tunnel public hostname → different local port or static site
2. Or add a Cloudflare **Redirect Rule**: `fourthdownlabs.com` → `https://app.fourthdownlabs.com`

---

See also [DEPLOY_VPS.md](./DEPLOY_VPS.md) (nginx/A-record alternative) and [DEPLOY.md](./DEPLOY.md) (Patreon flow).


## Activating projection model changes

Deployment preserves the server's processed data, fitted model bundles and
projection caches. Merging or deploying a model-code change does not retrain
those bundles. After deploying qualified projection changes, run a full refresh
on the VPS:

```bash
cd /root/scoresense
docker compose -f deploy/docker-compose.prod.yml run --rm --build refresh
```

`--build` also protects manual runs after deployments made outside the supported
script. The supported deployment script explicitly builds both `api` and
`refresh`: the worker is behind the `cron` profile and an untargeted build can
leave its previous image in place. The app's Refresh button uses existing models
and does not replace this retraining step. A cold full refresh can take tens of
minutes because it rebuilds historical inputs, fits the serving bundles, and
warms weekly, season and Fantasy artifacts.

The command waits up to 30 minutes for an automatic DFS refresh or projection
recovery job to release the shared lock. While waiting, it prints a notice every
30 seconds and leaves the previous refresh status intact; training has not
started yet. After acquiring the lock, it prints the new start time and pipeline
stages. To allow an hour for another job to finish, override the service command:

```bash
docker compose -f deploy/docker-compose.prod.yml run --rm --build refresh \
  python -m src.jobs.weekly_refresh --lock-timeout 3600
```

A timeout returns `status: busy` and a nonzero exit code.
Do not delete `data/cache/last_refresh.lock`: an active process owns the OS lock,
and deleting the file can let two writers run at once.

Check `data/cache/last_refresh.json` for the current stage and a successful
completion, then inspect `artifacts/models/v2/training_summary.json` for the
serving models' `input_policy`, training seasons and digest. Each deployed gate
must match the rebuilt historical matrix and training preset. A full refresh
fails before fitting when none of a position's configured qualified policies
matches; it preserves the previous serving model bundles instead of silently
publishing an unqualified baseline. Re-run qualification against the changed
inputs to resolve that error. Do not treat a successful image build, health
check, or an old model's validation MAE as evidence of model activation.

When the fitted bundles are already current and only artifact/notes preparation
failed, rebuild the caches without repeating training or transcript ingestion:

```bash
docker compose -f deploy/docker-compose.prod.yml run --rm --build refresh \
  python -m src.jobs.weekly_refresh --no-retrain
```

The finalizing stage verifies all six weekly and ROS variants and the Fantasy
pool against current inputs. Configured older league seasons get their own
updated pool and valuation snapshots. It retries preparation when a source
changes mid-run and fails instead of reporting completion with unreadable
projection caches. Inspect warnings for optional note/overlay failures.
The shared schedule snapshot retains all cached seasons when an older league
needs a missing year's schedule. Schedule fetches, ETL and Vegas line updates
merge under the same publication lock, so preparing an older season does not
remove the current season's inputs. Valuation warnings identify the affected
season and team count.
Later roster or schedule updates can make a published Fantasy pool stale.
Fantasy reads retain that season's saved projections and original timestamp
while automatically queueing the shared background worker. The worker rebuilds
the pool and its configured valuations without retraining. Missing or damaged
snapshots remain a 503 with recovery queued; a refresh job requires fresh pools
and valuations before reporting completion. Deploying this reader fix does not
require another manual full refresh when a valid saved pool already exists.
Fantasy's **Sync projections** waits for the selected league's pool to become
current, then reloads its values and timestamp. It keeps showing **Updating
projections…** while the worker is running or waiting to retry a busy refresh.
The original timestamp remains visible while saved forecasts are being served.
Worker failures, request failures, or a wait longer than ten minutes show a
retry message. A successful saved-data read alone does not complete the sync.
Weekly's notes Refresh runs on the shared background worker, repairs stale or
missing weekly variants with existing models, and polls its own job status.

## Retained frontend assets

Use `deploy.ps1` / `deploy/server/deploy-on-server.sh` for releases. Before replacing the previous API container, the script archives its exact built assets in the persistent `artifacts/frontend_assets/` directory. Container discovery includes stopped containers: GitHub deployment stops the API for its SQLite backup before invoking this script. The new API serves a missing hashed asset from this archive, preserving open clients across a release. Archived assets are retained for seven days after retirement; expired files are pruned on the next deployment. The shell and service worker continue to revalidate.

A direct `docker compose up --build` bypasses the archive step. This recovery does not repair an asset that was already missing from the running release, and clients older than the retention window may still need to reload. No new JavaScript is substituted under an old hash.

The client release watcher also checks immediately on Vite asset-preload errors.
On safe pages it can reload once for a transient failure in the same build, or
move to the current release using its existing bounded version recovery. It
waits for service-worker update handling and requires a successful version check.
Hidden pages, protected editable routes, focused inputs, open dialogs, and pending
API writes block automatic reloads. The page recovery screen retains its manual
reload action. A same-build failure after the one recovery remains manual; an
offline version request never triggers a reload loop.
