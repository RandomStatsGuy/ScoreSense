# DFS optimizer rebuild: implementation and remaining work

This tracks the complete [v0.2.0 specification](ScoreSense_DFS_Optimizer_Rebuild_Spec_v0.2.0.md), not only the first PR. Inventory baseline: `develop` commit `45694c9355cbd6559da79ef688c4a62e5b94283d`, October 11, 2026. The source was copied byte-for-byte from the supplied file; SHA-256: `A0CD7F50EED4F3A45D0158F587C2D00C1003C1B5425845A9BCFE9AA693FCA96C`.

`PRODUCT.md` governs appearance. Keep the existing DFS layout and single-game behavior. This project does not authorize merge, deployment, data purchase, entry submission or live-lineup changes. Projection sums remain supported; no validated tournament edge, expected profit or joint probability is claimed.

## Current code and confirmed gaps

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
| 1 | Reliable entry serializer, authorized local recovery, durable draft, actionable pending state; compact backups remain a gap | Scoped foundation in first draft PR; validation recorded below. |
| 2 | Native global exposures, pair/core constraints, QB/DST guard, exact stacks, atomic plans | Foundation in PR1; PR2 adds pair/core UI, native exact semantics, independent audits and atomic plans. Final verification is recorded separately below. |
| 3 | Integrated progressive workflow, pair/structure views, replacement preview, capability/error states | Pending; design is required within every preceding phase too. |
| 4 | Provenance-aware opportunity/game evidence, inherited pace baseline and challenger comparisons | Pending; usable permitted source coverage and chronological count/role evaluation required. |
| 5 | Coherent shared outcomes, verified site scoring and specialist distributions | Gated pending conservation/calibration/evaluation-draw tests and measured runtime. |
| 6 | Contest-conditioned legal field, ownership sensitivity, exact payouts/ties | Gated pending permitted full-field/ownership archives and actual contest payout contracts. |
| 7 | Contest-aware joint portfolio evaluation and distinct risk/top-finish objectives | Gated pending untouched forward evaluation and comparable-budget baseline. |
| 8 | Accepted-entry late swap preserving exact started slots | Separately gated; verified accepted state/current locks and end-to-end tests required. |

No later stage is represented as delivered by PR1. Missing statistical/data dependencies must gate unsupported claims while independent engineering and design continue.

## Second PR: portfolio guardrails

The next draft PR starts from `develop` commit `a0de0a36`, which includes the merged foundation. Its scope is native pair/core minimum/target/maximum controls, precise Classic stack and bring-back semantics, explicitly selected receiving-RB eligibility, and atomic named-plan preview/application with a plan-versus-applied manifest. It preserves legacy and single-game behavior and the original recovery/export guarantees. A group cap must constrain selection and independently gate export; a browser fixture alone cannot prove solver enforcement.

Frozen pre-change baseline was archived under `outputs/phase2-baseline/source`: **156 DFS frontend tests passed** (8.468s), and the same 13-module affected backend suite listed below produced **242 passed** (22.27s). Initial archive attempts lacked support files (`fflate`, product/rule documents); after restoring those files from the same commit, the corrected runs passed. Those setup failures are not product regressions. The same three broader frontend failures were reproduced on this second-PR baseline (`a0de0a36`): **33 passed / 3 failed** across `draftRoomHelpers`, `accuracyPresentation` and `livingSurfaces` (0.201s).

The real-engine affected suite produced **279 passed in 35.71s** across the 13 foundation modules plus `test_dfs_stack_rules.py`. The native-stack pipeline selected **150 distinct lineups from 278 candidates in 15.141s**. Its QB target was 60 / actual 60; pair target 30 / actual 30 within hard 15–45 bounds. Candidate generation recorded 23 group-omission attempts; all selected lineups passed the requested exact-one attachment audit. Independent Node export/CSV/backup replay passed and preserved one unrelated entry. This measures a synthetic engineering fixture, not model quality or production runtime. Platform acceptance remains unconfirmed.

