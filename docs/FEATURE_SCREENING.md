# Feature Screening Workflow

Analytics-first pipeline for improving ScoreSense without overfitting away boom weeks.

## Quick start

```powershell
$env:PYTHONPATH="."

# 1. Baseline upside metrics (MAE + boom recall by season)
python -m src.analytics.upside_eval --position all

# 2. Build candidate features from nflverse (pace, Vegas lines, snaps, etc.)
python -m src.analytics.candidate_etl --position all

# 3. Screen features and apply promotion gate
python -m src.analytics.feature_screen --position all

# 4. Rebuild production data with enriched features + retrain
python -m src.etl.nflverse_etl
python -m src.train --position all
python -m src.backtest --position all
python -m src.analytics.upside_eval --position all
```

## Promotion gate

A feature is promoted only when **all** of the following hold across walk-forward seasons (2019–2024):

1. Composite score improves in **≥4 of 6** seasons
2. Boom recall does not drop by more than **2 percentage points** in any season
3. Average composite delta is **negative** (lower = better)
4. Feature is pre-game safe (rolling/shifted, no post-hoc leakage)

Composite score: `0.6 × (MAE / 6.0) + 0.4 × (1 − boom_recall)`

## Outputs

| File | Description |
|------|-------------|
| `artifacts/analytics/baseline_upside_report.json` | MAE, boom recall, ceiling MAE by season |
| `artifacts/analytics/feature_screen_{position}.csv` | Univariate + ablation results |
| `artifacts/analytics/promoted_features_{position}.json` | Features that passed the gate |
| `artifacts/analytics/ngs_screen_report.json` | NGS vs pbp_proxy comparison (WR) |
| `data/analytics/candidate_features_{position}.parquet` | Tier A candidate columns |

## Data sources screened

- **Tier A (free nflverse):** implied team totals, pace, pass rate, red zone usage, explosive plays, snap counts, usage volatility/trend
- **Tier B (NGS/BDB):** separation, defender closing speed — drop files in `data/raw/ngs/`
- **Tier C (historical injury):** nflverse `report_status` → vacated usage boost

Promoted features are loaded automatically via `src/analytics/promoted_features.py` into training and inference.

For **production** feature definitions (core registry, usage bundle, trained column lists), see [MODEL_FEATURES.md](MODEL_FEATURES.md). This doc covers the **screening** workflow for experimental candidates only.

## Dashboard

Open **Accuracy** tab to view MAE vs boom recall charts (`GET /api/upside`).
