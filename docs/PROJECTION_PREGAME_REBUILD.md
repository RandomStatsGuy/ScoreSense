# Pregame rebuild and recent-form qualification — 2026-10-01

This second repair rebuilds the public football inputs and qualifies recent
scoring/usage for the **P50** forecast. It follows the shared role and timing
repairs in [Projection reliability](PROJECTION_RELIABILITY.md). The changes
are prepared for review; production has not been rebuilt or retrained here.

## Repaired inputs and training

- Prefer nflverse's current `stats_player_week` releases for every season,
  including played zeros and negative scores. Log a fallback to the older feed.
  Normalize rushing, receiving and sack fumble components without double-counting
  explicit totals.
- Load weekly stats, schedules, PBP and snap observations once per rebuild.
  Request no unused participation feed. Aggregate published PBP precision before
  the model's final matrix conversion. Share the same PBP with target quality.
- Key target quality by GSIS/season/week, regardless of receiver-name aliases.
  Keep the raw per-game observation. New WR bundles use its shifted expanding
  average, avoiding legacy normalization over later seasons. They omit unavailable
  separation-at-throw and closing-speed tracking columns; these are not replaced
  with different NGS measures under the same names.
- Version training and inference together. `pregame_v1` uses each scheduled
  opponent's last eight observed defensive games strictly before the target week.
  Defense games are deduplicated before averaging. Legacy bundles retain their
  saved feature contract until replacement bundles are deliberately fitted.
- Retain zero/negative observed scores when fitting. Validate on a complete later
  season (or the final weeks for a single-season dataset), then refit on every
  eligible training row. Update the calibrated RB/WR files actually used by the
  serving router. Stage all five fits before publishing any of the new files,
  so a later source/fit failure preserves the previous model set.
- Join cached PPR consensus before training. Inference joins only the exact target
  season/week and clears carried-over consensus. Retries preserve existing training
  observations; joins reject ambiguous names and handle team aliases. Keep ECR-only
  players when projection coverage is partial. Empty caches are retried by jobs,
  and partial/empty refreshes retain usable same-week captures with their original
  observation time. Cache-only reads
  perform no requests. New captures record their time and invalidate forecast caches.

The research rebuild covers 2018–2026, with 2026 complete observed weeks 1–3.
It has 5,426 QB, 13,747 RB and 30,617 WR/TE player-stat rows. Current-season
defensive inputs are no longer entirely zero. Required columns exist for the
versioned contracts. Cold-start nulls and unavailable historical injury context
remain visible in the input audit before compatibility imputation.

## Paired historical gate

Each test year trains on strictly earlier seasons. Evaluation uses observed
regular-season player-stat rows, including zero/negative scores; it does **not**
reconstruct all inactive roster weeks. Both arms use the same pregame-safe base
features, scoring, training preset and missing-feature handling.

The selected policy, `pregame_season_recent4_p50_v1`, adds the preceding four
observed games' scoring and position-specific usage to P50. Once the player has
appeared in the current season, the window uses that season's evidence. Before
the opener it falls back to preceding-season observations. P10/P90 retain the
baseline feature contracts. Quantile-order repair can still adjust displayed
tails when they cross the new median.

| Position | 2019–2024 composite wins | Mean composite delta | 2025 MAE, baseline → recent | 2025 boom recall delta |
|---|---:|---:|---:|---:|
| QB | 6/6 | −0.02356 | 6.697 → 6.380 | 0 pp |
| RB | 6/6 | −0.01398 | 4.195 → 4.073 | 0 pp |
| WR/TE | 6/6 | −0.01411 | 4.012 → 3.808 | 0 pp |

All three satisfy the repository's [six-season feature gate](FEATURE_SCREENING.md)
and an additional 2025 improvement/boom-recall check. The boom result mainly
reflects retaining the baseline tail models; it is not independent evidence of
better tail calibration. Reports also retain P50 bias, top-12 overlap, interval
coverage, pinball losses and input audits for each fold.

Ranking evidence is mixed: 2025 top-12 overlap changes from 47.2% to 46.8% for
QB, 43.1% to 43.5% for RB, and 23.1% to 26.4% for the combined WR/TE pool.
Recent P50 mean bias is −0.09, −1.33 and −1.02 points respectively. These results
support the limited median change, not a claim that starter rankings or the
external-projection scale are solved.

Several candidates were explored, including variants checked on 2025. **2025 is
an additional later-year check, not an untouched or preregistered holdout.**
Across-season recent features for every head failed the QB/RB gate; the WR variant
lost 4.27 percentage points of 2025 boom recall. Season-bounded features for every
head lost 9.68 pp in QB 2023 and 5.16 pp in RB 2021. Those variants are not enabled.

Frozen evidence lives in
[`artifacts/evaluations/model_gates`](../artifacts/evaluations/model_gates).
Automatic `train_all` selects the recent policy only when the data/target digest,
feature order, position, effective regressor parameters, training preset and
scikit-learn version match that evidence exactly. Source revisions or configuration
changes fall back to the safe baseline and need a new gate. Training cannot publish
an explicitly requested recent policy without matching evidence.

