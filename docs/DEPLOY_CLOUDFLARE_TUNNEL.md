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
