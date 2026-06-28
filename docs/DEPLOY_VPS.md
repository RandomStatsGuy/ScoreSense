# ScoreSense VPS migration (reuse PriceBot host)

Move from the old PriceBot stack (`app.girlmathematics.com`, Postgres/Redis/Celery/Discord) to a **minimal ScoreSense-only** setup on the same VPS.

> **Using Cloudflare Tunnel?** (CNAME → `cfargotunnel.com`, same as old PriceBot)  
> Follow **[DEPLOY_CLOUDFLARE_TUNNEL.md](./DEPLOY_CLOUDFLARE_TUNNEL.md)** for `fourthdownlabs.com` — skip nginx/certbot below.

## What we reuse vs retire

| Reuse | Do not reuse |
|-------|----------------|
| VPS (`104.207.158.4`) | Postgres |
| Docker + Compose | Redis |
| App on port **8000** (localhost) | Celery / Flower |
| nginx or Caddy HTTPS reverse proxy | Discord bot |
| Manual deploy workflow | Stripe / Twilio |
| DNS A-record pattern | Old PriceBot `.env` secrets |

## What ScoreSense adds

- **Patreon OAuth** (`AUTH_REQUIRED=true`, `HUB_AUTH_REQUIRED=true`)
- **`.env`** from `deploy/env.production.example` (never commit `.env`)
- **Persistent volumes**: `data/` and `artifacts/` only (SQLite draft hub, models, caches)
- **Single container**: FastAPI serves API + built React frontend

---

## Files added for deployment

| File | Purpose |
|------|---------|
| `deploy/docker-compose.prod.yml` | Production stack; binds `127.0.0.1:8000`, no dev source mounts |
| `deploy/env.production.example` | Production `.env` template with `YOUR_DOMAIN.com` placeholders |
| `deploy/nginx/scoresense.conf.example` | nginx vhost + WebSocket support for Draft Hub |
| `deploy/Caddyfile.example` | Simpler TLS if you prefer Caddy over nginx |
| `deploy/server/bootstrap.sh` | One-time server prep (Docker, dirs, stop old PriceBot) |
| `deploy/server/deploy-on-server.sh` | Build + restart on the VPS after code upload |
| `scripts/ops/deploy_to_vps.py` | Push tarball from your PC via `ssh`/`scp` |
| `.dockerignore` | Smaller/faster Docker builds |

---

## Step-by-step: first deploy

### 1. Pick a new domain

Example: `scoresense.yourdomain.com` or a dedicated domain. **Do not** keep routing `app.girlmathematics.com` to ScoreSense unless you intentionally replace that product.

### 2. DNS

At your registrar/DNS host, add:

```
Type: A
Name: @  (or subdomain, e.g. scoresense)
Value: 104.207.158.4
TTL: 300 (or default)
```

Wait until `dig YOUR_DOMAIN.com +short` returns `104.207.158.4`.

### 3. SSH to the VPS and bootstrap

```bash
ssh root@104.207.158.4
bash deploy/server/bootstrap.sh   # after code is on the server once; or run steps manually
```

Bootstrap installs Docker if needed, creates `/root/scoresense/data` and `artifacts/`, and runs `docker compose down` in `/root/pricebot` if present.

### 4. Create production `.env` on the server

```bash
cd /root/scoresense
cp deploy/env.production.example .env
nano .env   # or vim
```

Set at minimum:

```env
PATREON_CLIENT_ID=...
PATREON_CLIENT_SECRET=...
PATREON_REDIRECT_URI=https://YOUR_DOMAIN.com/api/auth/patreon/callback
PATREON_CAMPAIGN_ID=...
FRONTEND_URL=https://YOUR_DOMAIN.com
AUTH_REQUIRED=true
HUB_AUTH_REQUIRED=true
JWT_SECRET=<run: openssl rand -hex 32>
```

### 5. Patreon developer portal

