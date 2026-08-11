# Vercel preview deployments

ScoreSense **production** stays on the VPS. Vercel is used for **frontend preview** builds on non-agent branches.

## Why previews look “broken”

Two separate gates can block a preview URL:

### 1. Vercel Authentication (Deployment Protection) — most common

Unauthenticated requests to `*.vercel.app` return **302 → `vercel.com/sso-api`**. That is Vercel’s SSO wall, not ScoreSense login. Anyone without access to the Vercel team/project cannot open the preview.

**Fix (required once per Vercel project):**

1. Open the Vercel project → **Settings** → **Deployment Protection**
2. Under **Vercel Authentication**, turn protection **off** for Preview (or set the project protection level to **None**)
3. Save

Production on the VPS is unchanged. ScoreSense still enforces `AUTH_REQUIRED` / Hub auth via the API.

Optional alternatives if you want to keep Vercel SSO:

- **Shareable Links** on a specific deployment (manual, per URL)
- **Protection Bypass for Automation** (`x-vercel-protection-bypass`) for CI / agents

### 2. ScoreSense app auth

After Vercel SSO is off, the preview UI proxies `/api/*` to production. Production has `AUTH_REQUIRED=true`, so visitors see the normal ScoreSense sign-in. Use email/password. Patreon OAuth redirects to `FRONTEND_URL` (production), so prefer native login on preview URLs.

## Required Vercel env var

Previews rewrite `/api/*` to the live API. Set this in **Project → Settings → Environment Variables** (at least for the **Preview** environment):

| Name | Value |
|------|--------|
| `SCORESENSE_API_ORIGIN` | Production origin only, no path — same host as `FRONTEND_URL` (no trailing slash) |

Without it, the SPA builds but `/api/*` will 404 on the preview host.

## How the preview is wired

| File | Purpose |
|------|---------|
| `vercel.ts` (repo root) | Build `frontend/`, SPA fallback, `/api` → `SCORESENSE_API_ORIGIN`, skip `agent/**` + `cursor/**` deploys |
| `frontend/vercel.ts` | Same `/api` + SPA rewrites if Root Directory is `frontend` |

**Dashboard check (pick one):**

- **Root Directory = repository root (`.`)** — uses root `vercel.ts`. Preferred.
- **Root Directory = `frontend`** — uses `frontend/vercel.ts` (set `SCORESENSE_API_ORIGIN`).

## Verifying

```bash
# Should be 200 HTML (not 302 to vercel.com/sso-api)
curl -sI "https://<preview>.vercel.app/" | head -5

# Should return ScoreSense auth config JSON (via rewrite)
curl -s "https://<preview>.vercel.app/api/auth/config"
```
