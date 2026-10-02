# Production Model Features

This document describes **production training inputs** — the columns fed into quantile GBM models at train and inference time. It does not list experimental **candidate-only** features (see [FEATURE_SCREENING.md](FEATURE_SCREENING.md)).

Saved legacy bundles declare their own training seasons and feature contracts.
The current training default is 2018–2024, with chronological validation followed
by a refit on all eligible rows. Ground-truth column lists and input policy are
saved in each bundle and its metrics after training.

## Versioned pregame contracts

New training uses `pregame_v1`: strictly earlier opponent-game EPA, raw shifted
target quality for WR, and no unavailable BDB tracking columns. Existing bundles
without `input_policy` keep their original contracts. Weekly, season, ROS and DFS
skill forecasts share this policy through `predict_from_features`.

Qualified `pregame_season_recent4_p50_v1` adds five recent scoring/usage columns
to P50 only. P10/P90 retain the baseline columns. The saved contracts contain
29 QB, 29 RB and 26 WR/TE union columns when the optional FP feature flag is off.
Full refresh selects a configured qualified policy only when its frozen gate
matches the prepared inputs and training preset. A mismatch stops before fitting
and preserves the previous serving bundles. See [the gate and limitations](PROJECTION_PREGAME_REBUILD.md).
The feature lists below describe legacy registry inputs rather than overriding a
versioned bundle's saved `feature_cols` / per-head contracts.

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

Usage trends use closed-form OLS over the shifted four-observation window.
`prepare_feature_matrix()` rounds `*_trend` columns to ten decimal places and
normalizes signed zero before training, inference and fingerprinting. This
removes numerical-runtime noise while retaining exact checks for other inputs
and outcomes; see [the production parity audit](EVALUATION.md#portable-usage-trend-inputs).

---

## Data sources (all positions)

| Source | Examples | ETL |
|--------|----------|-----|
| **nflverse weekly** | Passing/rushing/receiving volume, EPA, fumbles | Current `stats_player_week` release; logged `import_weekly_data()` fallback |
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
## Target-game market median policy

`pregame_season_recent4_market_p50_v1` is qualified for QB only. P50 replaces
historical `implied_team_total_avg`/`total_line_avg` inputs with the target game's
`game_implied_team_total`, `game_total_line`, and `game_spread`. Positive nflverse
spread favors the home team, so its implied total is `(total + spread)/2` and the
away team's is `(total - spread)/2`.
[Source definition](https://nflreadr.nflverse.com/articles/dictionary_schedules.html).
Training and inference share the same pure season/week/team join. It uses saved
schedule quotes without reading game scores or fetching on the inference path.
Historical evaluations use closing-line proxies; an upcoming forecast uses the
currently saved observations. Missing/invalid quotes route to the bundle's
qualified recent-form P50. Floors/ceilings retain the prior long-history inputs,
including legacy market averages, pending separate risk qualification.
See [EVALUATION.md](EVALUATION.md) for the exact-data gate and limitations.
