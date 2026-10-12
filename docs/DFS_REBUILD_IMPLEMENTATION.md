# DFS optimizer rebuild: implementation and remaining work

This tracks the complete [v0.2.0 specification](ScoreSense_DFS_Optimizer_Rebuild_Spec_v0.2.0.md), not only the first PR. Inventory baseline: `develop` commit `45694c9355cbd6559da79ef688c4a62e5b94283d`, October 11, 2026. The source was copied byte-for-byte from the supplied file; SHA-256: `A0CD7F50EED4F3A45D0158F587C2D00C1003C1B5425845A9BCFE9AA693FCA96C`.

`PRODUCT.md` governs appearance. Keep the existing DFS layout and single-game behavior. This project does not authorize merge, deployment, data purchase, entry submission or live-lineup changes. Projection sums remain supported; no validated tournament edge, expected profit or joint probability is claimed.

## Original baseline inventory and confirmed gaps

| Area | Already present at baseline | Remaining / PR1 work |
|---|---|---|
| Generator | `lineup_optimizer.py`: Classic/Captain roster constraints, locks/skips, salary, stacks, overlap, batch maximum exposure, random seed | Batch exposure uses sequential exhaustion with explicit lock exemptions. PR1 adds opt-in bounded candidate generation plus global selection with hard minimum/maximum and soft target; legacy remains default. |
| Independent validation | `dfs_validation.py`, `dfs_slate_snapshots.py`: roster, salary, identity and retained account catalog checks | Exact scoring/game/current-lock contracts and full strategy audit remain; no site-acceptance certification. |
| Portfolio | `dfsPortfolio.js`: detached batches, original catalogs/settings, actual player/QB appearances, canonical duplicates, export-only maxima | Native controls, pair/core/structure audit and replacement preview are not completed by collecting batches. |
| Recovery | `dfsPortfolioBackup.js`: bounded versioned JSON, atomic restore, replacement confirmation, assignment/save-ID reset | PR1 adds a clearly scoped browser draft. Backup stays bounded version 1; compact shared references remain explicit follow-up work. |
| Export | `dfsExport.js`, `dfsEntryExport.js`: distinct library/entry CSV paths, catalog checks, metadata retention | Confirmed code coupling: workspace awaits saved batches and result-ledger writes before downloading. PR1 separates pure conversion from authorized optional history sync. Historical user failure was not reproduced from its original source files. |
| Results/provenance | `dfs_results.py`, `DfsResults.jsx`: account entry keys, saved build links, unknown finance, bounded import/pagination | Platform acceptance/readback, full export lifecycle/version diffs and contest-aware prospective evaluation remain. |
| Evidence/model | Saved weekly pool, coverage/source/freshness labels, Vegas movement, imported estimates | Proposed pace/role ledger, joint outcomes, legal field, exact contest payout engine and forward evaluation are not integrated. |
| Design/testing | Approved compact production workspace, paginated pool, existing production fixtures/layout audit | Every new control needs responsive/theme/keyboard/task evidence. A passing build is insufficient. |

