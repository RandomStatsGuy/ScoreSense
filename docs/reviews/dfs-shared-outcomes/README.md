# Shared football outcomes and scoring review

Phase-5 draft, starting from merged phase-4 `develop` baseline `522267b6339892656ad193ccca9cceebe30bf687`. The supplied specification remains unchanged. The implementation tracker and JSON registry retain all 65 rule IDs and 36 acceptance IDs.

This phase adds an explicitly declared scenario research layer. Engineering conservation and deterministic replay do not establish calibrated probabilities, a player-role model, tournament returns or platform acceptance. Existing forecasts, default projection-guided builds and saved lineup history remain separate.

## Frozen baseline inventory

- The existing DFS pool reads materialized weekly skill forecasts and independent DST quantile heads. Its stored specialist gate passed for DST and failed for kickers; kicker estimates remain labeled historical estimates. These existing marginal outputs do not establish a shared offense/defense outcome distribution.
- `season_quantiles.py` models player-week season totals using a two-piece-normal approximation and shared latent shocks. That season aggregation is not a coherent Classic event ledger and is not reused as a validated football simulator.
- `hub_scoring.py` serves configurable Fantasy league scoring. Phase 5 must keep site-specific DFS scoring separate from league state and preserve the existing scoring host.
- Phase 4 already freezes player/control/evidence inputs, validates complete-roster comparisons and exposes source rights and declared known-at. No shared-event bank, joint calibration artifact or independent generation/selection/evaluation draw contract existed at this frozen base.
- Current pre-lock event/roster availability archives, permitted route/coverage feeds and validated personnel-scenario probabilities remain unavailable. Unknown inputs must remain explicit rather than being inferred from P10/P50/P90.

## Actual verification

| Check | Result |
|---|---|
| Frozen DFS/lineup/Vegas Python baseline | 444 passed, one existing Starlette deprecation warning, 81.68 s |
| Frozen explicitly enumerated frontend baseline | 1,174 total: 1,171 passed / 3 failed, 23.871 s |
| Frozen product/living-surface policy baseline | 36 passed, 4.42 s |
| Final affected DFS/lineup/Vegas Python regression, including the new API and engines | 672 passed, one existing Starlette deprecation warning, 79.53 s |
| Final research API tests | 94 passed, one existing Starlette deprecation warning, 8.98 s |
| Final scoring, shared scenarios, count evaluation and policy checks after the last test additions | 172 passed, 6.20 s |
| Real-engine synthetic conservation/replay pipeline | Exit 0; 2 complete legal lineups, 256 draws, 0.0082925 s |
| Synthetic maximum pool/portfolio/draw benchmark, 9 runs | p50 1.147244 s / p95 1.215088 s; separate instrumented Python heap peak 18,194,266 bytes |

The three frontend failures are the existing contract-label, accuracy-null-copy and My team banner expectations. They reproduce before this phase's source changes. The package's directory-based frontend test launcher is incompatible with this Windows Node environment; explicit file enumeration runs the actual test modules instead.

The broad regression collected before the last two count-evaluation/scenario test additions. The final 172-test check above includes those additions and all 36 policy tests; it is a separate completed run, not an invented larger broad-suite count. No fresh whole-repository Python run is claimed. No production frontend source changed, so the frozen frontend result remains the recorded frontend baseline, not a new production browser gate.

## Implemented contract

The pure [DraftKings Classic scorer](../DFS_CLASSIC_SCORING_CONTRACT.md) derives offensive and opposing DST outcomes from the same explicitly supplied game events. Supported bonuses, deductions, points-allowed bands, explicit inactivity and residual actors retain coherent counts. Current official rules have an actual retrieval receipt and content hashes. Unsupported rare event patterns reject rather than being approximated. A caller's `ledger_complete` declaration does not prove real-source completeness; this is not a raw provider-play normalizer.

The scenario engine validates whole-game profiles and freezes their pool, scoring, event and source identities in an immutable content ID. All finalists share each sampled game profile. Empirical lineup P10/P50/P90 come from complete lineup totals; zero and negative outcomes remain present. Separate generation/selection/evaluation random streams are reproducible, but their manifests cannot prove that earlier evaluation results were unseen. Classic finalists require nine unique eligible players, legal positions/FLEX, salary at most $50,000 and at least two different games.

