# ScoreSense Evaluation

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
