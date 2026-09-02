# ScoreSense — Agent Instructions

> **Architecture reference** for humans and AI.
> **Product, brand, and design:** [`docs/PRODUCT.md`](docs/PRODUCT.md) — read it before any user-facing work. It wins if another doc conflicts.
> Global AI rules: `.cursor/rules/scoresense-core.mdc` (always applied).
> File-specific: `.cursor/rules/frontend-draft-hub.mdc`, `.cursor/rules/draft-hub-performance.mdc`, `.cursor/rules/ml-projections.mdc`.
> Corrections: `.cursor/rules/correction-capture.mdc` + `.cursor/skills/capture-correction/SKILL.md`. Catalog: `.cursor/rules/learned-rules.mdc`.
> Living UI: `frontend/src/livingSurfaces.js` + `.cursor/rules/living-surfaces.mdc` + `.cursor/skills/match-living-surface/SKILL.md`.
> Repo skills: `.cursor/skills/run-tests/SKILL.md`, `.cursor/skills/verify-fantasy-ui/SKILL.md`, `.cursor/skills/mirror-prod-league/SKILL.md`, `.cursor/skills/start-local-app/SKILL.md`, `.cursor/skills/add-fantasy-destination/SKILL.md`, `.cursor/skills/add-hub-route/SKILL.md`, `.cursor/skills/add-ui-copy/SKILL.md`, `.cursor/skills/change-league-rules/SKILL.md`, `.cursor/skills/refresh-draft-pool/SKILL.md`.
> Doc index: [`docs/README.md`](docs/README.md).

ScoreSense (4th Down Labs) is a fantasy football product: **Projections** (weekly/season quantile GBM), **Fantasy** (salary-cap leagues, auction/pick draft, contracts, cap, trades), and **Tools** (DFS, mock draft, best ball board). Sentiment is a readout on projections. Props exist as research/backlog, not top-level nav.

Internal code may say “Draft Hub.” User-facing copy says **Fantasy**. Do not invent a fourth top-level area or a new visual language.

## Dev setup

```powershell
cd ScoreSense
$env:PYTHONPATH="."
.venv\Scripts\uvicorn app.api:app --reload --port 8000
# frontend: cd frontend && npm run dev
```

- Always set `PYTHONPATH=.` when running Python from the repo root.
- API dev serves `/api/*`; Vite dev proxies to port 8000.
- Production: `cd frontend && npm run build`, then uvicorn serves `frontend/dist`.
- Tests: `.venv\Scripts\python -m pytest tests/ -q` (CI uses `requirements-ci.txt`)
- **Mirror prod Draft Hub data locally:** `.\scripts\dev\mirror_prod_hub.ps1` (imports cap sheet into league room `0BBESQ` by default)

## Cursor Cloud specific instructions

New Cloud agents should find API `:8000` and Vite `:5173` already starting (`.cursor/environment.json` terminals). Open the app at `http://127.0.0.1:5173`. Vite proxies `/api` to the API.

- Health: `GET http://127.0.0.1:8000/api/health`
- Local auth is off. Boot writes `.env` only if it is missing (`AUTH_REQUIRED=false`, `HUB_AUTH_REQUIRED=false`).
- League room `0BBESQ` is already in the snapshot SQLite DB. Do **not** remirror on boot.
- If a server is down: `.cursor/skills/start-local-app/SKILL.md` / `bash scripts/dev/start_hub_dev.sh`
- Do not start a second API or Vite on another port.
- Cloud install uses `requirements-ci.txt` (no desktop extras). `scripts/dev/cloud_install.sh` installs `python3-venv` when the image lacks `ensurepip`.

## Architecture