## Current service replay

The fitted research bundles use 2018–2024 training data. An offline replay uses
saved Week 4 NFL/Sleeper identities, injuries and schedules, invokes the real
weekly/season/ROS inference paths, and feeds the resulting forecasts to DFS and
the trade outlook. It does not update live artifacts or private league data.

| Consumer | Saved rostered skill players | Finite forecasts | Missing |
|---|---:|---:|---:|
| Weekly | 798 | 798 | 0 |
| Season | 798 | 798 | 0 |
| ROS | 798 | 798 | 0 |
| DFS skill pool | 798 | 798 | 0 |
| Trade skill outlook | 798 | 798 | 0 |

These counts include rostered injured/depth players. They validate numerical
coverage against the saved roster, not model accuracy, all real-world players,
live cache freshness, or K/DST estimates. Synthetic no-history profiles remain
labelled `Roster estimate`; a missing forecast is not filled with zero.

| Player | Qualified Week 4 P50 | Captured same-week FantasyPros PPR projection |
|---|---:|---:|
| Josh Allen | 21.64 | 22.77 |
| Alvin Kamara | 10.45 | 9.91 |
| Aaron Jones | 15.51 | 15.08 |
| Fernando Mendoza | 0.33 | 0.23 |
| Kendre Miller | 3.45 | 6.44 |
| Jaxon Smith-Njigba | 14.16 | 22.26 |

The FantasyPros projection capture is timestamped 2026-10-01 21:56:39 UTC.
It is a diagnostic same-week comparison, not a consensus-blend gate. The model
P50 and an external point forecast need not estimate the same statistic. JSN's
remaining discrepancy deserves investigation. Retained P90 forecasts are also
wide (Kamara 37.23, JSN 30.62); passing this median gate does not establish that
their tails or low-participation estimates are calibrated.

Aggregate replay, source fingerprints and rejected-candidate evidence are in
[`projection_pregame_rebuild_2026-10-01.json`](../artifacts/evaluations/projection_pregame_rebuild_2026-10-01.json).

## Remaining work

- Rebuild/retrain/materialize production before claiming the live forecasts changed.
  This PR changes code and frozen evaluation evidence, not the saved serving bundles.
- Evaluate participation probability, current role/age changes and zero-game weeks,
  especially for no-history players and backups. The observed-games gate cannot
  establish the probability of an inactive week.
- Evaluate expected points alongside P50 and a timestamped consensus blend before
  changing ranking/headline behavior. Validate star/starting-player ranking and
  tail calibration separately from all-player MAE.
- Reevaluate the legacy Vegas implied-total feature definition. Its home spread
  sign currently disagrees with the [nflverse schedule dictionary](https://nflreadr.nflverse.com/articles/dictionary_schedules.html).
  Changing it under this frozen contract would invalidate the recorded gate;
  it needs a versioned correction and new comparison.
- Historical injury context is still entirely zero in these cohorts, and BDB
  tracking is unavailable. The audits expose those limitations.

## Reproduction and validation

Set `PYTHONPATH=.`. Use isolated folders when rebuilding/evaluating; do not
replace production artifacts before checking the complete result.

```powershell
python -m src.etl.nflverse_etl --seasons 2018 2019 2020 2021 2022 2023 2024 2025 2026 --output-dir <processed> --candidate-dir <candidates>
python -m src.analytics.recent_usage_eval --position qb --candidate-policy pregame_season_recent4_p50_v1 --data-dir <processed> --output <qb-gate.json>
# Repeat the gate for rb and wr. Individual candidate fits require their matching report.
python -m src.pipeline.train --position qb --input-policy pregame_season_recent4_p50_v1 --gate-report <qb-gate.json> --data-dir <processed> --model-dir <models>
# RB/WR candidate fits additionally require --calibrated.
python scripts/ops/replay_projection_services.py --season 2026 --week 4 --data-dir <processed> --model-dir <models> --cache-dir <saved-roster-cache> --consensus-dir <fp-cache> --output <replay.json>
```

The saved roster cache must contain `sleeper_players.json`,
`nflverse_roster_2026.parquet` and `nfl_schedules.parquet`. The replay explicitly
blocks network requests and performs no serving-cache writes. Public raw inputs
come from the [nflverse releases](https://github.com/nflverse/nflverse-data/releases).
Source updates can legitimately change digests and require rerunning the gate.

Validation: 2,008 tests passed and 2 skipped in the Windows-compatible backend
suite before the final median-policy/staging refinements. Final focused runs
passed 73 training/input/consensus tests, 153 consumer/cache tests, and 49 consensus
and temporal-input checks (these runs overlap). The two omitted unchanged shell
test files, `test_render_blueprint.py` and `test_resolve_python.py`, require Linux
shell behavior and had 10 Windows failures in the earlier full run. No UI changed.