1. Open [Patreon Developer Portal](https://www.patreon.com/portal/registration/register-clients).
2. Set **Redirect URI** to exactly:  
   `https://YOUR_DOMAIN.com/api/auth/patreon/callback`
3. Save Client ID, Secret, Campaign ID into `.env`.

### 6. Start ScoreSense

```bash
cd /root/scoresense
bash deploy/server/deploy-on-server.sh
# or:
docker compose -f deploy/docker-compose.prod.yml up -d --build
curl http://127.0.0.1:8000/api/health
```

### 7. Reverse proxy (nginx)

```bash
sudo cp deploy/nginx/scoresense.conf.example /etc/nginx/sites-available/scoresense
sudo nano /etc/nginx/sites-available/scoresense   # replace YOUR_DOMAIN.com
sudo ln -sf /etc/nginx/sites-available/scoresense /etc/nginx/sites-enabled/scoresense
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d YOUR_DOMAIN.com
```

**Or Caddy:** copy `deploy/Caddyfile.example` → `/etc/caddy/Caddyfile`, replace domain, `sudo systemctl reload caddy`.

### 8. Remove old PriceBot vhost (optional)

```bash
sudo rm -f /etc/nginx/sites-enabled/pricebot /etc/nginx/sites-enabled/app.girlmathematics.com
sudo nginx -t && sudo systemctl reload nginx
```

### 9. Verify

- `https://YOUR_DOMAIN.com/api/health` → JSON OK
- Log in with Patreon
- Draft Hub loads; WebSocket drafts work (nginx `location /api/hub/ws/` block)

---

## Deploy updates from your Windows machine

```powershell
cd C:\Users\Caelp\Desktop\AllStuff\ScoreSense
$env:SCORESENSE_VPS_HOST="104.207.158.4"
$env:SCORESENSE_SSH_KEY="C:\Users\Caelp\.ssh\id_rsa"   # if needed
python scripts/ops/deploy_to_vps.py
```

The script uploads a tarball (excludes `.env`, `.venv`, `node_modules`) and runs `deploy-on-server.sh` on the server.

**`.env` stays on the server** — edit it there when you change domain or secrets.

---

## Weekly refresh on the VPS (optional)

Replace GitHub Actions or run in addition:

```bash
sudo crontab -e
```

Add (Tuesdays 10:00 UTC):

```cron
0 10 * * 2 cd /root/scoresense && docker compose -f deploy/docker-compose.prod.yml --profile cron run --rm refresh >> /var/log/scoresense-refresh.log 2>&1
```

---

## How to change the domain name later

When you move from a staging domain to production (or rebrand):

1. **DNS** — Point the new domain’s A record to `104.207.158.4`. Lower TTL beforehand if you expect a cutover window.

2. **Server `.env`** (`/root/scoresense/.env`):
   ```env
   FRONTEND_URL=https://NEW_DOMAIN.com
   PATREON_REDIRECT_URI=https://NEW_DOMAIN.com/api/auth/patreon/callback
   ```

3. **Patreon app** — Add/update redirect URI to  
   `https://NEW_DOMAIN.com/api/auth/patreon/callback`  
   (Patreon allows multiple redirect URIs during migration.)

4. **nginx or Caddy** — New `server_name` / site block for `NEW_DOMAIN.com`, TLS cert for new host:
   ```bash
   sudo certbot --nginx -d NEW_DOMAIN.com
   ```

5. **Restart app** (picks up `.env`):
   ```bash
   cd /root/scoresense
   docker compose -f deploy/docker-compose.prod.yml up -d --force-recreate
   ```

6. **Browser** — Hard refresh or clear cookies for the old domain; JWT cookies are domain-scoped.

7. **Old domain** — Redirect to new (optional nginx 301) or let DNS lapse after cutover.

No code changes are required for a domain swap — only DNS, `.env`, Patreon portal, and reverse proxy.

---

## Security checklist after migration

- [ ] Generate new `JWT_SECRET` (do not reuse PriceBot secrets)
- [ ] New Patreon client secret if old keys were exposed
- [ ] Rotate VPS root password / SSH keys if they appeared in old deploy scripts or chat logs
- [ ] Confirm `AUTH_REQUIRED=true` in production `.env`
- [ ] Confirm API listens on `127.0.0.1:8000` only (not `0.0.0.0` publicly without proxy)

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `405 Method Not Allowed` on new routes | Old container still running — `docker compose -f deploy/docker-compose.prod.yml up -d --build --force-recreate` |
| Patreon login loops / error | Redirect URI must match `.env` **exactly** (https, no trailing slash) |
| Draft room WS disconnects | nginx needs `/api/hub/ws/` upgrade block (see example conf) |
| Empty projections | Run preseason/weekly refresh; ensure `artifacts/` volume has models |
| `JWT_SECRET` crash on start | Set a strong secret in `.env`; not `change-me-in-production` |

See also [DEPLOY.md](./DEPLOY.md) for Patreon subscriber flow and API overview.
