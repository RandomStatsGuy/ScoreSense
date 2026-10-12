# Shared football outcomes: research implementation and evaluation

Phase 5 adds a bounded **declared empirical scenario review** and a DraftKings NFL Classic event-scoring adapter. It does not promote a production forecast, a calibrated football simulator, an ownership/field model or tournament EV. Production P10/P50/P90 forecasts remain unchanged.

## What the engine establishes

`src/products/dfs_shared_outcomes.py` validates an exact DraftKings/NFL/Classic slate, its canonical player/game identities, whole salaries and every profile's explicit participant availability. It then scores every supplied complete game ledger with `src/products/dfs_event_scoring.py`. The scoring contract and the actual official-rules receipt are recorded in [DFS_CLASSIC_SCORING_CONTRACT.md](DFS_CLASSIC_SCORING_CONTRACT.md).

Within a draw, a whole game profile supplies both offenses, selected and unselected players, explicit residual actors, and both defenses. Passing/receiving yards and touchdowns, target/completion counts, sacks, interceptions and fumble recoveries reconcile against the same events. Designed runs, scrambles, kneels, spikes and supported special plays remain separate. Scores retain negative outcomes, zero touches and the site's actual bonuses. Inactive participants have an explicit zero-event state; unknown or missing participation is rejected rather than filled with zero.

Each profile declares weather, game script, personnel and normal/limited/inactive states. Sampling a whole profile preserves those declared associations and competition for its finite opportunities. These labels do not fit a weather effect, model injury probabilities or generate a new personnel forecast. Profiles and weights are user/source declarations, not calibrated future probabilities. Between different games, sampling is explicitly independent.

No Gaussian distribution is fitted to P10/P50/P90. Quantiles in the review are calculated from the sampled lineup totals themselves; individual player quantiles are never added to produce a lineup quantile. The tool applies no additional correlation bonus.

The bank requires explicit analysis, hosted-ingestion and display rights for every source, known-at/publication times that do not follow the decision cutoff when declared, and a cutoff before every target kickoff. Source scope cannot be relabeled between synthetic and retrospective data. Source timestamps, rights and hashes remain declarations; none establishes authenticity, provider permission beyond the supplied rights, complete source coverage or historical pre-lock availability. Raw event ledgers are removed from the prepared bank, which retains event/scoring hashes, all actor scores and conservation audits. A content hash detects later mutation; it is not an authentication token. HTTP callers must prepare raw input again rather than trust a client-supplied prepared hash.

`prepare_scenario_bank(payload, *, context, pool, now=None)` validates and scores atomically. `scenario_bank_summary(bank)` returns compact provenance/capability metadata. `evaluate_shared_outcomes(bank, lineups, *, seed=0, draw_count=256, purpose="evaluation")` reviews complete, distinct nine-player scoring rosters under one common set of draws. It verifies position/FLEX composition, the $50,000 cap and the Classic requirement to include players from at least two different NFL games; it does not certify current platform entries, historical slot locks or all saved strategy controls.

Generation, selection and evaluation use separate deterministic PRNG domains derived from the bank hash, explicit seed and purpose. Reordering finalist lineups does not change the common draws. Independent streams can sample the same profile by chance; they are not guaranteed to contain disjoint outcomes. The manifest does not prove that a user selected finalists without inspecting prior evaluation runs. Banks and finalists must be frozen before a claimed untouched assessment. The `untouched_finalist_evaluation_verified` capability therefore remains false.

Hard input limits are 8 MiB finite JSON, 16 games, 64 profiles per game, 160 participants per profile, 512 events per profile and 750 frozen pool players. A review accepts 150 distinct complete lineups and 16–1,024 draws. Unsupported controls/fields, scoring versions, identities, sources, coverage, event kinds or chronology reject the whole request. The raw supplied ledger is a declaration of completeness; unsupported laterals and multiple possession changes do not receive an approximate score.

## Actual 2024 chronological count diagnostic

