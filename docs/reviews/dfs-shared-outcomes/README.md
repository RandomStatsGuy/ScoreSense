# Shared football outcomes and scoring review

Phase-5 draft, starting from merged phase-4 `develop` baseline `522267b6339892656ad193ccca9cceebe30bf687`. The supplied specification remains unchanged. The implementation tracker and JSON registry retain all 65 rule IDs and 36 acceptance IDs.

This phase adds an explicitly declared scenario research layer. Engineering conservation and deterministic replay do not establish calibrated probabilities, a player-role model, tournament returns or platform acceptance. Existing forecasts, default projection-guided builds and saved lineup history remain separate.

## Frozen baseline inventory

- The existing DFS pool reads materialized weekly skill forecasts and independent DST quantile heads. Its stored specialist gate passed for DST and failed for kickers; kicker estimates remain labeled historical estimates. These existing marginal outputs do not establish a shared offense/defense outcome distribution.
- `season_quantiles.py` models player-week season totals using a two-piece-normal approximation and shared latent shocks. That season aggregation is not a coherent Classic event ledger and is not reused as a validated football simulator.
- `hub_scoring.py` serves configurable Fantasy league scoring. Phase 5 must keep site-specific DFS scoring separate from league state and preserve the existing scoring host.
- Phase 4 already freezes player/control/evidence inputs, validates complete-roster comparisons and exposes source rights and declared known-at. No shared-event bank, joint calibration artifact or independent generation/selection/evaluation draw contract existed at this frozen base.
- Current pre-lock event/roster availability archives, permitted route/coverage feeds and validated personnel-scenario probabilities remain unavailable. Unknown inputs must remain explicit rather than being inferred from P10/P50/P90.

## Guided-workflow verification at `56189185`

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
| Final production frontend, explicit module enumeration plus layout audit tests | 1,191 total: 1,188 passed / the same 3 baseline failures, 20.703 s |
| Final scoped DFS/frontend tests | 242 passed, 17.519 s |
| Final production build | Passed, 10.11 s; existing >500 kB chunk warning |
| Final product/living-surface policy after guided UI | 36 passed, 3.23 s |
| Consolidated isolated production browser run | Exit 0: 10 guided + 10 scenario size/theme cases, two 150-entry cases and six advanced/research/safety supplements |

The three frontend failures are the existing contract-label, accuracy-null-copy and My team banner expectations. They reproduce before this phase's source changes. The package's directory-based frontend test launcher is incompatible with this Windows Node environment; explicit file enumeration runs the actual test modules instead.

