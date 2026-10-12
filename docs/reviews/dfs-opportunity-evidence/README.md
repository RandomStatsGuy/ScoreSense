# Opportunity evidence and complete Classic alternatives

Phase-4 draft, starting from `develop` baseline `ddcbe804`. The supplied specification remains unchanged; all 65 rule IDs and 36 acceptance IDs remain in the [implementation tracker](../../DFS_REBUILD_IMPLEMENTATION.md) and [JSON registry](../../DFS_REBUILD_RULE_MATRIX.json). This review covers historical diagnostic evidence and projection-input comparisons. It does not promote a fitted forecast, role model or tournament objective.

## Delivered scope

- The existing matchup rail opens bounded Games, Player observations, Complete-lineup comparisons and Sources disclosures. Both eligible game sides remain inspectable; primary QB focus does not remove complementary players from other games.
- Source receipts preserve raw content hashes, period, count definition, filters, publication/retrieval/known-at and separate rights. Declared later/incompatible observations are excluded. Unknown historical publication is explicitly retrospective; a hash is neither source authentication nor permission.
- The inherited unfitted screen uses exactly 75% season and 25% relevant venue plays for/against, then averages the team's offense with the opponent's defense. Team and combined screens show sample counts, observed dates, alternatives and explicit missing-venue season fallback. Rough dropbacks use each team's compatible observed rate.
- Historical target/carry shares use full-offense counts from matching observations. Duplicate receiving-grade and route headers require explicit column identity. Routes/player passing snaps and routes/team dropbacks remain distinct. Missing routes, coverage, goal-line roles and DST distributions remain unavailable.
- Explicit selection freezes one pool/control/evidence snapshot for bounded legal nine-player primary/challenger comparisons and existing collection input sums. Reviews show actual attachment/opposing counts, multiple completions, salary, summed objectives and strongest evaluated excluded alternative. Original saved forecasts remain unchanged.
- Refresh, cancellation, new evidence, account/context/control changes and mismatched response IDs preserve or invalidate review state explicitly. Client cancellation stops waiting; server work may finish its bounded request. Portable downloads retain pool/controls and evidence receipts/references, omitting raw and derived source observation ledgers.

The [actual 2024 chronological retrospective](../DFS_OPPORTUNITY_2024_RETROSPECTIVE.md) is separate from the synthetic engineering checks below. It records the public source/hash, earlier tuning, untouched later block, paired week-block uncertainty and limitations. Its earlier-selected pooled alternative did not outperform the inherited screen in the later block; no venue upgrade or production forecast change is promoted.

## Actual verification

| Check | Result |
|---|---|
| Frozen relevant Python baseline | 44 passed, 15.46 s |
| Frozen relevant frontend baseline | 39 passed, 259.534 ms |
| Broad frontend failures on exact base `ddcbe804` | 33 passed / 3 failed, 175.169 ms; same contract-label, accuracy-null-copy and My team banner expectations |
| Synthetic real-engine evidence/comparison pipeline | 36 candidates, 30 feasible, 96 solves; default three completions; first and additional searches complete; 1.188 s comparison / 2.609 s total |
| Production evidence browser task/layout gate | Exit 0; 390/768/1280/1440, actual asserted dark/light themes; eight cases, no browser errors |
| Failure and race supplements | Exit 0; eight checks: last-good evidence, failed comparison, mismatched IDs, cancellation, missing-to-available explicit selection, control/slate/account late-response guards |
| Affected DFS/backend regression suite | 442 passed, 1 warning, 75.43 s; no fresh whole-repository claim |
| Explicitly enumerated full frontend suite | 1,174 tests: 1,171 passed / 3 confirmed baseline failures, 19.077 s |
| Final evidence helper integration | 48 passed, 5.71 s across opportunity/comparison/evaluation modules |
| Final API gate | 24 passed, 1 warning, 3.25 s |
| Product/living-surface policy tests | 36 passed, 3.77 s |
| Final production build | Passed, 9.14 s; existing main-chunk warning above 500 kB remains |
| Preserved foundation browser gate | Exit 0: eight size/theme cases plus two authorization/account-race checks |
| Preserved guardrails browser gate | Exit 0: eight pair/core/stack/plan size/theme cases |
| Preserved portfolio/recovery browser gate | Exit 0: 390/1280, 150-entry export/identical restore, unrelated row and exact CSV hash |
| Compact worker stress | Exit 0: 140 lineups/700 players at 390/1280, 12,389,150 to 1,085,295 bytes, exact restore/no regeneration/no browser errors |
| Preserved integrated workflow default gate | Exit 0: eight size/theme cases, seven polling/file/account supplements, and direct150 at 390 dark/1280 light |

All preserved browser gates above completed with exit 0. The direct 150 path generates once, auto-collects one 150-lineup batch, reviews/assigns 150 entries, seals the exact CSV, preserves an unrelated entry and reloads/restores without regeneration.

