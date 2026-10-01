# ScoreSense Evaluation

The 2024 tables below are legacy results and predate the corrected season split,
baseline fallback and defensive-EPA timing. For current evidence, see
[Projection reliability](PROJECTION_RELIABILITY.md) and the
[2019–2025 paired pregame gate](PROJECTION_PREGAME_REBUILD.md). The latter qualifies
recent scoring/usage for P50 on exact matching training inputs; production
rebuild/retraining and additional scale/rank/tail calibration work remain.

Walk-forward backtest results on **2024** holdout (trained on 2018–2023).

Regenerate:

```bash
.venv\Scripts\python run_pipeline.py
```

## Summary (2024 holdout)

| Position | Model MAE | Season Avg MAE | Improvement | Top-12 Overlap |
|----------|-----------|----------------|-------------|----------------|
| QB       | 5.02      | 6.60           | **23.9%**   | 70.2%          |
| RB       | 4.77      | 5.02           | **5.0%**    | 50.4%          |
| WR/TE    | 4.70      | 4.76           | **1.3%**    | 36.7%          |

## Methodology

- **Training seasons:** 2018–2023
- **Test season:** 2024
- **Protocol:** Train once on pre-2024 data; predict all 2024 player-games using pre-game rolling features
- **Baselines:** Season-to-date average; previous game fantasy points

## Metrics

| Metric | Description |
|--------|-------------|
| MAE | Mean absolute error in fantasy points (lower is better) |
| RMSE | Root mean squared error |
| Spearman | Rank correlation between predicted and actual |
| Top-12 overlap | Share of correctly identified top-12 performers each week |

## Upside metrics

Boom-week detection is evaluated separately from mean accuracy. See [FEATURE_SCREENING.md](FEATURE_SCREENING.md).

| Metric | Description |
|--------|-------------|
| Boom recall | Share of boom weeks (QB ≥25, RB/WR ≥20 pts) flagged by P90 or top-15% rank |
| Ceiling MAE | MAE on top-decile actual scorers only |
| P90 boom coverage | Share of boom weeks where actual ≤ predicted P90 |
| Composite score | `0.6 × norm(MAE) + 0.4 × (1 − boom_recall)` — primary feature promotion gate |

Generate: `python -m src.analytics.upside_eval --position all` → `artifacts/analytics/baseline_upside_report.json`

## Season-long accuracy

Weekly MAE does not validate **Draft** (preseason totals) or **Season / ROS** (mid-season rest-of-season totals). Use the season-long eval:

```bash
python -m src.analytics.season_long_eval --position all --tune-qb-alpha
python -m src.analytics.season_long_eval --prefetch-fp   # cache FP week-1 when API key set
```

Output: `artifacts/analytics/season_long_accuracy.json` (also built by **Rebuild accuracy report** in the UI). The rebuild job prefetches FantasyPros week-1 projections for eval seasons when `FANTASYPROS_API_KEY` is configured.

| Checkpoint | Projection | Compared to |
|------------|------------|-------------|
| Preseason | Walk-forward Week 1 median × 17 (QB blends with prior-year PPG) | Actual regular-season total |
| Preseason (industry) | FantasyPros week-1 consensus PPR × 17 (proxy, not FP season-long sheet) | Actual regular-season total |
| ROS weeks 4, 8, 12 | YTD + rolling 4-week P50 rate × games remaining (17 − played) | Actual regular-season total |

Metrics: MAE and Spearman rank correlation on season totals. Baseline: prior-year PPG × 17. FantasyPros benchmark requires ≥30% week-1 FP coverage per season (`fantasypros_is_benchmark`); seasons below that threshold still show FP MAE as diagnostic. Players with fewer than 8 games played are excluded. Regular-season actuals sum weeks 1–18; projection math uses 17 games per player.

**Preseason blend (α):** `tune_preseason_alpha` sweeps α per position (QB/RB/WR) on train seasons (2019–2024), holdout 2025. Constants live in `src/projections/season_blend.py` (`PRESEASON_BLEND_ALPHA`). JSON keys: `{position}_blend_tuning`, `ros_rolling_weeks_tuning`, `fp_blend_tuning`.

**Expected games:** Prior-year games played (rookies default 12) when `PRESEASON_USE_EXPECTED_GAMES=true`. **Draft cohort** = depth-filtered preseason roster matching auction boards.

**FP production blend:** `PRESEASON_FP_BLEND_ENABLED=true` applies eval-tuned `PRESEASON_FP_BLEND_BETA` (ScoreSense weight).

API: `GET /api/accuracy/season-long?position=qb` — shown on the Accuracy tab under **Season-long accuracy**.

## Season quantiles (SCORE-2)

`Season Floor`/`Season Ceiling` (and the underlying `Season P10`/`Season P50`/`Season P90`) are no
longer weekly `Low (P10)`/`High (P90)` × 17 — stacking weekly quantiles overstates season interval
width under independence (`Q_τ(Σ X_w) ≠ Σ Q_τ(X_w)`) and ignores byes/game-count uncertainty.
`src/projections/season_quantiles.py` instead runs a schedule-aware Monte Carlo: fits an asymmetric
weekly law to `(q10, q50, q90)`, simulates which scheduled (non-bye) weeks are played from a
major/minor-injury mixture anchored to the *same* `expected_preseason_games` used for `Season
Proj`, and correlates outcomes via a shared team-week "script" shock plus AR(1) week-to-week
persistence. `season_quantile_method` on each draft-pool row is `mc_schedule_v1` (default) or the
legacy `independent_scale` (`SEASON_QUANTILE_METHOD=independent_scale`, kept for A/B). Bump the
draft-pool fingerprint tag in `pool_fingerprint()` when tuning the simulation constants.