The offline evaluation reuses the publicly downloaded [nflverse 2024 PBP release](https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2024.parquet). It contains 49,492 rows and 20,597,560 bytes; SHA-256 is `3fd2896bc0b911b615142d2f1fabae54a4bbba5ab7b73b28187b118ef8af6a3b`. Attribution is nflverse/nflfastR under the provider's [CC BY 4.0 license](https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md). The actual local read was `2026-10-12T17:38:42.920632+00:00`; historical publication and known-at are unknown. The original file was read without modification. Raw data and full predictions stay in local, uncommitted `outputs/`.

This is a **generic team-count profile diagnostic**, not player fantasy-point or DST calibration. The existing accepted-play adapter excludes no-plays, kneels, spikes and two-point tries and includes overtime. Its 47,274 regular-season rows produce 33,335 accepted plays, including 174 overtime plays. Both exact game sides and all count partitions reconcile. The source's `pass_attempt` includes sacks; the adapter separates sacks, scrambles and actual thrown attempts using the [official field dictionary](https://raw.githubusercontent.com/nflverse/nflreadr/main/data-raw/dictionary_pbp.csv). It does not infer routes, positions, roster membership, weather or availability.

An empirical profile retains the entire recorded home/away pair for five count features: plays, dropbacks, targeted throws, carries and sacks. Before each target week, the history contains only earlier weeks with completed event-time bounds and no later declared known-at. First/last recorded event timestamps bound this study; they are not platform lock, official kickoff/finalization or provider publication times.

The declared history choices were all prior weeks (`0`), the prior four weeks and the prior eight weeks. Weeks 4–9 supplied the tuning block; exact empirical CRPS, averaged across five count features and both sides, selected the window. All-history and eight-week choices tie at 3.708298 in that early block, where their histories coincide; the declared tie policy chooses eight weeks. This is not evidence that eight weeks is superior to all history. The choice was frozen before weeks 10–18, then each later week used only its own preceding history. Later outcomes cannot change selection or earlier forecasts in regression tests.

The untouched later block contains **134 games, 268 team-games and nine week blocks**. Inclusive empirical P10–P90 coverage has an 80% nominal interval, with discrete-count effects; it is not a claim of player fantasy-score calibration.

| Count | Mean MAE | Exact empirical CRPS | P10–P90 coverage | Observed zero fraction | Predicted zero fraction |
|---|---:|---:|---:|---:|---:|
| Plays | 6.633594 | 4.728821 | 79.4776% | 0% | 0% |
| Dropbacks | 6.136123 | 4.492606 | 82.4627% | 0% | 0% |
| Targeted throws | 5.588305 | 4.068455 | 82.4627% | 0% | 0% |
| Carries | 6.280440 | 4.327863 | 77.6119% | 0% | 0% |
| Sacks | 1.439631 | 0.981253 | 92.1642% | 15.6716% | 13.3625% |

The independent-side ablation preserves each marginal exactly and replaces the joint tail probability with the product of its two marginal tail frequencies. This is the exact limiting independent resampling calculation, without finite-sample shuffling noise. The joint event is both game sides **strictly exceeding** their own earlier-history empirical P90. Paired-minus-independent Brier is negative when paired profiles perform better. The bootstrap samples whole later weeks 2,000 times and preserves all games inside each week.

| Count | Later home/away covariance | Mean paired-profile covariance | Paired-minus-independent tail Brier | Week-block 95% interval |
|---|---:|---:|---:|---:|
| Plays | -36.540432 | -35.710922 | -0.0000857034 | [-0.0000984806, -0.0000758299] |
| Dropbacks | -5.908777 | -15.606950 | -0.0000945863 | [-0.0001048393, -0.0000857383] |
| Targeted throws | -0.209011 | -8.112336 | -0.0000495285 | [-0.0000827494, -0.0000002241] |
| Carries | -27.553910 | -25.216676 | -0.0000418027 | [-0.0000674471, -0.0000145628] |
| Sacks | -0.746826 | -0.368128 | +0.0000434593 | [+0.0000241535, +0.0000610179] |