Final DFS frontend subset: **178/178 passed**. Broad frontend: **1,127 tests, 1,124 passed and the same 3 confirmed baseline failures** (13.504s). Final production build: **passed in 10.76s**, retaining the existing bundle-size warning above 500 kB. Existing portfolio browser tests also passed at 390/1280, including the 150-entry workflow and 140-lineup/700-player stress backup (588,363 values) without regeneration.

Native pair/core bounds apply to each requested global build, with that build's requested count as denominator. Collected batches keep their original rules and an accumulated player/QB usage audit; combined collection pair/core counts and bounds remain pending; applying a named plan does not reselect the old collection or reinterpret separate batch bounds as one combined global selection. Global named plans reject legacy stack fields even when native rules are null. Null native rules with zero legacy fields are supported. A legacy plan with `require_qb_stack:true` must explicitly choose a count of at least one; an explicit zero is rejected before preview. Receiving-RB eligibility is explicitly declared; unknown/contradictory relationships stay unknown and cannot silently satisfy a required native rule.

**All eight final pair/core + stack + plan browser task/layout cases passed** at 390, 768, 1280 and 1440 in dark/light themes. Checks include empty/duplicate/conflicting groups, percent/count switching, actual pair counts, all five stack modes, explicit receiving RBs, original-input stack histograms, plan preview/cancel/atomic replacement, disabled mismatched Build, stale controls/context, null native rules, applied-plan backup/reload, independent group/stack export audit and actual CSV SHA-256. The extended run found and corrected a histogram field-name defect before this final rerun. Foundation eight-case/auth-race checks also passed. Keyboard Enter on plan Apply/Cancel returns focus to the visible Import trigger at every tested width/theme. Final extra regressions cover Captain comparison with an invalid unused lineup count, restored legacy controls/differences after leaving DraftKings, group pagination after applying a smaller same-slate plan, and invalid required-zero legacy-plan import. [Scoped visual evidence](reviews/dfs-portfolio-guardrails/README.md) was inspected. The complete backend gate finished: **2,880 passed, 2 skipped, 1 warning in 1854.05s**. Command: `PYTHONPATH=. "C:/Users/Caelp/Desktop/Git Projects/ScoreSense/.venv/Scripts/python.exe" -m pytest tests/ -q --basetemp=outputs/pytest-phase2-full --durations=15` from the isolated checkout, with output retained in `outputs/phase2-full-backend.log`. The backend stayed unchanged throughout this run. Statistical core/shared-assumption evidence, scenario concentration, exact accepted-entry locks and the original incident files remain separate gaps. Stage 1 compact backups and stages 3–8 remain outstanding; PR2 does not claim to finish the entire specification.

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
| PACE-01 | Combined-play screen: inherited 75/25 blend | planned_gated | 4 | T17 |
| PACE-02 | Let sample size govern venue adjustment | planned_gated | 4 | T17, T19 |
| PACE-03 | Separate volume, tempo, dropbacks and scoring | planned_gated | 4 | T03, T17, T18 |
| PACE-04 | Define a coherent count system | planned_gated | 4 | T18 |
| MARKET-01 | Timestamp movement without inventing causes | partial | 4 | T05, T17, T19 |
| OWN-01 | Ownership is a field forecast, not player ability | partial | 6 | T04, T21, T23 |
| OWN-02 | Do not multiply marginal ownership into stack ownership | planned_gated | 6 | T21, T22 |
| ROLE-01 | Project the role before the matchup | planned_gated | 4,5 | T03, T18, T19 |
| ROLE-02 | Value opportunities by location and scoring | planned_gated | 4,5 | T02, T18, T19 |
| ROLE-03 | Pool small samples and honor structural changes | planned_gated | 4,5 | T05, T19 |
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
| VALID-01 | Test forward and remove layers one at a time | planned_gated | 4–7 | T05, T19, T20 |
| VALID-02 | Audit decisions before judging results | planned_gated | 4–7 | T30, T35 |
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
| DATA-04 | Preserve source windows and count denominators | planned_gated | 4 | T03, T05 |
| DATA-05 | Keep projection semantics and overrides explicit | partial | 1,4 | T04, T05, T35 |
| DATA-06 | Gate data use by actual rights and coverage | policy | 4–6 | T03, T04, T29 |
| DATA-07 | Freeze one decision-time evaluation snapshot | partial | 3,4 | T05, T32, T35 |
| PACE-05 | Rank quarterback-side opportunity and challenge omissions | planned_gated | 4 | T17, T20 |
| ROLE-05 | Research all complementary positions | planned_gated | 4,5 | T02, T04, T18, T19 |
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
| T03 | planned | No verified PFF-like route ledger/denominator parser is integrated. `Phase 4` |
| T04 | partial | Missing forecasts/financials stay unknown; full ownership/status/lock capability contract remains. `dfsPoolCoverage.test.js; dfsResults.test.js; test_dfs_player_estimates.py` |
| T05 | partial | Immutable snapshots exist; full known-at as-of joins/source windows remain. `tests/test_dfs_snapshots.py; tests/test_dfs_slate_snapshots.py` |
| T06 | partial | Guarded identities and string export IDs tested; persistent cross-provider mapping remains. `dfsExport.test.js; tests/test_dfs_salaries.py` |
| T07 | implemented_scoped | PR2 tests every native mode, lock-inclusive attachments/opponents, receiving-RB declaration and independent actual-roster audits. Role eligibility is explicitly user-declared, not a fitted football-role model. `test_dfs_stack_rules.py; dfsBuildPlans.test.js; dfsGlobalExportValidation.test.js; dfs_guardrails_tasks.mjs` |
| T08 | partial | PR1 global-mode strategy guard; original 11-conflict file was not provided. `PR1 synthetic regression; phase 2 exact-game audit` |
| T09 | partial | Classic permutations deduplicate; future locked-slot preservation remains gated. `dfsPortfolio.test.js; tests/test_dfs_validation.py` |
| T10 | partial | PR1 global count arithmetic/hard bounds/soft targets and lock conflicts. `tests/test_dfs_portfolio_selection.py (new)` |
| T11 | partial | PR2 per-build pair/core editor and real synthetic 150-lineup selection enforce pair target 30 within hard 15–45; independent export checks reject violations. Combined collection pair/core counts and bounds across separately collected batches remain pending. Original 89-pair incident inputs and broader shared-assumption evidence remain unavailable. `test_dfs_build_retries.py; test_dfs_portfolio_selection.py; dfsGroupExposure.test.js; verify_dfs_rebuild.py --native-stacks; dfs_guardrails_tasks.mjs` |
| T12 | partial | PR1 reports selector count/status/violations without duplicate fill. `tests/test_dfs_portfolio_selection.py (new)` |
| T13 | partial | PR1 displays FLEX distribution with synthetic 114/150 fixture and no automatic ban; requested position bounds remain. `dfsGlobalExposure.test.js; phase 2/3` |
| T14 | implemented_scoped | PR2 atomic named-plan import/preview/cancel/apply replaces locks/skips/schedule/rules, retains immutable IDs and manifests, rejects stale/context changes, and blocks mismatched Build. Browser backup/reload preserves the original batches and applied-plan metadata. `dfsBuildPlans.test.js; dfs_guardrails_tasks.mjs` |
| T15 | partial | PR2 bounded generation adds pair/core omission attempts; 150-lineup synthetic fixture passes. Wider-budget, ordering and research-pool sensitivity comparisons remain. `test_dfs_build_retries.py; test_dfs_portfolio_selection.py; verify_dfs_rebuild.py --native-stacks` |
| T16 | partial | Optional minimum and full cap exist; broader full-lineup cost comparison remains. `tests/test_lineup_optimizer.py` |
| T17 | planned | Inherited pace baseline and source/sample display not implemented as specified. `Phase 4` |
| T18 | planned_gated | No coherent game/opportunity conservation simulator integrated. `Phase 5` |
| T19 | planned_gated | No forward validation of this proposed joint/opportunity/field model. `Phases 4–7` |
| T20 | planned_gated | Generation/evaluation draw separation not applicable to current projection-sum baseline. `Phases 5/7` |
| T21 | planned_gated | No validated contest-conditioned legal opponent-field model. `Phase 6` |
| T22 | partial | Descriptive contest tie helper exists; joint own/opponent multiplicities, currency/noncash adapter remain. `dfsContest.test.js; phase 6` |
| T23 | partial | No unsupported EV claim added; explicit multi-capability mode selection remains. `DFS_GPP_FOUNDATION.md; phases 3/6` |
| T24 | partial | PR1 reports candidate-selector status; full solver limits/scaling UI remains. `tests/test_dfs_portfolio_selection.py (new)` |
| T25 | partial | Existing assignment tests; PR1 pure deterministic 150-entry serializer/recovery coverage. `dfsPortfolio.test.js; dfsEntryRecovery.test.js (new); dfs_portfolio_browser.mjs` |
| T26 | partial | PR1 robust headers/preamble/ragged/quoted metadata conversion. `dfsEntryRecovery.test.js (new)` |
| T27 | partial | Targeted wrong-template correction exists. `dfsEntryRecovery.test.js (new); dfsEntryExport.js` |
| T28 | partial | PR1 authorized recovery on optional sync failure, idempotent retry, fresh authorization and account-change races tested; original incident inputs remain unavailable. `dfsEntryExportSession.test.js; dfs_portfolio_browser.mjs; dfs_rebuild_browser.mjs` |
| T29 | partial | Bounded version-1 backups and browser drafts preserve native rules and applied-plan manifests with no regeneration. Compact content references remain a stage-1 gap. `dfsPortfolioBackup.test.js; dfsLocalDraft.test.js; dfs_guardrails_tasks.mjs; dfs_portfolio_browser.mjs` |
| T30 | partial | Frozen ordering/metadata retained; real platform readback/incident file unavailable. `dfsPortfolioBackup.test.js; dfsEntryRecovery.test.js (new)` |
| T31 | planned_gated | Late swap disabled; pre-lock tests cannot prove exact started-slot immutability. `Phase 8; explicit gate test in dfsEntryRecovery.test.js` |
| T32 | partial | Refresh preserves build, hidden polling exists; cancel/versioned update diff remains. `tests/test_dfs_freshness.py; tests/test_dfs_refresh_ticker.py; phase 3` |
| T33 | partial | PR2 pair/core/stack/plan tasks pass four widths/two themes plus scoped inspected screenshots. Existing keyboard/focus tasks pass; full accessibility and broader Fantasy/Projections contexts were not evaluated. `dfs_rebuild_browser.mjs --guardrails-only; dfs_rebuild_browser.mjs; layout_audit.mjs` |
| T34 | partial | PR2 verifies pair/core editing, exact stacks, atomic plan replacement and audited export/recovery. Full role recommendation and portfolio replacement journey remains phases 3–4. `dfs_guardrails_tasks.mjs; docs/reviews/dfs-portfolio-guardrails/README.md` |
| T35 | partial | Native rules and requested/applied plan manifests are frozen in build/backup settings; original-input export audits are retained. Complete rule/model/field/solver hashes and decision intent remain. `dfsBuildPlans.test.js; dfsPortfolioBackup.test.js; test_dfs_snapshots.py; test_api_lineup.py` |
| T36 | planned_gated | No validated contest-aware objective/risk/top-finish selector exists. `Phases 6/7` |