The read-only `POST /api/lineup/shared-outcomes/preview` and `/evaluate` routes require patron authentication before reading the body. Actual streamed bytes are limited to 8 MiB even with missing or dishonest Content-Length. Parsing rejects duplicate JSON fields, nonfinite values, excessive depth/value counts and unsupported fields. Pool, finalist, salary, draw and identity bounds are strict. Existing global CPU workers execute preparation/evaluation. Preview returns compact receipts, counts and capabilities without raw event ledgers, player scores or the frozen pool. Evaluation revalidates the submitted bank, requires the selected content ID and echoes the input snapshot ID. It does not write accounts, builds, entries or live lineups.

The [actual 2024 count-profile diagnostic](../DFS_SHARED_OUTCOMES_EVALUATION.md) is distinct from synthetic engineering verification. It uses chronological tuning and a withheld later block, reports empirical count-distribution scores and paired-versus-independent game-tail comparisons with week-block uncertainty, and records sparse-tail and provenance limitations. The shared sack-tail comparison worsened. These mixed results support no model promotion or claim of calibrated player/DST/lineup fantasy distributions.

## Reproduction and measured scope

Run from the repository root with `PYTHONPATH=.` and the existing Python environment:

```powershell
python -m pytest tests/test_dfs_event_scoring.py tests/test_dfs_shared_outcomes.py tests/test_dfs_shared_outcomes_eval.py tests/test_dfs_shared_outcomes_api.py -q
python scripts/dev/verify_dfs_shared_outcomes.py --benchmark --runs 9
```

The broad affected-suite file selection was `rg --files tests` filtered for `test_dfs*.py`, `test_lineup_optimizer*.py` and `test_vegas_lines.py`. Policy checks are `tests/test_living_surfaces.py` and `tests/test_product_constitution.py`. Actual local logs are `outputs/dfs-phase5-python-final.log`, `outputs/dfs-phase5-api-release.log`, `outputs/dfs-phase5-policy-release.log` and `outputs/dfs-phase5-engine-final.log`.

The compact [synthetic engine receipt](engine-verification.json) records the actual bank/stream hashes, counts, capabilities and measurements. Its normal input has 2 games, 4 profiles, 8 events, 10 pool players and 15 unique actors. The benchmark has 750 pool players, 150 legal lineups, 1,024 draws, 16 games and 48 profiles with four events each. Its compact raw bank is 314,506 bytes. This stresses the pool/portfolio/draw caps, not the maximum byte/event bank or a plausible NFL slate. Timing was measured locally on Windows/Python 3.11.13/AMD64 with other verification activity; it is not a hosted latency promise. The separate tracemalloc run covers Python allocations, not process RSS or all native memory.

## Remaining gates and design review

The user requested simpler, denser controls during this phase. [A/B/C workflow mockups](../../mockups/dfs-flow.html) provide concrete alternatives and their [separate mock review](../../mockups/dfs-flow-review/README.md) records static layout/interaction evidence. A mock is not a production implementation. Production React/CSS and existing Generate/Review/Export/Recovery flows are unchanged; no newly accepted production redesign or current end-to-end browser certification is claimed here.

Remaining phase-5 gates include independently complete permitted event/availability sources, validated conditional roles and personnel probabilities, calibrated player and specialist marginals, joint/whole-lineup tails, multi-season pre-lock data, untouched finalist evaluation and a measured production integration. Purpose-separated seeds and passing conservation do not satisfy those statistical gates. Contest field/ownership, exact payout/EV, portfolio risk objectives and accepted-entry late swap remain later gated phases 6–8. Original incident artifacts and platform accepted-entry readback remain absent.

No servers, live accounts, providers, submissions or lineup changes were used by these backend tests. Raw fixture reports, downloads, logs and temporary build files stay uncommitted under local `outputs/`. The supplied specification remains byte-identical, and all 65 rules / 36 acceptance cases remain in the synchronized tracker and JSON registry.
