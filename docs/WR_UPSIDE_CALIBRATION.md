# WR Upside / P90 Calibration (Next Sprint)

Phase 2 feature engineering is closed. WR rank quality (2024 Spearman ~0.53) is the primary gap — not MAE (4.50 vs season-avg baseline 4.76).

## Success criteria

Improve **at least one** on 2024 holdout before expanding RB/QB work:

| Metric | Current (2024) | Target |
|--------|----------------|--------|
| Spearman | 0.53 | > 0.58 |
| Top-12 hit rate | 0.39 | +5 pp vs season-avg baseline |
| Boom recall | see `upside_eval` | No >2pp drop in any season |

Use `src/analytics/upside_eval.py` composite score and boom recall as primary walk-forward metrics.

## Experiment ideas (WR-only walk-forward)

Calibration experiments use `TrainingConfig` presets wired through `train_quantile_models` and hashed in `compute_dataset_hash`. Non-default configs cache under `data/cache/backtest_models/calibration/{config_name}/`.

1. **P90-focused sample weights** — `boom_weight_p90` upweights boom rows **only** on the τ=0.9 model (`wr_p90_boom_2`, `wr_p90_boom_3`, `wr_p90_boom_5`)
2. **P90 hyperparameter override** — `regressor_overrides_by_alpha` for WR-only depth (`wr_p90_depth_5`, `wr_p90_boom_3_depth_5`)
3. **Parallel ceiling head** (Phase 2 fallback) — `src/ml/ceiling.py` composes a residual P90 overlay without replacing the production trio

## Commands

```powershell
$env:PYTHONPATH="."

# Single preset on full upside window
python -m src.analytics.upside_eval --position wr --training-config wr_p90_boom_3

# Fast 2022–2024 comparison table
python scripts/analysis/wr_calibration_sweep.py --seasons 2022 2023 2024

# Full 2019–2024 precision check (false-ceiling rate + interval width)
python scripts/analysis/wr_calibration_precision.py --configs default wr_p90_boom_3 wr_p90_boom_5

# Composite rank screen (no retrain — post-merge sort keys only)
python scripts/analysis/wr_composite_rank_screen.py --seasons 2024
python scripts/analysis/wr_composite_rank_screen.py --seasons 2019 2020 2021 2022 2023 2024 --output artifacts/analytics/wr_composite_rank_screen_2019_2024.json

python -m src.backtest --position wr
```

Presets are defined in `src/ml/training_config.py` (`CALIBRATION_PRESETS`).

## Production deploy (WR P90 calibration)

```powershell
$env:PYTHONPATH="."
.\.venv\Scripts\python -m src.train --position wr --calibrated
```

Writes `artifacts/models/v2/wr_model_calibrated.joblib` (baseline `wr_model.joblib` unchanged).
`predict.py` loads the calibrated bundle for WR only; rollback = point loader at `wr_model.joblib`.

## P50 rank regularization sweep (next sprint)

```powershell
$env:PYTHONPATH="."
.\.venv\Scripts\python scripts/analysis/wr_p50_rank_sweep.py
```

τ=0.5 overrides only (`wr_p50_depth_3`, `wr_p50_min_leaf_20`, `wr_p50_lr_03`, `wr_p50_regularized_combo`).
Success: 2024 Spearman > 0.58, MAE within +0.05 of baseline. Results: `artifacts/analytics/wr_p50_rank_sweep_results.json`.

## LightGBM lambdarank P50 (rank objective)

```powershell
$env:PYTHONPATH="."
.\.venv\Scripts\pip install lightgbm
.\.venv\Scripts\python scripts/analysis/wr_lambdarank_eval.py
```

Sklearn P10/P90 + `LGBMRanker` P50 (`wr_p50_lambdarank` preset). Caches under `data/cache/backtest_models/ranking/`.
Production `predict.py` unchanged until Spearman gate clears.

## Out of scope

- Additional nflverse / NGS candidate columns (saturation documented in `artifacts/analytics/phase2b_ngs_null_readout.txt`)
- Full 6-season feature screen reruns
- RB/QB namespace screening until WR Spearman moves materially
- Promoting calibration configs to production `train.py` / `predict.py` until walk-forward clears success bar
- Composite rank keys alone do **not** break Spearman (see `artifacts/analytics/wr_composite_rank_screen.json`) — P50 feature/tuning sprint still required for >0.58