Offline interval-coverage eval (target ~80%, see acceptance criteria on the ticket):

```bash
python -m src.analytics.season_quantile_coverage_eval --position all
```

Output: `artifacts/analytics/season_quantile_coverage.json` — empirical coverage (share of holdout
actual season totals inside `[Season P10, Season P90]`) by position/season, plus the legacy
`independent_scale` band for comparison.

## Pregame point and risk qualification (October 2026)

`src.analytics.forecast_candidate_eval` compares a candidate with the qualified
current-season recent-form P50 model on identical games. Every fold trains only
on earlier seasons. It retains zero/negative observed scores, freezes the
reference-ranked cohort before comparing candidates, and saves row forecasts
for independent rescoring. Inactive roster weeks are not reconstructed. These
are raw model comparisons; historical injury and availability overlays are not
validated by this experiment.

The QB target-game market candidate passed 2019–2024 and the additional 2025
check. All seven seasons improved point error in both the full observed pool
and the top 24 reference-projected QBs per week. In 2025, that second cohort's
MAE fell from **6.713 to 6.542**; its paired week-bootstrap 95% interval for the
change was **[-0.295, -0.052]**. Boom recall and bust F1 were unchanged in 2025.
The exact gate and training matrix digest are in
[game_market_gate_qb.json](../artifacts/evaluations/model_gates/game_market_gate_qb.json).
2025 has already been explored; it is **not an untouched holdout**.

Point-candidate qualification preserves the six-season composite/boom gate and
adds lower mean MAE and weighted interval score on both cohorts, no seasonal
boom precision/recall or bust F1 loss over 2 percentage points, and a 2025 paired
MAE interval excluding zero. A wide range cannot win on coverage alone. Interval
score penalizes width and missed outcomes; weighted interval score uses the
median and the central 80% range with weights 0.5 and 0.1, divided by 1.5.
[Scoring rule reference](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1008618).
The probability/Brier diagnostics assume a quantile-matched piecewise normal
distribution and do not establish calibrated production boom/bust probabilities.

RB market context did not improve 2025 error. WR market gains failed the paired
confidence check. Reducing RB/WR P90 boom weighting from 3 to 2 improved interval
scores but lost 8.40/5.21 percentage points of all-observed boom recall in 2025.
These candidates remain unpromoted.

An informational cohort also reports top 20 QB/TE and top 40 RB/WR results,
including separate WR and TE diagnostics. These sizes follow the
[FFA 2015–2025 study](https://fantasyfootballanalytics.net/which-dfs-projections-are-most-accurate).
They do **not** make a direct provider comparison: scoring, actual players,
publication cutoffs and seasons must match, using dated provider forecasts.
Historical nflverse market lines are closing-line proxies, not archived
Thursday projections. No industry-leading accuracy claim follows from this gate.

```powershell
$env:PYTHONPATH="."
python -m src.analytics.forecast_candidate_eval --position qb `
  --candidate game_market_p50 --data-dir data/processed `
  --schedules data/processed/nfl_schedules.parquet `
  --output artifacts/evaluations/research/game_market_qb.json `
  --checkpoint-dir artifacts/evaluations/research/checkpoints `
  --gate-output artifacts/evaluations/model_gates/game_market_gate_qb.json
```

The gate selects a versioned median feature contract, not a replacement point
head. Training requires its exact feature matrix and fit parameters to match.
The final bundle includes the qualified recent-form median as a fallback when
target-game quotes are absent/invalid. P10/P90 retain their prior contracts.
Fresh ETL saves schedule snapshots for offline training and cached inference;
the shared schedule revision invalidates weekly, season and ROS artifacts.
Publication still requires rebuilding training inputs, retraining, and refreshing
serving artifacts. Research reports and fitted replay bundles do not deploy code.

## Detailed results

Full JSON metrics: `artifacts/backtest/backtest_summary.json`

Charts:

- `artifacts/backtest/{position}_mae_comparison.png`
- `artifacts/backtest/{position}_weekly_mae.png`

## QB highlights

The QB model shows the strongest lift over baseline (23.9% MAE improvement), driven by EPA and matchup features beyond raw passing volume.

## Limitations

- Does not model in-week injuries or snap count changes after publication
- Early-season predictions have higher variance (limited rolling history)
- WR/TE grouped together; TE-specific modeling could improve TE accuracy


## DFS special teams (September 2026)

The separate DFS defense head uses full-game DraftKings scoring and strictly lagged team/opponent features. The 2023 and 2024 expanding-season evaluations beat the unconditional median and mean quantile-loss baselines in both folds, with 81.25% and 80.88% P10-P90 coverage. The kicker candidate failed the gate; production uses labeled empirical kicking ranges instead. This is an initial marginal forecast gate, not joint-outcome or GPP-return validation. [Complete metrics and source hashes](../artifacts/models/v2/dfs_special_teams.evaluation.json), [scope and refresh details](DFS_PLAYER_ESTIMATES.md).
