# ScoreSense

NFL fantasy performance prediction with reproducible nflverse data pipelines, walk-forward backtesting, and a portfolio-ready web demo.

## Highlights

- **Free data stack** — nflverse weekly stats + play-by-play EPA (no paid PFF required)
- **Unified features** — same feature definitions for training and inference
- **Walk-forward backtest** — compares model vs season-average and last-game baselines
- **Web demo** — Streamlit app with weekly projections
- **BDB companion** — target quality metrics scaffold for Big Data Bowl-style analytics

## Quick start

```bash
# From project root — use project venv (recommended)
python -m venv .venv
.venv\Scripts\activate        # Windows
.venv\Scripts\pip install -r requirements.txt

# Full pipeline: ETL -> train -> backtest
set PYTHONPATH=.
.venv\Scripts\python run_pipeline.py

# Streamlit demo
.venv\Scripts\streamlit run app/streamlit_app.py

# Legacy PyQt desktop app (PFF CSV upload)
.venv\Scripts\python fantasy.py

# FastAPI
.venv\Scripts\uvicorn app.api:app --reload
```

## Project structure

```
ScoreSense/
├── app/                  # Streamlit + FastAPI demos
├── bdb_companion/          # Big Data Bowl companion (target quality)
├── data/processed/       # nflverse ML-ready datasets (generated)
├── docs/                 # Case study and evaluation docs
├── models/v2/            # Trained joblib models (generated)
├── outputs/              # Predictions and backtest artifacts
├── src/                  # Core pipeline modules
│   ├── etl/              # nflverse ETL
│   ├── train.py          # Model training
│   ├── predict.py        # Inference
│   ├── backtest.py       # Walk-forward evaluation
│   └── features.py       # Unified feature definitions
├── fantasy.py            # Legacy PyQt UI
└── run_pipeline.py       # One-command pipeline runner
```

## Pipeline commands

```bash
python -m src.etl.nflverse_etl --seasons 2018 2019 2020 2021 2022 2023 2024
python -m src.train --position all
python -m src.backtest --position all
python -m bdb_companion.target_quality
```

## Scoring

Standard PPR fantasy scoring via nflverse `fantasy_points_ppr` when available, otherwise computed from weekly stat columns.

## Portfolio

See [docs/CASE_STUDY.md](docs/CASE_STUDY.md) for architecture, methodology, and backtest results.

## License

MIT
