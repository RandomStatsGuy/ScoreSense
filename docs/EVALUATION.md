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

## Detailed results

Full JSON metrics: `outputs/backtest/backtest_summary.json`

Charts:

- `outputs/backtest/{position}_mae_comparison.png`
- `outputs/backtest/{position}_weekly_mae.png`

## QB highlights

The QB model shows the strongest lift over baseline (23.9% MAE improvement), driven by EPA and matchup features beyond raw passing volume.

## Limitations

- Does not model in-week injuries or snap count changes after publication
- Early-season predictions have higher variance (limited rolling history)
- WR/TE grouped together; TE-specific modeling could improve TE accuracy