| Layer | Path | Notes |
|-------|------|-------|
| HTTP | `app/api.py`, `app/hub_routes.py` | FastAPI; patron auth via `require_patron` / `require_hub_user` |
| ML inference | `src/projections/` | `predict.py`, `draft_projections.py`, `weekly_cache.py` |
| Draft Hub | `src/draft_hub/` | SQLite league state; projections are **computed**, not stored in DB |
| Materialized caches | `artifacts/draft_pool/`, `artifacts/weekly_predictions/` | Prefer cache reads over live `predict_*` on hot paths |
| Sentiment | `src/sentiment/` | Pre-aggregated features in `data/candidates/sentiment_features.parquet` |
| ETL / jobs | `src/etl/`, `src/jobs/` | nflverse build + weekly/preseason refresh |
| Frontend | `frontend/src/` | React 18 + Vite; `apiFetch` from `auth.js` |
| Config | `src/config.py` | Paths, env-backed secrets — not raw `os.environ` in routes |

## Performance architecture (summary)

| Pattern | Where |
|---------|--------|
| Draft pool artifact | `src/draft_hub/draft_pool_cache.py` → `artifacts/draft_pool/` |
| Weekly prediction artifact | `src/projections/weekly_cache.py` → `artifacts/weekly_predictions/` |
| Pool vs overlay split | `build_draft_pool_payload()` + `build_value_overlay()` in `value_sheet.py` |
| Model cache | `predict.load_model()` in-process, mtime-keyed |
| CPU offload | `app/process_pool.py` global executor — not per-route pools |

See `.cursor/rules/draft-hub-performance.mdc`, `.cursor/rules/ml-projections.mdc`, and `.cursor/rules/frontend-draft-hub.mdc` for constraints. User-facing Fantasy pages follow `docs/PRODUCT.md`.

## Key files

| Area | Paths |
|------|-------|
| Valuations | `src/draft_hub/auction_values.py`, `value_sheet.py` |
| Hub week scoring | `src/draft_hub/hub_scoring.py` — lineups, H2H schedule, PPR apply for ScoreSense-only leagues |
| Hub UI | `frontend/src/DraftHub/DraftHub.jsx`, `hubDataCache.js` |
| Rookie role | `src/projections/rookie_role.py`, `data/projections/rookie_role_overrides.yaml` |
| Sentiment readout | `src/sentiment/readout.py`, `fantasy_digest.py`, `beat_digest.py` |
| Refresh jobs | `src/jobs/weekly_refresh.py`, `preseason_refresh.py` |

## Pre-warm caches (offseason / after model retrain)

```powershell
.venv\Scripts\python -m src.jobs.preseason_refresh --draft-season 2026
```

First visit to **Available players** or **Live draft** is slow locally when `artifacts/draft_pool/pool_{season}.parquet` is cold or fingerprint-stale (live ML inference). Run preseason refresh above, or `python scripts/ops/fix_artifact_fingerprints.py` after mlready changes.

## Draft Hub perf debugging

- Roster/cap reads are **DB-only**; Sleeper runs on link/sync only (`GET /api/hub/roster?live_sleeper=1` for one-off live pull).
- Scoring history is cached in SQLite (`sleeper_scoring_cache`); refreshed on league Sleeper sync or `GET /api/hub/league/{id}/insights?refresh=1`.
- Set `HUB_TIMING=true` in `.env` to log slow hub routes (`>500ms`) and return `X-Hub-Timing-MS` on hot paths.

## Production hosting

| Item | Value |
|------|-------|
| URL | `https://app.fourthdownlabs.com` |
| VPS | `104.207.158.4` → `/root/scoresense` |
| Tunnel | Cloudflare (`pricebot`) → `127.0.0.1:8000` |
| Deploy | `.\deploy.ps1` from repo root |
| Vercel | Off (`vercel.json` `deploymentEnabled: false`) — not production |

Full runbook: `docs/DEPLOY_CLOUDFLARE_TUNNEL.md`. Server `.env` is **not** deployed — edit on VPS only.

CI, Vercel, and review-bot budget: [`docs/CI.md`](docs/CI.md). Keep PRs **draft** until you want paid checks. Cloud agents must not mark a PR ready unless the user asks.
