# Projection reliability repair — 2026-10-01

The subsequent rebuild, qualified recent-form models and service coverage replay
are documented in [Pregame rebuild](PROJECTION_PREGAME_REBUILD.md). The results
below describe the first repair, before that rebuild.

This first repair fixes shared input construction and role handling. It does
not replace the production model bundles or establish that the rankings and
point scale are calibrated. Weekly, DFS, Fantasy, preseason and ROS consumers
inherit the shared repairs; projection availability remains distinct from input
quality and forecast accuracy.

## Confirmed failures and repairs

- Candidate ETL imported the base ETL while the base ETL was still importing.
  The caught import error disabled both candidate and historical injury
  enrichment. Imports now happen after initialization, and an enriched frame
  is assembled before publishing the processed file.
- Snap counts identify players by PFR ID, whereas weekly statistics use GSIS
  ID. Resolve the explicit identifier crosswalk before aggregation; unmatched
  or unavailable snap observations stay missing rather than becoming zeros.
- The last played game's feature row excluded that game's own statistics.
  Inference now advances the existing expanding averages through all completed
  games strictly before the target. It retains prior-season profiles for players
  who have not played yet, with their source season/week recorded. This does
  not substitute recent-game features into a model trained on career averages.
- Stub rows inherited private role/depth flags from a donor player, then scaled
  those flags as if they were usage. Synthetic profiles now have their own
  metadata. Scaling preserves identity, context and role flags. Veterans without
  history do not receive rookie camp overrides.
- Camp overrides default to week 1 only. `start_week` and `end_week` explicitly
  scope a later override. Current backup QBs also receive the existing output
  discount because shrinking inputs alone does not reliably shrink a GBM's
  conditional scoring forecast. Research sentiment no longer changes live roles.
- Opportunity allocation uses the last three observed games' usage shares,
  separately from the model's career averages. Synthetic profiles, old-season
  in-season profiles and touches from a previous team cannot vacate usage. An
  injured player's observed current-team role is retained even if its depth
  listing changes. Healthy committee members share the vacated opportunity.
- Target opponents, home/away and rest now come from the target game. The ROS
  cold path applies the same schedule and backup handling. Injury overlay jobs
  prepare completed-game profiles instead of looking for an unplayed target-week
  statistics row. Shared input policy, schedule and role revisions invalidate
  weekly, ROS and Fantasy pool artifacts.

## Input audit

`scripts/ops/audit_projection_inputs.py` reads saved bundle feature contracts
and local datasets without fetching feeds. It reports absent columns, null
counts, all-zero columns and candidate-data recency, including a separate audit
of current-season profiles. Its nonzero exit status means structurally incomplete
inputs. An all-zero column is a diagnostic, not automatically an error: some
observed stats can legitimately be zero. Weekly artifact metadata retains the
audit before compatibility imputation.

The read-only production snapshot contains 2026 weeks 1–3. It lacks 7/24 QB,
11/26 RB and 11/25 WR/TE model columns. Candidate enrichment stops at 2025
week 22, and current-season defensive EPA inputs are entirely zero. The import
and ID fixes prevent known failures during subsequent rebuilds; they do not
magically repair those already materialized production files. Compatibility
imputation remains visible in the audit and is not evidence of complete inputs.

## Historical comparisons

The backtest now trains separately for each holdout season using only earlier
seasons. Cold-start baselines use training-only points, and previous-game
baselines can use the preceding season. Legacy same-game defensive EPA is
replaced with strictly earlier opponent-game history for evaluation. Regression
tests change future outcomes and verify that earlier forecasts do not change.

The fixed-bundle timing replay uses the identical observed player-games on both
sides, includes played zeros, uses no present-day roster/injury feeds and applies
lagged matchup inputs to both sides. It holds out regular-season 2025 against
bundles declared trained through 2024. Missing features remain missing on both
sides; legacy bundles may have learned same-game EPA leakage during training.
**This is a timing diagnostic, not a model promotion gate.**

| Pool | Player-games | MAE before → after | Top-12 overlap before → after |
|---|---:|---:|---:|
| QB | 613 | 7.051 → 6.996 | 48.6% → 47.2% |
| RB | 1,564 | 4.665 → 4.616 | 41.2% → 41.7% |
| WR/TE | 3,606 | 4.380 → 4.352 | 20.8% → 20.4% |

Point error improves slightly; ranking results are mixed. Detailed pinball loss,
interval coverage, input audits and replay results are in
[`projection_input_integrity_2026-10-01.json`](../artifacts/evaluations/projection_input_integrity_2026-10-01.json).

A separate research backtest reattaches archived 2025 candidate enrichment and
retrains models on 2018–2024 with lagged matchup features. It evaluates all observed
2025 rows, including postseason and played zeros, so its cohort differs from the
timing diagnostic. It uses the current feature registry without enabling the
FantasyPros feature flag. It has cold-start nulls, all-zero injury history, and
two unavailable WR tracking columns. Results are recorded for investigation;
no resulting model is routed into production.

The local Week 4 replay emits finite P10/P50/P90 for all 854 included skill
profiles (119 QB, 205 RB, 530 WR/TE). Mendoza's estimate is 1.717 P50, Kamara's
16.094 and Jones's 14.028. JSN remains 10.209: fixing role and timing does not
resolve the larger scale disagreement. These are diagnostic snapshot outputs,
not promises of calibrated player forecasts or a complete-service coverage gate.

## Remaining model/data gate

1. Rebuild and audit current enrichment, consensus and tracking inputs against
   the saved feature contract. Repair source outages and preserve available
   historical observations without disguising unavailable feeds as zeros.
2. Version defensive context as strictly pre-game in both training and serving;
   retrain and compare it consistently rather than feeding a changed feature
   definition to an old bundle.
3. Evaluate recent usage, participation probability, age and role changes through
   multiple season holdouts. Check cold starts and low-participation players as
   well as starters, played zeros, rank error, pinball loss and interval coverage.
4. Compare timestamped pregame consensus using the same week, scoring and
   cohort. Treat expected points and P50 as separate statistics. Evaluate an
   expected-points head or consensus blend before changing the headline or model
   routing. Model agreement alone does not demonstrate accuracy.

NFL Savant credits nflverse for play-by-play, and FTN/NGS/PFR for additional
charting and snap data: [source credits](https://nflsavant.com/players). Its
[update notes](https://nflsavant.com/changelog) explain that some early-season
charting arrives later. It is useful for cross-checking coverage and researching
features; duplicating the shared play-by-play is not itself an improvement.

## Reproduce locally

Set `PYTHONPATH=.`. In a test-only offline environment also set `TESTING=1`.
Point the scripts to the captured football-data and model directories:

```powershell
python scripts/ops/audit_projection_inputs.py --season 2026 --week 4 --data-dir <processed> --model-dir <models> --candidate-dir <candidates> --output <audit.json>
python scripts/ops/replay_projection_timing.py --data-dir <processed> --model-dir <models> --test-season 2025 --bundle-train-through 2024 --output <replay.json>
```

Use `src.pipeline.backtest` for separately retrained historical comparisons;
candidate features must be merged into the evaluation dataset first. Do not use
the legacy 2024 table in EVALUATION.md as evidence for this repair.

## Validation

The full backend run passed 1,989 tests, skipped 2, and failed 10 unchanged
Linux-shell tests on Windows (`test_render_blueprint.py` and
`test_resolve_python.py`: unavailable `/bin/sh` and incompatible shell paths).
Final targeted checks cover the later snap mapping, atomic publication and
scaling changes; all 16 new input-integrity regressions pass. No frontend UI or
production model bundle was changed.
