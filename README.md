# ScoreSense

Fantasy football product from **4th Down Labs**: weekly and season projections, salary-cap **Fantasy** leagues (draft, contracts, cap, trades), and **Tools** (DFS, mock draft).

Product, brand, and design rules: **[docs/PRODUCT.md](docs/PRODUCT.md)**. Doc index: [docs/README.md](docs/README.md).

## Highlights

- **Projections** — P10 / P50 / P90 quantile GBM on a free nflverse stack (weekly + season)
- **Fantasy** — auction or pick drafts, contracts, cap, waivers, trades, league rules
- **Tools** — DraftKings / FanDuel classic lineups and mock drafts
- **Sleeper** — league link, injury-driven opportunity adjustment, roster sync
- **Narrative** — beat-channel sentiment as a readout on the Weekly / Season tables

## Quick start

```bash
python -m venv .venv
.venv\Scripts\activate
.venv\Scripts\pip install -r requirements.txt
set PYTHONPATH=.

# Full pipeline
.venv\Scripts\python run_pipeline.py

# API (dev)
.venv\Scripts\uvicorn app.api:app --reload --port 8000

# React dashboard (dev — proxies /api to port 8000)
cd frontend && npm install && npm run dev

# Production: build React, then API serves frontend/dist
cd frontend && npm run build
.venv\Scripts\uvicorn app.api:app --host 0.0.0.0 --port 8000

# Weekly refresh (cron / manual)
.venv\Scripts\python -m src.jobs.weekly_refresh

# Docker
docker compose up api
```

## Project structure

```
ScoreSense/
├── app/                    # FastAPI HTTP layer
├── frontend/               # React dashboard (Vite)
├── src/
│   ├── core/               # Shared features, context, schedule utils
│   ├── etl/                # nflverse data build
│   ├── integrations/       # Sleeper, FantasyPros, Odds API, DFS slates
│   ├── ml/                 # Quantile / ranking model code
│   ├── pipeline/           # train.py, backtest.py
│   ├── projections/        # predict, draft, ROS
│   ├── products/           # DFS, props, best ball, accuracy
│   ├── analytics/          # Eval & feature research
│   └── jobs/               # Weekly refresh cron jobs
├── bdb_companion/          # NGS tracking + target quality
├── artifacts/              # Generated models, predictions, backtest, reports
├── data/                   # Raw + processed inputs, cache
├── legacy/                 # PyQt5 desktop + Streamlit (frozen)
├── scripts/                # dev/, ops/, analysis/ CLIs
├── deploy/                 # Dockerfile
├── tests/
└── run_pipeline.py
```

## API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/predict/{position}` | Weekly projections with P10–P90 intervals |
| `GET /api/ros/{position}` | Season + rest-of-season projections |
| `GET /api/injuries` | Sleeper injury report |
| `POST /api/refresh` | Run weekly ETL + predict |
| `GET /api/refresh/status` | Last refresh metadata |
| `GET /api/auth/patreon/login` | Patreon OAuth (when `AUTH_REQUIRED=true`) |

See [docs/DEPLOY.md](docs/DEPLOY.md) for Patreon hosting and [docs/DEPLOY_CLOUDFLARE_TUNNEL.md](docs/DEPLOY_CLOUDFLARE_TUNNEL.md) for production (`app.fourthdownlabs.com`).

## Models and evaluation

[docs/EVALUATION.md](docs/EVALUATION.md) owns backtest numbers. [docs/MODEL_FEATURES.md](docs/MODEL_FEATURES.md) owns production columns. [docs/CASE_STUDY.md](docs/CASE_STUDY.md) is a 2024 portfolio write-up, not current product IA.

## License

MIT
