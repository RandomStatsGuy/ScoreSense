# Production Model Features

This document describes **production training inputs** — the columns fed into quantile GBM models at train and inference time. It does not list experimental **candidate-only** features (see [FEATURE_SCREENING.md](FEATURE_SCREENING.md)).

Models are trained on walk-forward seasons 2018–2023; validation and dashboard backtests use 2024 holdout. Ground-truth column lists are saved in `artifacts/models/v2/{position}_metrics.json` after each train.

## How features are assembled

```
nflverse weekly stats + PBP + schedules + snaps
        ↓
{position}_mlready.parquet  (src/etl/nflverse_etl.py)
        ↓
get_position_features(position)
  = FEATURE_REGISTRY core (rolling avgs + extra_cols)
  + gate-promoted features (screening JSON or DEFAULT_PROMOTED)
  + USAGE_BUNDLE (always-on usage/script columns)
        ↓
prepare_feature_matrix()  →  quantile GBM (P10 / P50 / P90)
```

All rolling features use **pre-game discipline**: `shift(1)` expanding averages so the current week is never included.

---

## Data sources (all positions)

| Source | Examples | ETL |
|--------|----------|-----|
| **nflverse weekly** | Passing/rushing/receiving volume, EPA, fumbles | `import_weekly_data()` |
| **nflverse PBP** | Team pass rate, red-zone usage, explosive plays, opponent EPA | `candidate_etl.py`, `load_team_epa()` |
| **Vegas schedules** | Implied team total, total line, spread | `candidate_etl._schedule_implied_totals()` |
| **Snap counts** | `offense_pct_avg`, `offense_snaps_avg` | `import_snap_counts()` |
| **Historical injury** | `injury_opportunity_boost_hist_avg` | `historical_injury.py` |
| **Sleeper (live only)** | Injury status adjustments on **projections**, not training features | `src/integrations/sleeper.py` |

WR additionally merges **BDB target quality** (`target_quality_avg`, `separation_at_throw_avg`, `defender_closing_speed_avg`) from `bdb_companion/target_quality.py` when available.

---

## QB (24 features)

### Core registry (`src/features.py`)

Rolling stat averages: passing/rushing volume, TDs, INTs, EPA, fumbles.

Extra context: `target_share_avg`, `wopr_avg`, `opponent_pass_epa_allowed`, `days_rest`, `is_home`.

### Gate-promoted (`promoted_features_qb.json`)

`carry_share_avg`, `rz_carries_avg`, `explosive_plays_avg`, `team_pass_rate_avg`

### Always-on usage bundle

`implied_team_total_avg`, `total_line_avg`, `team_pass_rate_avg`, `offense_pct_avg`, `injury_opportunity_boost_hist_avg`

### Trained column list

See `artifacts/models/v2/qb_metrics.json` → `feature_cols`.

---

## RB (24 features)

### Core registry

Rolling: receiving/rushing volume, TDs, EPA, fumbles.

Extra: `target_share_avg`, `carry_share_avg`, `opponent_rush_epa_allowed`, `days_rest`, `is_home`.

### Gate-promoted (`promoted_features_rb.json`)

`team_pass_rate_avg`, `opponent_pass_rate_allowed_avg`, `rz_targets_avg`, `carry_share_avg_trend`

### Always-on usage bundle

`implied_team_total_avg`, `offense_pct_avg`, `offense_snaps_avg`, `rz_carries_avg`, `team_pass_rate_avg`, `injury_opportunity_boost_hist_avg`

### Trained column list

See `artifacts/models/v2/rb_metrics.json` → `feature_cols`.

---

## WR / TE (23 features)

TE and REC map to the WR model via `get_position_features()`.

### Core registry

Rolling: receiving volume, TDs, targets, EPA, air yards, fumbles.

Extra: `target_share_avg`, `air_yards_share_avg`, `wopr_avg`, `opponent_pass_epa_allowed`, `days_rest`, `is_home`, `target_quality_avg`, `separation_at_throw_avg`, `defender_closing_speed_avg`

### Gate-promoted (`promoted_features_wr.json`)

Gate file is currently **empty** → falls back to `DEFAULT_PROMOTED`:

`explosive_plays_avg`, `target_share_avg_volatility`, `implied_team_total_avg`

Phase 2 screening did not promote additional WR columns (see `artifacts/analytics/phase2b_ngs_null_readout.txt`).

### Always-on usage bundle

`implied_team_total_avg`, `offense_pct_avg`, `routes_avg`, `rz_targets_avg`, `explosive_plays_avg`, `injury_opportunity_boost_hist_avg`

### Trained column list

See `artifacts/models/v2/wr_metrics.json` → `feature_cols`.

---

## Candidate-only features (not in production)

Experimental columns live in `data/analytics/candidate_features_{position}.parquet` and are evaluated via LOO screening. They are **not** merged into production training unless promoted.

Current WR candidates (Phase 2 retained):

- `deep_target_share_avg`
- `def_deep_pass_rate_allowed_avg`
- `ngs_avg_separation_avg`
- `ngs_yac_above_expectation_avg`

---

## Model hyperparameters (shared)

All positions use the same quantile GBM config in `src/ml/quantile.py`:

- `n_estimators=200`, `max_depth=4`, `learning_rate=0.05`, `subsample=0.8`
- Quantiles: P10 (0.1), P50 (0.5), P90 (0.9)

---

## Related docs

- [FEATURE_SCREENING.md](FEATURE_SCREENING.md) — how candidate features are screened and promoted
- [EVALUATION.md](EVALUATION.md) — backtest methodology
- [WR_UPSIDE_CALIBRATION.md](WR_UPSIDE_CALIBRATION.md) — next pipeline sprint (rank/P90 tuning)
