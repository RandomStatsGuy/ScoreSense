# ScoreSense

NFL fantasy performance prediction with reproducible nflverse data pipelines, walk-forward backtesting, quantile intervals, and a React dashboard.

## Highlights

- **Free data stack** — nflverse weekly stats + play-by-play EPA (no paid PFF required)
- **Prediction intervals** — P10 / P50 / P90 via quantile regression
- **Sleeper integration** — injury-driven opportunity boosts on live projections
- **NGS / BDB tracking** — drop BDB 2026 files in `data/raw/ngs/` for real separation features
- **React dashboard** — FastAPI backend + Vite frontend + weekly cron refresh

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

See [docs/DEPLOY.md](docs/DEPLOY.md) for Patreon hosting.

## Portfolio

See [docs/CASE_STUDY.md](docs/CASE_STUDY.md), [docs/EVALUATION.md](docs/EVALUATION.md), and [docs/MODEL_FEATURES.md](docs/MODEL_FEATURES.md) for production feature definitions by position.

## License

MIT
