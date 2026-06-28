# RB P90 Calibration

Isolated τ=0.9 boom sample-weight calibration (same architecture as locked WR namespace).

**Status: deployed.** Production inference routes RB through `rb_model_calibrated.joblib` (`rb_p90_boom_3`).

## Production deploy

```powershell
$env:PYTHONPATH="."
.\.venv\Scripts\python scripts/rb_calibration_precision.py
.\.venv\Scripts\python -m src.train --position rb --calibrated
```

Writes `artifacts/models/v2/rb_model_calibrated.joblib`. Baseline `rb_model.joblib` unchanged for rollback.
`predict.py` loads calibrated bundle for RB; QB/WR routing unchanged.

## Walk-forward results (2019–2024)

Source: `artifacts/analytics/rb_calibration_precision_2019_2024.json`

| Config | Pooled P90 boom coverage | Δ vs default | Spearman | False ceiling |
|--------|--------------------------|--------------|----------|---------------|
| default | 0.356 | — | 0.602 | 0.048 |
| **rb_p90_boom_3** | **0.588** | **+0.232** | **0.602** | **0.015** |
| rb_p90_boom_5 | 0.689 | +0.333 | 0.602 | 0.006 |

Selected preset: `rb_p90_boom_3` (τ=0.9, boom weight 3×) — same trade-off as WR.

2024 holdout: P90 boom coverage 0.355 → 0.616; Spearman 0.642 flat.

## Presets

- `rb_p90_boom_2` / `rb_p90_boom_3` / `rb_p90_boom_5` — walk-forward only (`data/cache/backtest_models/calibration/`)