Independent-side predicted covariance is zero by construction. Retaining whole games captures dependence that independent sides remove, but its calibration varies: the sack-tail ablation is worse. Four features have zero observed joint upper-tail events in only 134 games; targeted throws have one. Narrow conditional week-bootstrap intervals do not establish that those rare-event probabilities are zero, accurately estimated in future seasons or useful for tournament outcomes. This run supports **no model promotion or validated edge claim**.

## Engineering verification and reproducibility

Synthetic tests exercise exact shared-event scoring, selected/unselected and residual actors, negative outcomes, inactive/limited/zero-touch profiles, immutable bank copies, common paired draws, separate purpose streams, incorrect context/scoring/rights/status/coverage rejection and invalid finalist rosters. Synthetic outcomes are labeled as fixtures and do not stand in for historical calibration.

The local maximum-draw engineering fixture has 750 players across 16 games/32 teams, 48 declared profiles, 192 events and 150 distinct complete rosters, evaluated on 1,024 draws (16,384 game-profile selections). It is explicitly synthetic and does not represent a real NFL slate. Its input is 314,506 compact JSON bytes; it stresses the pool/portfolio/draw limits, not the maximum possible event-ledger size.

The current development receipt records nine local runs on Windows, AMD64 Family 25 Model 33 Stepping 2 and Python 3.11.13. Combined preparation/evaluation measured **p50 1.147244 seconds and p95 1.215088 seconds**. A separate `tracemalloc` run measured **18,194,266 peak Python-allocated bytes**. The raw synthetic bank SHA-256 is `0f89ecf61d98e42d3a84cb5db916db9e7f3de1c449e0a8f67749fe9982541a83`. Every benchmark roster passes the two-game gate. The runner retains individual preparation/evaluation times as well as combined percentiles. Python allocation measurements do not cover process RSS, native allocations or worker concurrency. These are local observations, not a hosted latency guarantee.

Run with the existing environment and a supplied local public file:

```powershell
$env:PYTHONPATH='.'
.venv\Scripts\python.exe -m src.analytics.dfs_shared_outcomes_eval `
  --pbp outputs/phase4-public-evaluation/play_by_play_2024.parquet `
  --output outputs/phase5-public-evaluation/count_profiles_2024.json --season 2024

.venv\Scripts\python.exe -m pytest tests/test_dfs_event_scoring.py `
  tests/test_dfs_shared_outcomes.py tests/test_dfs_shared_outcomes_eval.py `
  -q --basetemp outputs/pytest-phase5-joint-final

.venv\Scripts\python.exe scripts/dev/verify_dfs_shared_outcomes.py --benchmark --runs 9
```

The final scorer/bank/evaluator invocation passed **135 tests in 7.16 seconds** after correcting the two-game roster gate, its synthetic fixtures and UTC-offset as-of comparison. An additional nonzero full-lineup paired-delta case passed separately in 2.52 seconds; it verifies that replacing a scoring receiver with an explicit zero-touch alternative loses exactly that receiver's mean on the same draws. The development runner writes an explicit synthetic input, actual replay summaries, separate purpose manifests and measured benchmark metadata to `outputs/dfs-shared-outcomes-engine/`. Subsequent broader checks and the current-revision receipt are recorded in the phase review. The historical evaluator reads supplied bytes and writes a local report; it does not download, fit, promote or change any production artifact.

Remaining release gates are multiple untouched later seasons, retained pre-lock sources and actual rights verification, reconstructed active/limited/inactive rosters, complete supported historical scoring coverage, conditional role/injury/weather forecasts, player fantasy-point marginal/zero/quantile calibration, lineup and specialist joint-tail calibration, and evidence that generation/selection choices did not inspect final evaluation results. Ownership, legal fields, payout/ties, portfolio returns and late swap remain the later phases. Every corresponding readiness flag stays false in this research tool.