The synthetic pipeline runs the real source/artifact helpers and real solver, audits nine-player completions and preserves original results during common-pool reevaluation. The browser strictly compares every frozen request player input, numeric value, control, native rule and QB scope with the real-engine inputs, then replays a documented projection of that report through production components; it does not execute the HTTP server or measure production optimizer runtime. The committed fixture omits duplicated candidate results/audits; full reports and generated source bytes stay in local `outputs/`.

The synthetic arithmetic example is BUF 66.25 plays plus KC 67.5 = 133.75 combined, displayed to one decimal. Distinct team rates produce different rough dropback screens. A different game lacks venue observations; another lacks one side's historical coverage and retains a null combined screen. A receiver without routes stays unavailable. A separate explicitly synthetic duplicate-RECV report produces grade 88.2, 100 routes, 80% of player passing snaps and 66.7% of team dropbacks; these are fixture counts, not player/model claims.

Earlier harness runs needed disclosure/menu matching and batch-response shape corrections. Strict request equality also corrected the synthetic receiving-RB/default-completion assumptions before the final gate; no mismatched solver replay is accepted. Visual review found the new script initially used the wrong theme storage key; corrected final runs assert the rendered theme before accepting a case. An actual phone defect in new pager targets (33 px versus required 44 px) was fixed and rechecked. None of those earlier runs is represented as the final passing gate.

## Reproduce

From the isolated checkout, with `PYTHONPATH=.` and the existing repository environment:

```powershell
$env:PYTHONPATH='.'
& 'C:/Users/Caelp/Desktop/Git Projects/ScoreSense/.venv/Scripts/python.exe' `
  scripts/dev/verify_dfs_evidence.py --write-browser-fixture
node scripts/dev/dfs_evidence_tasks.mjs
node scripts/dev/dfs_rebuild_browser.mjs
node scripts/dev/dfs_rebuild_browser.mjs --guardrails-only
node scripts/dev/dfs_portfolio_browser.mjs
node scripts/dev/dfs_workflow_tasks.mjs
```

Browser checks bundle production code and fulfill only isolated local fixture URLs. They do not start another server, call providers/live APIs, submit entries or modify accounts. Compact results: [responsive/theme checks](responsive-results.json) and [synthetic engine checks](synthetic-engine-results.json). Full logs, downloads, raw fixture source and reports stay uncommitted under `outputs/`: `dfs-phase4-python-final.log`, `dfs-phase4-frontend-final.log`, `dfs-phase4-evidence-api-release.log`, `dfs-phase4-evidence-engine-final.log`, `dfs-phase4-evidence-browser-final.log`, `dfs-phase4-foundation-browser.log`, `dfs-phase4-guardrails-browser.log`, `dfs-phase4-portfolio-browser.log`, `dfs-phase4-workflow-browser.log` and `dfs-phase4-build-final.log`.

A broader earlier Python run hit missing `frontend/dist/assets` while the concurrent initial build replaced output; the rerun after the build passed 442 tests. Two unrelated Sleeper-dependent tests failed DNS resolution on both current code and the exact frozen `ddcbe804` archive (2 failed / 34 deselected, 20.18 s for the frozen check). The latter result was observed in tool output, without a separately persisted log; it is not represented as a passing network integration. The package's directory-based `npm test` launcher also failed on this Windows Node runtime; explicit test-file enumeration produced the full frontend result above.

The backup stress retained a visible busy state with 66 animation frames at 1280 and 47 at 390; download round trips were 1296 ms and 944 ms respectively. These are observed synthetic browser/file workflow timings, not production performance benchmarks.

## Scoped visual evidence

All attached inputs and names are explicitly synthetic. These component captures show actual light/dark themes, not filename-only assertions. The parent reviewer inspected and accepted the final captures, including actual light colors and all three complete rosters after exact-request replay correction.

| View | Phone | Desktop |
|---|---|---|
| Team-volume ledger | [390 dark](game-390-dark.png) | [1280 light](game-1280-light.png) |
| Historical player observations / missing routes | [390 light](player-390-light.png) | [1280 dark](player-1280-dark.png) |
| Complete roster alternatives | [390 light](comparison-390-light.png) | [1280 dark](comparison-1280-dark.png) |

## Remaining gates

Original incident inputs, original paid exports and accepted-entry readback were not supplied. No real proprietary routes/coverage feed or historical live availability archive is certified. The public count/role study is one retrospective season with an observed-touch cohort, not reconstructed active rosters or a live decision-time backtest. Broad forward roles, injuries, redistribution, goal-line/DST outcomes, multi-season additive-feature evidence and calibrated game/script forecasts remain pending.

Common-input sums do not establish common joint scenarios, lineup quantiles, win probabilities or expected payouts. Candidate search is bounded and disclosed, not an exhaustive global proof. Shared outcomes, contest-conditioned legal field/ownership, exact payouts, joint portfolio objectives and exact accepted-slot late swap remain phases 5–8. Existing compact recovery retains 20 MiB encoded input / 64 MiB expanded / 2 million values / depth 24 limits; unusually many full-pool replacement histories can still exceed capacity. No merge, deploy, data purchase, entry submission or live-lineup change was performed.