Open draft [PR #700](https://github.com/RandomStatsGuy/ScoreSense/pull/700) overlaps the legacy collection workflow by calculating per-batch maximum allowances from already-used appearances. That is not a native global minimum/target/maximum selector. Do not describe it as satisfying PORT-05 or silently replace its work.

Original `scoresense-portfolio-rescue.json`, `incident_audit.json`, paid source exports and accepted-entry readback were not supplied with this implementation request. The 11 QB/DST, 114 TE-FLEX and 89 RB-pair observations are source-spec claims until separately reproducible with sanitized fixtures; no original incident or postgame outcome verification is claimed.

## Phased delivery

| Spec stage | Reviewable result | State / dependency |
|---|---|---|
| 0 | Inventory, frozen baseline, sanitized regressions | Inventory/baseline complete; original incident reproduction unavailable. |
| 1 | Reliable entry serializer, authorized local recovery, durable draft, actionable pending state | Scoped foundation in PR1; compact version-2 worker recovery verified in PR3. |
| 2 | Native global exposures, pair/core constraints, QB/DST guard, exact stacks, atomic plans | Foundation in PR1; PR2 adds pair/core UI, native exact semantics, independent audits and atomic plans. Final verification is recorded separately below. |
| 3 | Integrated progressive workflow, accumulated audit, explicit replacements/undo, capability/error states and versioned input updates | Implemented scope in third dependent draft; final verification recorded below. Role/statistical recommendations remain gated. |
| 4 | Provenance-aware opportunity/game evidence, inherited pace baseline and challenger comparisons | Scoped diagnostic implementation and chronological retrospective evaluation in PR4; no fitted forecast promotion. |
| 5 | Coherent shared outcomes, verified site scoring and specialist distributions | Gated pending conservation/calibration/evaluation-draw tests and measured runtime. |
| 6 | Contest-conditioned legal field, ownership sensitivity, exact payouts/ties | Gated pending permitted full-field/ownership archives and actual contest payout contracts. |
| 7 | Contest-aware joint portfolio evaluation and distinct risk/top-finish objectives | Gated pending untouched forward evaluation and comparable-budget baseline. |
| 8 | Accepted-entry late swap preserving exact started slots | Separately gated; verified accepted state/current locks and end-to-end tests required. |

No later stage is represented as delivered by PR1. Missing statistical/data dependencies must gate unsupported claims while independent engineering and design continue.

## Fourth PR: opportunity evidence and complete alternatives

This draft starts from merged phase-3 baseline `ddcbe804`. The existing matchup rail opens a compact full-width evidence section with bounded Games, Player observations, Complete-lineup comparisons and Sources disclosures. Historical observations retain source URI/hash/period/definition/rights and declared publication/retrieval/known-at. Source hashes identify bytes, not source authenticity or permission. Missing/incompatible evidence stays unavailable; raw/derived source observations are omitted from portable reviews, which retain source references and receipts.

The inherited screen is exactly 75% season plus 25% relevant venue plays for/against, followed by the team/opponent mean. Both team screens, combined values, sample counts, dates and season/venue/pooled alternatives are visible. Missing venue terms declare season fallback. Rough dropbacks use each team's compatible observed dropback rate, not neutral tempo or a calibrated forecast. Explicit duplicate receiving headers preserve grade versus routes and distinguish routes/player passing snaps from routes/team dropbacks. No routes are inferred from targets.

Comparison selection freezes one complete eligible player pool, current controls and chosen evidence version. Both quarterback sides and excluded-QB alternatives receive bounded legal complete-roster searches; off-focus complementary players remain available. The review shows requested/actual attachments and opposing players, multiple complete rosters, salary and summed input objective, strongest evaluated excluded challenger and unresolved statuses. Ordinary game weights and named scopes identify primary QBs without imposing a fixed game count. Existing collection projection sums can be reevaluated on the selected pool while original snapshots and forecasts remain unchanged. Cancellation stops waiting and discards late responses; server work may finish its bounded request. Input/account/context changes and mismatched response IDs invalidate incoming results.

The [actual 2024 chronological count/role study](reviews/DFS_OPPORTUNITY_2024_RETROSPECTIVE.md) is separate from synthetic engineering checks. It compares the inherited baseline with season/venue/pooled alternatives on an untouched later block and records uncertainty and unknown historical publication. The earlier-selected pooled alternative did not improve the inherited screen in that later block, so no fitted venue upgrade or production forecast adjustment is promoted. Historical observed-touch role evaluation does not establish active-player roles, route forecasts, injury/coverage adjustments or specialist distributions.

Final verification: affected backend **442 passed** (75.43 s); full enumerated frontend **1,171 passed / 3 confirmed baseline failures of 1,174** (19.077 s); source/comparison/evaluation integration **48 passed** (5.71 s); API **24 passed** (3.25 s); policy **36 passed** (3.77 s); production build **passed** (9.14 s), retaining the existing bundle warning. The exact-request synthetic real-engine pipeline resolved 36 alternatives with 30 feasible candidates and 96 solves (1.188 s comparison), using the API default three completions. The final actual-theme browser gate exited 0 across eight evidence cases and eight failure/race supplements. Foundation and guardrail eight-case gates, 390/1280 portfolio150/worker stress, and the default integrated workflow with seven supplements plus both direct150 cases also exited 0. These are scoped engineering checks; the earlier phase2 whole-suite result is not a current whole-repository claim.

[Phase-4 review evidence](reviews/dfs-opportunity-evidence/README.md) records exact commands, actual results, synthetic screenshots and remaining scope. Shared outcomes, legal field/ownership, contest payout/EV, calibrated portfolio objectives and accepted-entry late swap remain gated phases 5–8. Original incident artifacts and accepted-entry readback remain absent.

## Third PR: integrated workflow and recovery

This dependent draft targets `develop` and starts at `a69969ca065bf85941d397edf9f24d940467994a` from open draft PR #706; it explicitly depends on that PR without merging it. The compact approved Build/Results workspace now leads from Generate N to Review portfolio, Review entries and the exact DraftKings entry-update download. Review collects the first generated set without manual batch arithmetic. The summary distinguishes requested, generated, selected, unique and assigned counts. Separate capability states leave role/joint/field/contest-return estimates and late swap unavailable while supported projection-guided construction remains usable. Returned solver evidence leaves absent runtime, bound and gap unknown.

Accumulated review now counts pairs/cores across slots and batches, QB games, attachment/bring-back structure, FLEX, defenses, teams, salary and recorded injury flags. Collection player/group hard bounds independently gate collection export; fractional targets show misses without changing saved lineups. These collection bounds do not re-run global selection or reinterpret each batch's original requested denominator.

Selected-lineup and whole-batch replacements use an explicitly generated compatible candidate. Preview shows identities, salary/projection/overlap and player/pair deltas, preserves approved locks/core minima and rechecks hard bounds. Acceptance creates flat provenance, clears entry review and supports undo until another collection edit. Original snapshots and saved history remain frozen. This is an existing-candidate replacement workflow; automatic alternative generation and evidence-based game/core recommendations remain later work.

Normal builds show elapsed time and running/cancelled/failed/partial/complete states. Cancel stops client waiting and discards late responses; server work may finish its bounded request. Failed builds, refreshes and invalid salary imports retain last usable work. Incoming data stages affected-player before/after values for explicit Keep or Apply, records an input version and permits undo. Live updates retain imported estimates. Historical collection projection sums deliberately use their original input versions; PR4 adds explicit common-input projection reevaluation; joint scenario reevaluation remains a DATA-07 gap.

Compact version-2 backups deduplicate shared historical content and retain readable version-1 files. Bounded parsing/validation/encoding runs in a real browser worker, with account-partitioned drafts and fresh entry-review requirements. Reference expansion limits, cycles, unknown references and malformed files are rejected atomically. The 20 MiB encoded/64 MiB expanded/2M-value/depth-24 limits still bound recovery; writer/readback checks reject oversized histories before download while preserving work. Original incident inputs and accepted-entry readback remain unavailable.

Final scoped frontend verification: **213 DFS tests passed** (23.149 s); broad frontend **1,159 passed / 3 baseline failures of 1,162** (25.353 s); production build **passed in 9.76 s**, including the worker and existing bundle-size warning. The same three failures reproduce on this draft's own frozen base (33 passed / 3 failed, 0.163 s). Affected policy Python: **36 passed** (4.04 s). The final default browser workflow invocation passed all eight width/theme cases, seven race/polling supplements and both direct150 workflows (exit 0); earlier harness timing/selectors were corrected before that clean run. Direct normal Generate150 → review → 150 assignments/export/recovery passed at 390 dark and 1280 light. Prior guardrail/foundation eight-case tasks and 390/1280 portfolio/stress regressions passed. [Phase-3 review evidence](reviews/dfs-integrated-workflow/README.md) records actual results, worker responsiveness, capacity limits, inspected screenshots and remaining scope. No backend optimizer/API implementation changed; the previous phase's 2,880-test whole-suite result remains evidence for its earlier commit only.

## Second PR: portfolio guardrails

The next draft PR starts from `develop` commit `a0de0a36`, which includes the merged foundation. Its scope is native pair/core minimum/target/maximum controls, precise Classic stack and bring-back semantics, explicitly selected receiving-RB eligibility, and atomic named-plan preview/application with a plan-versus-applied manifest. It preserves legacy and single-game behavior and the original recovery/export guarantees. A group cap must constrain selection and independently gate export; a browser fixture alone cannot prove solver enforcement.

Frozen pre-change baseline was archived under `outputs/phase2-baseline/source`: **156 DFS frontend tests passed** (8.468s), and the same 13-module affected backend suite listed below produced **242 passed** (22.27s). Initial archive attempts lacked support files (`fflate`, product/rule documents); after restoring those files from the same commit, the corrected runs passed. Those setup failures are not product regressions. The same three broader frontend failures were reproduced on this second-PR baseline (`a0de0a36`): **33 passed / 3 failed** across `draftRoomHelpers`, `accuracyPresentation` and `livingSurfaces` (0.201s).

The real-engine affected suite produced **279 passed in 35.71s** across the 13 foundation modules plus `test_dfs_stack_rules.py`. The native-stack pipeline selected **150 distinct lineups from 278 candidates in 15.141s**. Its QB target was 60 / actual 60; pair target 30 / actual 30 within hard 15–45 bounds. Candidate generation recorded 23 group-omission attempts; all selected lineups passed the requested exact-one attachment audit. Independent Node export/CSV/backup replay passed and preserved one unrelated entry. This measures a synthetic engineering fixture, not model quality or production runtime. Platform acceptance remains unconfirmed.

Final DFS frontend subset: **178/178 passed**. Broad frontend: **1,127 tests, 1,124 passed and the same 3 confirmed baseline failures** (13.504s). Final production build: **passed in 10.76s**, retaining the existing bundle-size warning above 500 kB. Existing portfolio browser tests also passed at 390/1280, including the 150-entry workflow and 140-lineup/700-player stress backup (588,363 values) without regeneration.

At the second-PR cutoff, native pair/core bounds apply to each requested global build, with that build's requested count as denominator. Collected batches keep their original rules and an accumulated player/QB usage audit; combined collection pair/core counts and bounds were still pending (now added in PR3); applying a named plan does not reselect the old collection or reinterpret separate batch bounds as one combined global selection. Global named plans reject legacy stack fields even when native rules are null. Null native rules with zero legacy fields are supported. A legacy plan with `require_qb_stack:true` must explicitly choose a count of at least one; an explicit zero is rejected before preview. Receiving-RB eligibility is explicitly declared; unknown/contradictory relationships stay unknown and cannot silently satisfy a required native rule.

**All eight final pair/core + stack + plan browser task/layout cases passed** at 390, 768, 1280 and 1440 in dark/light themes. Checks include empty/duplicate/conflicting groups, percent/count switching, actual pair counts, all five stack modes, explicit receiving RBs, original-input stack histograms, plan preview/cancel/atomic replacement, disabled mismatched Build, stale controls/context, null native rules, applied-plan backup/reload, independent group/stack export audit and actual CSV SHA-256. The extended run found and corrected a histogram field-name defect before this final rerun. Foundation eight-case/auth-race checks also passed. Keyboard Enter on plan Apply/Cancel returns focus to the visible Import trigger at every tested width/theme. Final extra regressions cover Captain comparison with an invalid unused lineup count, restored legacy controls/differences after leaving DraftKings, group pagination after applying a smaller same-slate plan, and invalid required-zero legacy-plan import. [Scoped visual evidence](reviews/dfs-portfolio-guardrails/README.md) was inspected. The complete backend gate finished: **2,880 passed, 2 skipped, 1 warning in 1854.05s**. Command: `PYTHONPATH=. "C:/Users/Caelp/Desktop/Git Projects/ScoreSense/.venv/Scripts/python.exe" -m pytest tests/ -q --basetemp=outputs/pytest-phase2-full --durations=15` from the isolated checkout, with output retained in `outputs/phase2-full-backend.log`. The backend stayed unchanged throughout this run. Statistical core/shared-assumption evidence, scenario concentration, exact accepted-entry locks and the original incident files remain separate gaps. At the PR2 cutoff, stage 1 compact backups and stages 3–8 remained outstanding; PR3 now adds the scoped integration/recovery described above. PR2 did not finish the entire specification.

## Foundation verification record

Frozen baseline tests ran against a `git archive` of the inventory commit under `outputs/dfs-baseline/source`, avoiding concurrent implementation edits. Existing dependencies were reused; no packages were purchased or installed.

- `node --test <archived frontend/src/dfs*.test.js>`: **117 passed, 0 failed** (5.65s). The initial pre-dependency attempt had 111 passing cases and one module-load failure for missing `fflate`; rerun after dependency reuse passed.
- `PYTHONPATH=. <existing venv python> -m pytest tests/test_api_lineup.py tests/test_lineup_optimizer.py tests/test_dfs_validation.py tests/test_dfs_salaries.py tests/test_dfs_slates.py tests/test_dfs_slate_snapshots.py tests/test_dfs_snapshots.py tests/test_dfs_results.py tests/test_dfs_captain_comparison.py -q --basetemp=<workspace outputs/dfs-baseline/pytest-temp-fixed>`: **173 passed** (12.30s).
- Initial Python attempts were blocked by the sandbox's default temporary-directory permissions, then an incomplete archived support package; these are environment/fixture setup failures, not product regressions. The corrected frozen run above is the baseline.
- Three broader frontend failures were reproduced against the frozen inventory commit: `draftRoomHelpers.test.js` expects old “Rookie contract” copy; `accuracyPresentation.test.js` expects empty null-copy instead of “QB typical miss · 0.0 pts”; `livingSurfaces.test.js` expects an obsolete My team banner restriction. The three archived files produced **33 passed, 3 failed** (36 tests); these are confirmed pre-existing failures, not newly introduced DFS failures.
- Actual synthetic engine pipelines: **150 requested / 150 selected, 380 candidates, QB target 60 / actual 60, 15.11s**; final export-guard-integrated rerun **337 candidates, 15.14s**, again 150 selected and target 60 / actual 60. These verify the fixture's candidate/selection pipeline, not model quality or a production runtime guarantee.
- Final frontend suite: **1,105 tests, 1,102 passed, 3 failed** (9.928s). The three failures match the frozen baseline above. The DFS subset passes **156 tests**.
- Production build: **passed**, final run 7.15s; existing warning for bundles larger than 500 kB remains.
- `node scripts/dev/dfs_rebuild_browser.mjs`: **passed** at 390, 768, 1280 and 1440 in dark/light themes (8 cases), plus fresh-403 recovery rejection and account-change-during-save protection. Explicit control bounds catch clipped mobile inputs as well as page overflow. Format/slate/units keyboard focus, native target/count controls, blocked invalid bounds, unchanged forecasts, pair/FLEX display and reload from IndexedDB passed.
- `node scripts/dev/dfs_portfolio_browser.mjs`: **passed** at 390 and 1280, including 150 selected entries plus unchanged unrelated row, frozen history/catalogs, malformed/mixed restore rejection, fresh assignment, exact-byte local recovery versus synchronized download, and actual CSV SHA-256 versus audit manifest. Assignment selectors fit their visible list and retain full batch/lineup accessible names. The 140-lineup / 700-player stress backup (588,251 JSON values) round-tripped with no regeneration.
- [Scoped screenshots and compact layout results](reviews/dfs-rebuild/README.md) were inspected. All eight responsive/theme geometry checks passed after correcting mobile grid/assignment-selector clipping and numeric-column width. Other Fantasy/Projections menu contexts and full accessibility certification were not exercised.
- The whole-repository backend run was stopped after its last reported **38%** because it began before the final solver timeout change. It has no completion summary and is **not a passing whole-suite result**; the full gate remained outstanding at that foundation stage. The completed second-PR whole-suite result is recorded above; fresh affected-suite results remain separate.
- Final consolidated affected backend suite: **242 passed in 19.10s**. Scope: `test_api_lineup`, `test_lineup_optimizer`, `test_dfs_validation`, `test_dfs_salaries`, `test_dfs_slates`, `test_dfs_slate_snapshots`, `test_dfs_snapshots`, `test_dfs_results`, `test_dfs_captain_comparison`, `test_dfs_portfolio_selection`, `test_dfs_build_retries`, `test_living_surfaces`, and `test_product_constitution`. Run with `PYTHONPATH=.`, existing venv `python -m pytest <these tests/*.py> -q --basetemp=outputs/pytest-dfs-final --durations=15`. This includes the final target-incumbent timeout regressions and preserves a feasible set without claiming projection optimality after a timeout.
- Frontend tests used explicit file enumeration (`rg --files frontend/src -g '*.test.js'`, then `node --test <files> scripts/dev/layout_audit.test.mjs`). The package's directory-based `npm test` command fails to load `src` on this Node 24 environment; that launcher failure is not counted as a passing run.

Existing browser infrastructure: `scripts/dev/dfs_portfolio_browser.mjs` renders production `useDfsBuilder` / `LineupOptimizer` / `DfsWorkspace` with synthetic local API responses. It covers 150 selected entries plus an unrelated row, frozen catalog history, backup/restore and failure states. The existing port-5173 Vite belongs to another checkout; isolated testing must not replace it. Route-fulfilled bundled production fixtures can test the isolated code without a second app server.

## Rule implementation matrix

`partial` means useful baseline/PR behavior exists but the complete revised rule or acceptance scope remains unmet. `implemented_scoped` means the stated engineering contract is implemented and tested within its declared scope; it does not certify later statistical models or platform acceptance. `policy` records a respected operating restriction rather than an implemented model. `planned_gated` means unavailable until its data/evaluation gate passes. The synchronized [JSON registry](DFS_REBUILD_RULE_MATRIX.json) is traceability only, never executable optimizer configuration.

| Rule | Requirement | State | Stage | Acceptance |
|---|---|---|---|---|
| GOV-01 | Version every rule and every build | partial | 1–7 | T05, T35 |
| DATA-01 | Classic main slate only | partial | 2,5 | T01, T02 |
| DATA-02 | Freeze source, identity and availability | partial | 1,4 | T04, T05, T06 |
| PACE-01 | Combined-play screen: inherited 75/25 blend | implemented_scoped | 4 | T17 |
| PACE-02 | Let sample size govern venue adjustment | partial | 4 | T17, T19 |
| PACE-03 | Separate volume, tempo, dropbacks and scoring | partial | 4 | T03, T17, T18 |
| PACE-04 | Define a coherent count system | implemented_scoped | 4 | T18 |
| MARKET-01 | Timestamp movement without inventing causes | partial | 4 | T05, T17, T19 |
| OWN-01 | Ownership is a field forecast, not player ability | partial | 6 | T04, T21, T23 |
| OWN-02 | Do not multiply marginal ownership into stack ownership | planned_gated | 6 | T21, T22 |
| ROLE-01 | Project the role before the matchup | partial | 4,5 | T03, T18, T19 |
| ROLE-02 | Value opportunities by location and scoring | partial | 4,5 | T02, T18, T19 |
| ROLE-03 | Pool small samples and honor structural changes | partial | 4,5 | T05, T19 |
| ROLE-04 | Redistribute opportunity, not just vacated totals | planned_gated | 4,5 | T05, T18, T19 |
| MATCH-01 | Match receiver role to defensive tendencies | planned_gated | 4 | T19, T20 |
| MATCH-02 | Do not invent shadow coverage or automatic pressure beneficiaries | planned_gated | 4 | T04, T19 |
| STACK-01 | A second attachment must improve the build | planned_gated | 2,4 | T07, T20 |
| STACK-02 | Bring-backs and stack size are optional choices | planned_gated | 2,4 | T07, T20 |
| STACK-03 | Compare complete alternatives, not isolated players | planned_gated | 2,4 | T20, T36 |
| SIM-01 | Generate coherent joint game outcomes | planned_gated | 5 | T18, T19, T20 |
| SIM-02 | Do not add individual ceilings or assume normal tails | planned_gated | 5 | T04, T19, T20 |
| FIELD-01 | Simulate legal, correlated opponent lineups | planned_gated | 6 | T21, T22, T23 |
| PORT-01 | Declare objective and price ties correctly | planned_gated | 7 | T22, T23, T36 |
| PORT-02 | Audit shared assumptions, not just shared names | partial | 2,3,7 | T11, T13, T36 |
| PORT-03 | Three-to-four-game focus is a configuration, not a law | partial | 2,4 | T14, T20 |
| VALID-01 | Test forward and remove layers one at a time | partial | 4–7 | T05, T19, T20 |
| VALID-02 | Audit decisions before judging results | partial | 4–7 | T30, T35 |
| OPS-01 | Reuse artifact-first architecture; gate readiness | partial | 1–7 | T23, T32, T35 |
| OPS-02 | Check availability and rights before promising a feed | policy | 4–6 | T03, T04 |
| OPS-03 | Separate live-slate execution from model development | policy | all | T28, T32, T35 |
| OPS-04 | Separate entry reservation from final lineup selection | policy | 3,8 | T25, T30 |
| OPS-05 | Validate actual entries, not only an exported or saved lineup file | partial | 1,3,8 | T25, T26, T27, T30, T31 |
| OPS-06 | Use a time-boxed workflow patch before an imminent slate | partial | 1 | T25, T28, T32, T33 |
| PORT-04 | Count all locks across the final portfolio and gate incomplete exports | partial | 1,2 | T09, T10, T12, T25 |
| OPS-07 | Make an assembled portfolio recoverable without changing its history | partial | 1 | T29, T30, T32 |
| GOV-02 | Define optimality and prohibit false certainty | partial | 1,7 | T23, T24, T36 |
| GOV-03 | Separate design requirements from historical decisions | policy | all | T05, T30, T31, T35 |
| DATA-03 | Use exact, account-scoped slate and player identities | partial | 1,4 | T01, T06, T25, T29 |
| DATA-04 | Preserve source windows and count denominators | partial | 4 | T03, T05 |
| DATA-05 | Keep projection semantics and overrides explicit | partial | 1,4 | T04, T05, T35 |
| DATA-06 | Gate data use by actual rights and coverage | policy | 4–6 | T03, T04, T29 |
| DATA-07 | Freeze one decision-time evaluation snapshot | partial | 3,4 | T05, T32, T35 |
| PACE-05 | Rank quarterback-side opportunity and challenge omissions | partial | 4 | T17, T20 |
| ROLE-05 | Research all complementary positions | partial | 4,5 | T02, T04, T18, T19 |
| STACK-04 | Block QB versus opposing DST by default | partial | 1 initial / 2 complete | T01, T08 |
| STACK-05 | Make group and bring-back semantics exact | implemented_scoped | 2 | T07, T14, T35 |
| SIM-03 | Derive specialist outcomes from shared events | planned_gated | 5 | T02, T18, T19 |
| FIELD-02 | Use the actual contest and correct field size | planned_gated | 6 | T21, T22, T23 |
| PORT-05 | Native global minimum, target and maximum exposure | partial | 1 initial / 2 complete | T10, T12, T34, T35 |
| PORT-06 | Expose and constrain pairs, cores and shared assumptions | partial | 1 initial / 2 complete | T11, T15, T36 |
| PORT-07 | Allow full salary without requiring full spend | partial | 2,3 | T16, T20 |
| PORT-08 | Audit FLEX structure rather than ban it blindly | partial | 2,3 | T13, T20 |
| PORT-09 | Separate candidate generation from portfolio selection | partial | 1 initial / 2 complete | T12, T15, T20, T24 |
| PORT-10 | No silent relaxations or unintended lineup substitution | partial | 1 initial / 2,3 complete | T10, T12, T14, T25, T30 |
| OPS-08 | Separate valid CSV generation from nonessential ledger sync | partial | 1 | T25, T26, T27, T28, T29 |
| OPS-09 | Keep entry lifecycle and export versions truthful | partial | 1,3,8 | T25, T27, T30, T35 |
| OPS-10 | Treat late swap as exact locked-slot optimization | planned_gated | 8 | T31, T32 |
| VALID-03 | Turn observed incidents into reproducible regression evidence | partial | 0,2,3 | T08, T11, T13, T25, T30 |
| UX-01 | Preserve the approved DFS visual system | partial | all | T33, T34 |
| UX-02 | Make the normal 150-lineup path one coherent workflow | partial | 1 initial / 3 complete | T14, T25, T34 |
| UX-03 | Make exposures and stack controls understandable | partial | 1 initial / 2,3 complete | T07, T10, T34, T35 |
| UX-04 | Show decision evidence and uncertainty, not invented precision | partial | 3,4,6 | T04, T19, T23, T34 |
| UX-05 | Preserve work through errors, refreshes and replacements | partial | 1 initial / 3 complete | T28, T29, T30, T32, T34 |
| UX-06 | Accessibility, responsiveness and responsiveness-to-input | partial | all | T33, T34 |
| UX-07 | Require real task and visual acceptance | partial | all | T33, T34 |

## Acceptance catalog status

Partial coverage does not mark the whole T-case passed. The JSON registry records remaining work for every rule.

| Case | State | Remaining scope / evidence |
|---|---|---|
| T01 | partial | Salary/slate/identity guards exist; complete sport/game/scoring contract remains. `tests/test_dfs_salaries.py; tests/test_dfs_slate_snapshots.py; tests/test_dfs_validation.py` |
| T02 | partial | Roster/salary adapter tested; exact scoring/bonuses and coherent specialists remain. `tests/test_lineup_optimizer.py; tests/test_dfs_validation.py` |
| T03 | partial | Explicit duplicate-header route/grade parsing, raw hash/period validation, zero/missing denominators and distinct passing-snap/team-dropback rates are tested. Original paid provider exports and broad actual route coverage remain absent. `tests/test_dfs_opportunity.py; scripts/dev/verify_dfs_evidence.py; scripts/dev/dfs_evidence_tasks.mjs` |
| T04 | partial | Historical source coverage and missing specialist capabilities are explicit; hashes confer no source permission/authenticity. Forward roles/joint/field/EV/late swap remain gated. `tests/test_dfs_opportunity.py; tests/test_dfs_evidence_api.py; dfsEvidence.test.mjs; dfs_evidence_tasks.mjs` |
| T05 | partial | Evidence observations use declared compatible prior windows/known-at cutoffs; selected comparison inputs are immutable. Unknown historic publication remains retrospective, not certified pre-lock availability. `tests/test_dfs_opportunity.py; tests/test_dfs_opportunity_eval.py; dfsEvidence.test.mjs; dfs_evidence_tasks.mjs` |
| T06 | partial | Guarded identities and string export IDs tested; persistent cross-provider mapping remains. `dfsExport.test.js; tests/test_dfs_salaries.py` |
| T07 | implemented_scoped | PR2 tests every native mode, lock-inclusive attachments/opponents, receiving-RB declaration and independent actual-roster audits. Role eligibility is explicitly user-declared, not a fitted football-role model. `test_dfs_stack_rules.py; dfsBuildPlans.test.js; dfsGlobalExportValidation.test.js; dfs_guardrails_tasks.mjs` |
| T08 | partial | PR1 global-mode strategy guard; original 11-conflict file was not provided. `PR1 synthetic regression; phase 2 exact-game audit` |
| T09 | partial | Classic permutations and single-game FLEX permutations deduplicate while Captain identity remains distinct. Exact started-slot late-swap preservation remains gated. `dfsPortfolio.test.js; dfsWorkspaceState.test.js; tests/test_dfs_validation.py` |
| T10 | partial | Native global and accumulated collection hard count bounds gate selection/export respectively; fractional target misses stay soft. Original per-build denominators are preserved through reviewed replacements. `dfsGlobalExposure.test.js; dfsPortfolioReview.test.js; dfsGlobalExportValidation.test.js; dfs_workflow_tasks.mjs` |
| T11 | partial | Per-build pair/core selection remains enforced. PR3 accumulated pairs/cores count across every slot and batch, with hard collection bounds, soft misses and affected-lineup navigation. Original 89-pair incident inputs and modeled shared assumptions remain unavailable. `dfsPortfolioReview.test.js; dfsGroupExposure.test.js; dfs_workflow_tasks.mjs; verify_dfs_rebuild.py --native-stacks` |
| T12 | partial | PR1 reports selector count/status/violations without duplicate fill. `tests/test_dfs_portfolio_selection.py (new)` |
| T13 | partial | Current-build and collection FLEX/RB-pair distributions are descriptive, including synthetic 114/150 regression, with no automatic ban. Generic requested position-distribution constraints remain. `dfsGlobalExposure.test.js; dfsPortfolioReview.test.js; dfs_workflow_tasks.mjs` |
| T14 | implemented_scoped | PR2 atomic named-plan import/preview/cancel/apply replaces locks/skips/schedule/rules, retains immutable IDs and manifests, rejects stale/context changes, and blocks mismatched Build. Browser backup/reload preserves the original batches and applied-plan metadata. `dfsBuildPlans.test.js; dfs_guardrails_tasks.mjs` |
| T15 | partial | PR2 bounded generation adds pair/core omission attempts; 150-lineup synthetic fixture passes. Wider-budget, ordering and research-pool sensitivity comparisons remain. `test_dfs_build_retries.py; test_dfs_portfolio_selection.py; verify_dfs_rebuild.py --native-stacks` |
| T16 | partial | Common-input complete-roster alternatives display actual legal salary and summed objectives while optional minimum/full cap remain. Joint contest-aware cost comparison remains. `tests/test_dfs_classic_comparison.py; dfs_evidence_tasks.mjs` |
| T17 | implemented_scoped | Exact 75/25 inherited team/combined screens, sample/source/window values, missing-venue fallback and unfitted alternatives are tested and displayed. Actual chronological research does not promote a fitted venue effect. `tests/test_dfs_opportunity.py; tests/test_dfs_opportunity_eval.py; verify_dfs_evidence.py; dfs_evidence_tasks.mjs; docs/reviews/DFS_OPPORTUNITY_2024_RETROSPECTIVE.md` |
| T18 | partial | Historical accepted-scrimmage count identities and team denominators reconcile. Joint game/opportunity outcomes, availability and specialist conservation remain stage 5. `tests/test_dfs_opportunity.py; tests/test_dfs_opportunity_eval.py; phase5` |
| T19 | partial | Actual 2024 earlier-tuning/later-held-out play/dropback and observed-touch role screens were compared with week-block uncertainty. No live publication archive, multi-season forward role model or calibrated joint/field model is validated. `tests/test_dfs_opportunity_eval.py; docs/reviews/DFS_OPPORTUNITY_2024_RETROSPECTIVE.md` |
| T20 | partial | Bounded whole-nine-player primary/challenger comparisons and existing collection objective sums use one explicit snapshot with original forecasts preserved. Independent generation/evaluation draw separation remains gated until shared simulation exists. `tests/test_dfs_classic_comparison.py; dfsEvidence.test.mjs; dfs_evidence_tasks.mjs; phases 5/7` |
| T21 | planned_gated | No validated contest-conditioned legal opponent-field model. `Phase 6` |
| T22 | partial | Descriptive contest tie helper exists; joint own/opponent multiplicities, currency/noncash adapter remain. `dfsContest.test.js; phase 6` |
| T23 | partial | Independent capability review labels role/joint/field/contest-return and late-swap unavailable while projection-guided legal construction remains usable. No silent research-objective fallback or EV claim is added; contest-aware objectives remain gated. `dfsWorkspaceState.test.js; dfs_workflow_tasks.mjs; phases 4–7` |
| T24 | partial | Latest returned solver status, requested/selected/unique/candidate counts and provided runtime/bounds/gap are disclosed; absent values stay unavailable. Client build state distinguishes running/cancelled/failed/partial/complete. Full numerical-scaling evidence remains. `dfsWorkspaceState.test.js; dfs_workflow_tasks.mjs; tests/test_dfs_portfolio_selection.py` |
| T25 | partial | Existing assignment tests; PR1 pure deterministic 150-entry serializer/recovery coverage. `dfsPortfolio.test.js; dfsEntryRecovery.test.js (new); dfs_portfolio_browser.mjs` |
| T26 | partial | PR1 robust headers/preamble/ragged/quoted metadata conversion. `dfsEntryRecovery.test.js (new)` |
| T27 | partial | Targeted wrong-template correction exists. `dfsEntryRecovery.test.js (new); dfsEntryExport.js` |
| T28 | partial | PR1 authorized recovery on optional sync failure, idempotent retry, fresh authorization and account-change races tested; original incident inputs remain unavailable. `dfsEntryExportSession.test.js; dfs_portfolio_browser.mjs; dfs_rebuild_browser.mjs` |
| T29 | partial | Compact shared-content version-2 backups and off-thread browser draft/manual recovery retain exact history, native rules, applied plans and collection bounds; version 1 remains readable. Bounded expansion and malformed restore are tested. Original incident file is absent. Compact encoding does not remove the 20 MiB input/64 MiB expanded/2M-value/depth-24 capacity limits. `dfsPortfolioBackup.test.js; dfsPortfolioBackupAsync.test.js; dfsLocalDraft.test.js; dfs_portfolio_browser.mjs; dfs_workflow_tasks.mjs` |
| T30 | partial | Frozen output metadata/order and exact-byte seals remain; explicit selected-lineup/whole-batch replacements show deltas and retain flat lineage/undo. Acceptance remains unconfirmed without platform readback; original incident files are unavailable. `dfsPortfolioReview.test.js; dfsPortfolioBackup.test.js; dfsEntryExportSession.test.js; dfs_workflow_tasks.mjs` |
| T31 | planned_gated | Late swap disabled; pre-lock tests cannot prove exact started-slot immutability. `Phase 8; explicit gate test in dfsEntryRecovery.test.js` |
| T32 | partial | PR3 workflow preservation remains; PR4 explicitly staged evidence/current-input selection, client comparison cancellation and stale response guards retain reviewed work. Joint scenario reevaluation remains unavailable. `dfs_workflow_tasks.mjs; dfs_evidence_tasks.mjs; dfsEvidence.test.mjs` |
| T33 | partial | PR4 actual-theme-asserted evidence tasks/layouts at 390/768/1280/1440 in both themes and keyboard/focus/cancel/source-staging checks extend prior workflow acceptance. Inspected screenshots are synthetic. Full accessibility certification and unrelated Fantasy/Projections contexts remain unclaimed. `dfs_evidence_tasks.mjs; dfs_workflow_tasks.mjs; layout_audit.mjs; docs/reviews/dfs-opportunity-evidence/README.md` |
| T34 | partial | Integrated150 generation/review/recovery/export remains. PR4 diagnostic evidence and complete alternatives are reviewable without changing saved builds. Calibrated role/opportunity recommendations and contest-aware objectives remain unavailable. `dfs_workflow_tasks.mjs; dfs_evidence_tasks.mjs; docs/reviews/dfs-opportunity-evidence/README.md` |
| T35 | partial | Selected common pool/control/evidence IDs and source receipts accompany comparison review; original builds/CSV seals remain immutable. Full model/field manifests and archived live source joins remain. `dfsEvidence.test.mjs; tests/test_dfs_classic_comparison.py; tests/test_dfs_opportunity.py; dfs_evidence_tasks.mjs` |
| T36 | planned_gated | No validated contest-aware objective/risk/top-finish selector exists. `Phases 6/7` |