The broad regression collected before the last two count-evaluation/scenario test additions. The final 172-test check above includes those additions and all 36 policy tests; it is a separate completed run, not an invented larger broad-suite count. No fresh whole-repository Python run is claimed. The final approved production UI was subsequently checked by the frontend/build/policy/browser gates below. The recorded broad backend count is not enlarged by those later checks.

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
python scripts/dev/build_dfs_shared_browser_fixture.py
node scripts/dev/dfs_flow_tasks.mjs
```

The browser run uses existing Playwright/browser dependencies and no application server. On this Windows sandbox, local browser downloads and Vite dependency resolution required the approved local execution path; default sandbox attempts failed on download/realpath access without a product error. Policy fixture setup similarly needed workspace `--basetemp`; the successful final 36-test run used it. The initial browser harness was adapted to the approved labels/disclosures and corrected its synthetic unrelated-entry ID before the consolidated clean run.

Final frontend/build/browser logs are `outputs/dfs-phase5-frontend-final.log`, `outputs/dfs-phase5-frontend-dfs-final.log`, `outputs/dfs-phase5-build-final.log`, `outputs/guided-policy.log` and `outputs/dfs-flow-production-final.log`.

The broad affected-suite file selection was `rg --files tests` filtered for `test_dfs*.py`, `test_lineup_optimizer*.py` and `test_vegas_lines.py`. Policy checks are `tests/test_living_surfaces.py` and `tests/test_product_constitution.py`. Actual local logs are `outputs/dfs-phase5-python-final.log`, `outputs/dfs-phase5-api-release.log`, `outputs/dfs-phase5-policy-release.log` and `outputs/dfs-phase5-engine-final.log`.

The compact [synthetic engine receipt](engine-verification.json) records the actual bank/stream hashes, counts, capabilities and measurements. Its normal input has 2 games, 4 profiles, 8 events, 10 pool players and 15 unique actors. The benchmark has 750 pool players, 150 legal lineups, 1,024 draws, 16 games and 48 profiles with four events each. Its compact raw bank is 314,506 bytes. This stresses the pool/portfolio/draw caps, not the maximum byte/event bank or a plausible NFL slate. Timing was measured locally on Windows/Python 3.11.13/AMD64 with other verification activity; it is not a hosted latency promise. The separate tracemalloc run covers Python allocations, not process RSS or all native memory.

## Approved guided production workflow

The user chose A from [concrete workflow alternatives](../../mockups/dfs-flow.html); their [separate mock review](../../mockups/dfs-flow-review/README.md) remains prototype evidence. Production now follows Build → Review → Download. The count, scoring goal and primary action lead; optional player choices, advanced rules, research and recovery start closed. The matchup rail remains compact. **Save this set** explicitly collects a current build; navigating to Review is read-only and current-build backup also works directly. This supersedes PR3's automatic first-build collection.

The optional Shared-game scenarios panel reads bounded JSON in a real worker, checks declared personal-analysis/host/display rights and exact pool game/kickoff identity before upload, previews receipts and requires explicit selection. Current-build and collection review share full-game draws without rewriting saved inputs. Results display supplied-draw P10/P50/P90 and paired differences, including zero and negative outcomes, with calibration limitations and source/scoring details. Personal-review downloads include computed empirical summaries and source-right receipts, omit raw bank/events/observations, and make no redistribution permission claim.

The [consolidated production browser receipt](browser-verification.json) records 10 guided cases and 10 scenario cases across 390/768/1280/1440/320 in actual DOM-asserted dark/light themes. Build, expanded Advanced rules, Review, Download and scenario states pass the repository geometry checks without page overflow. Both normal 150-entry cases preserve the exact CSV seal, unrelated reservations and worker-based reload recovery. Further phone/desktop tasks exercise collection bounds, selected replacement preview/cancel/accept/undo, versioned input keep/apply/undo, Captain comparison and the prior real-engine evidence comparison. Failure supplements cover build cancellation/late results, failed builds/salary imports, fresh export authorization, optional history failure and shared rights/schema/kickoff/failure/mismatch/cancel/stale/account reset.

The shared fixture is generated by the actual scoring/scenario engine from explicitly synthetic two-game ledgers. Every preview/evaluation request matches its context, pool, raw bank, legal finalists and default seed 0/draw count 256 before the fixture returns that engine output. Its second lineup's paired mean difference is -3.703125; that demonstrates plumbing, not model performance. All APIs are intercepted inside an isolated bundled production fixture. No running application, live account, provider, entry upload or accepted-entry readback was exercised.

| Inspected synthetic production view | Phone | Desktop |
|---|---|---|
| Default Build | [390 dark](build-390-dark.png) | [1280 light](build-1280-light.png) |
| Review / Download | [Review 390 dark](review-390-dark.png) | [Download 1280 light](download-1280-light.png) |
| Explicit shared-scenario review | [390 light](shared-390-light.png) | [1280 dark](shared-1280-dark.png) |

The parent reviewer inspected the final production captures, including light-theme action contrast and compact phone layout. These screenshots show real components with synthetic inputs, not the earlier HTML mocks.

### Build-settings spacing correction

The count, scoring goal and Build action now share a desktop row with matching 44px controls and labels above the fields. Helper text sits below the row. A container query stacks the controls when the actual card gets narrow, including beside the game rail. This reuses the existing field-style menu rather than changing other filters.

The [spacing receipt](spacing-verification.json) records passing Build, longest-goal and expanded-Advanced geometry checks at 320, 390, 768, 900, 950, 1024 and 1280 in both themes (14 cases). The new generic `control-rows` audit catches unequal heights and misaligned bottom edges while allowing phone stacks; its 25 tests passed. The existing 390 dark Build/Review/Download, sealed-CSV and worker-recovery smoke passed, and the production build passed in 7.30s with the existing bundle warning. These are the fresh correction checks; the broader frontend/backend and 20-case workflow results above belong to `56189185` and were not rerun for this layout change. The Build captures above are refreshed; [the desktop card](settings-1280-light.png) shows the corrected spacing.

Reproduce the geometry regressions with `node --test scripts/dev/layout_audit.test.mjs` and the established workflow smoke with `node scripts/dev/dfs_flow_tasks.mjs --smoke`. No live account or unrelated Fantasy/Projections page was checked.

Remaining phase-5 gates include independently complete permitted event/availability sources, validated conditional roles and personnel probabilities, calibrated player and specialist marginals, joint/whole-lineup tails, multi-season pre-lock data, untouched finalist evaluation and real-account/permitted-provider integration. Purpose-separated seeds and passing conservation do not satisfy those statistical gates. Contest field/ownership, exact payout/EV, portfolio risk objectives and accepted-entry late swap remain later gated phases 6–8. Original incident artifacts and platform accepted-entry readback remain absent.

No servers, live accounts, providers, submissions or live-lineup changes were used by these checks. Curated compact receipts and six synthetic screenshots are attached here; raw fixture reports, downloads, logs and temporary build files stay uncommitted under local `outputs/`. The supplied specification remains byte-identical, and all 65 rules / 36 acceptance cases remain in the synchronized tracker and JSON registry.
