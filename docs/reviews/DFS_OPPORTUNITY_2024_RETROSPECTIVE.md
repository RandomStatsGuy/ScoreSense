# Classic opportunity screens: 2024 retrospective evaluation

Actual local run on October 12, 2026. This is a count/role diagnostic, not a fantasy-point model or a live decision-time backtest. Production forecasts and models were unchanged.

The downloaded [nflverse 2024 PBP release](https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2024.parquet) contained 49,492 rows (20,597,560 bytes). SHA-256: `3fd2896bc0b911b615142d2f1fabae54a4bbba5ab7b73b28187b118ef8af6a3b`. The source receipt records the actual local read at `2026-10-12T16:58:08.272113+00:00`; publication and historical known-at are unknown. Raw data and full predictions remain in local, uncommitted `outputs/phase4-public-evaluation/`.

The provider's [data license](https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md) is CC BY 4.0; attribution is nflverse/nflfastR. The [official field dictionary](https://raw.githubusercontent.com/nflverse/nflreadr/main/data-raw/dictionary_pbp.csv) defines `pass_attempt` to include sacks. The adapter therefore separates sacks, scrambles and thrown attempts instead of calling the raw sum throws. No participation or route data was downloaded or inferred.

## Count definition and chronology

The `accepted_scrimmage_v1` universe excludes no-plays, kneels, spikes and two-point attempts and includes overtime. Regular-season input was 47,274 rows, producing **33,335 accepted plays**, including **174 overtime plays**. All team-games reconciled `plays = designed_runs + dropbacks`, `dropbacks = sacks + scrambles + throws`, and `throws = targeted + untargeted`. Carries use designed runs plus scrambles. Targets require a receiver ID on a thrown attempt; unattributed attempts remain untargeted.

Each forecast used only completed earlier weeks of the same season. The common cutoff for a target week was one second before that week's first recorded game event. First/last UTC PBP event timestamps are historical bounds, **not official kickoff, finalization, platform lock or publication times**. Explicit later known-at rows are excluded from every team and role baseline. A late or incompatible player observation removes its team-game from role history rather than inventing a zero.

The parameter grid was declared before the run: venue prior game counts `0, 2, 4, 8, 16`. Weeks **4–9** supplied 180 tuning team-games; team-play MAE selected prior **4** (6.826267). Ties prefer stronger pooling. That choice was frozen before evaluating weeks **10–18**, comprising **268 team-games in nine week blocks**. Later outcomes did not select the parameter; regression tests perturb later outcomes and verify unchanged earlier selection and forecasts.

The inherited baseline is exactly 75% season plus 25% relevant venue for a team's plays for and its opponent's plays against, then the mean of those two adjusted values. Missing venue observations fall back explicitly to season history. The pooled alternative uses `season + n / (n + k) * (venue - season)`. Rough dropbacks multiply each play screen by the team's historical dropbacks/accepted-plays ratio from the same observed universe. These are unfitted screens, not game-script or QB outcome models.

## Untouched later block

| Screen | Team-play MAE | Team-play RMSE | Rough-dropback MAE |
|---|---:|---:|---:|
| League accepted-play average | 6.605269 | 8.349217 | 6.231097 |
| Season only, team/opponent | 6.764527 | 8.581324 | 6.323862 |
| Exact 75/25 baseline | 6.794387 | 8.618821 | 6.337755 |
| Venue only, team/opponent | 6.972881 | 8.849012 | 6.400875 |
| Earlier-selected pooled venue (`k=4`) | 6.843290 | 8.682864 | 6.356864 |

All five rows cover the same 268 team-games. Paired play-MAE deltas below subtract the 75/25 baseline; negative favors the alternative. The deterministic bootstrap samples complete week blocks 2,000 times, retaining both teams and all games within a sampled week. With only nine later blocks and one season, these intervals describe this study, not broad generalization.

| Alternative | Paired MAE delta | Week-block 95% interval |
|---|---:|---:|
| League average | -0.189118 | [-0.346523, -0.044999] |
| Season only | -0.029860 | [-0.060725, 0.002947] |
| Venue only | +0.178494 | [+0.075803, +0.283823] |
| Earlier-selected pooled venue | +0.048903 | [+0.006433, +0.088903] |

The selected pooled screen performed worse than the inherited baseline in this later block. This run supplies no basis to promote it or claim a validated venue edge.

## Observed-touch role fallback

The cohort consists of player/team touch identities observed before each target week, with absent current touches scored as zero. It is not a reconstructed active roster. Players first seen in the target week remain outside that week's prior cohort and are counted in the residual. The later block contains 4,542 prior-touch identity rows; 8,426 of 8,536 targets and 6,838 of 6,971 carries belong to that cohort. The unseen-identity residual is 110 targets and 133 carries.

The role fallback compares each player's season count per prior team-game against team-volume-scaled historical opportunity shares, using season or recent four team-games. Recent shares are not tuned on the later block. All three rows use the same prior cohort; no unknown routes, positions, injuries or availability are filled in.

| Descriptive role screen | Target MAE | Carry MAE |
|---|---:|---:|
| Season observed count mean | 1.294320 | 1.044532 |
| Season touch share × volume screen | 1.292447 | 1.043156 |
| Recent-four touch share × volume screen | 1.169010 | 0.987376 |

The recent-share result is an observed count comparison in this defined cohort. It does not validate receiving-RB eligibility, player positions, routes, active-player forecasts, fantasy scoring or a production role adjustment.

## Reproduce

Use the existing repository environment, supply the publicly downloaded file, and keep outputs local:

```powershell
$env:PYTHONPATH='.'
.venv\Scripts\python.exe -m src.analytics.dfs_opportunity_eval `
  --pbp outputs/phase4-public-evaluation/play_by_play_2024.parquet `
  --output outputs/phase4-public-evaluation/evaluation_2024.json `
  --season 2024 --tune-from-week 4 --tune-through-week 9 --evaluate-from-week 10 `
  --venue-prior-grid 0 2 4 8 16

.venv\Scripts\python.exe -m pytest tests/test_dfs_classic_comparison.py `
  tests/test_dfs_opportunity_eval.py tests/test_dfs_stack_rules.py `
  tests/test_dfs_validation.py tests/test_dfs_portfolio_selection.py `
  -q --basetemp outputs/pytest-phase4-comparison-final
```

The CLI reads a supplied local file; it does not download, run production ETL, fit models or change artifacts. The final helper/stack/validation/portfolio invocation passed **105 tests in 20.51 seconds**, including 21 new comparison/evaluation tests. A typed-pool team-alias regression first failed by allowing five normalized teammates, then passed after immutable normalization; callers' inputs stay unchanged. The raw release can change after correction; verify its hash before expecting these exact numbers. A fresh local read changes the receipt timestamp, not historical availability.

Remaining gates: multiple held-out seasons, archived decision-time sources, roster/availability reconstruction, verified route denominators, fantasy-point calibration, lineup joint outcomes, ownership/field/payout models and tournament returns. None is established by this evaluation. The complete-lineup comparison engine separately audits full rosters against one frozen input pool; its projection sums are neither lineup quantiles nor expected payouts.
