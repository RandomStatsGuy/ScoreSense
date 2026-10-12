# ScoreSense — Showdown decision integrity and projection diagnostics

**Single-PR implementation plan · version 0.2.1 · 2026-10-12**

**Deliverable:** one cohesive draft PR, not another optimizer rewrite. Add transparent scoring, Captain correlation controls, injury/role provenance and reproducible diagnostics to the existing Showdown path. Fix demonstrable input-wiring defects found by the diagnostic, not individual players' numbers by decree.

**Evidence status:** selected repository files and the audit's public sources were checked. No authenticated browser session, complete 20-lineup BUF–LAR export, original build manifest, model artifacts or independent backtest was available for this review. No code, deployed settings or contest entries were changed. The pasted external review is a user-provided observation, not an independently reproduced test report.

## 1. Agent assignment and boundaries

Read AGENTS.md, current docs/PRODUCT.md, applicable project instructions and the matching living-surface entry before editing. Reinspect the current branch, other agents' work and current tests. The inspected master commit was `98ce4b2c55a3fad3780a6e2e56e7b48ccb3ac24b`; do not assume it is still the latest or that the deployed build equals it.

Implement the four connected work packages below in one draft PR. Use separate logical commits for contracts/diagnostics, solver controls, presentation, and verification. Preserve Classic, other formats, entry exports, account isolation, snapshots, recovery, exposure behavior and existing research capabilities. Do not merge, deploy, purchase data, submit entries or alter live lineups. Do not launch production retraining.

This is a Showdown extension, not an instruction to re-run the entire v0.2.0 Classic roadmap. That earlier specification explicitly deferred Showdown strategy. Several Classic/global/research components now exist; reuse compatible infrastructure instead of rebuilding it.

### In scope

- Truthful, consistently computed displayed scores and their semantics.
- Configurable WR/TE Captain–own-QB pairing, with solver and independent validation support.
- Nonblocking, format-aware construction warnings and clearly recorded policy exceptions.
- Consistent build-time/current injury display and a projection/role provenance inspector.
- Frozen, bounded counterfactual comparisons explaining omitted players and fragile combinations.
- Reproduction of forecast inputs and targeted fixes for demonstrable stale/mismatched/double-applied data.
- An offline calibration diagnostic using real archived forecasts when available; synthetic fixtures test calculations only.
- Tests and a polished extension of the approved Build → Review → Download flow.

### Out of scope

A new trained role model; automatic medical/workload probabilities; arbitrary injury multipliers; a new joint NFL simulator; a fitted opponent field; live contest-profit optimization; data-provider purchases; broad backend refactoring; Classic feature duplication; automated site entry; platform late-swap support. Those remain separate model-development work, even though their future interfaces should not be obstructed here.

Do not label a warning-only feature, a hand-authored scenario or a sum of individual quantiles as a calibrated solution to correlated outcomes.

## 2. Verification of the external review

### Confirmed from code

1. `src/products/lineup_optimizer.py` maps `ceiling` to individual High (P90) values and sums those values, applying the Captain multiplier once. It does not calculate a joint lineup percentile. The existing comparison API already declares that limitation. This is a heuristic limitation and a presentation issue, not proof of an arithmetic bug or proof that every resulting lineup is bad. [R01, R02]
2. `frontend/src/DfsWorkspace.jsx` renders the lineup-list number by summing row `proj` values and labeling it simply `pts`. In a ceiling build, that is a different statistic from the optimization objective. The selected roster and comparison roster display names, teams/positions and salaries, but do not render their available injury-status fields. [R03, R04]
3. The inspected Captain solver has roster, salary, unique-athlete, team and generic constraints but no receiver-Captain/own-QB implication. The frontend disables legacy Classic stack arguments in Captain mode. Captain comparison deliberately clears portfolio settings; new *single-lineup strategy rules* must not be cleared with them. [R01, R05]
4. Injury-opportunity infrastructure already exists. Its inspected own-status overlay explicitly assumes active and returns no own-status points deduction. A questionable player's displayed figure can therefore be conditional on playing. This does not establish that the specific reported pool used this path or had the correct team redistribution. Trace the actual build. [R06]
5. Current product instructions approve Build → Review → Download, with advanced/research areas closed initially. Do not revert to the older three-column layout merely because v0.2.0 recorded it. [R07]

### Supported by external sources, with limits

- DraftKings' cited article supplies the reported usage figures: Higbee 73% route participation and 16% target share; Ty Johnson 41% and 10.2%. These are recent-window descriptions, not validated next-game forecasts or optimal exposure recommendations. [W01]
- The official Bills report identifies Palmer out, Moore questionable and Bell expected to make his debut. Its publication date matters; it is not an always-current availability feed. [W02]
- Footballguys displays Shakir 13.15, Coleman 12.33 and Moore 4.88 as its Proj values. The review's comparisons accurately quote those displayed numbers, but the ScoreSense figures were not independently reproduced here. Footballguys' displayed Proj is not labeled P50 in the retrieved table. Do not assume equal estimands or equal injury conditioning. [W03]
- The Bills' Shakir log supports seven catches for 82 yards in Week 4. Hawes' primary player page supports zero receptions and a team video description discusses blocking. His situational page returned missing data; missing is not zero. [W04, W05, W06]
- The retrieved Corum NFL log did not expose the relevant statistics. Treat the quoted five carries/one catch as not independently reproduced here. The exact 20-lineup legality, exposures, differences, player exclusions and six-of-twelve Captain pairings are also report-derived until the actual build is obtained. [W07]

### Judgments that should NOT become automatic fixes

- Zero Shakir exposure warrants inspection; it does not prove the optimizer is wrong. Check eligibility, overrides, statistic type, timestamps, salary, P90, constraints, Captain limits and candidate search.
- Do not replace ScoreSense predictions with a single vendor or require players solely because another model projects them higher.
- Higbee Captain in eight of twenty is 40% Captain exposure. If total exposure is twelve of twenty (60%), FLEX-only appearances are four of twenty (20%), not another 60%.
- Low-priced players can improve an entire lineup by enabling expensive players. Zero receiving history is not a universal ban, and low-volume players require uncertainty rather than invented certainty.
- Two same-team backs or an offense opposite DST is not intrinsically illegal. Showdown has only two teams. Default warnings can be useful; a blanket rule banning all players facing rostered DST would destroy legal combinations.
- A receiver Captain without his QB can be rational under salary and scoring tradeoffs. A default pairing rule is a configurable strategy policy, not a platform rule or a proven guarantee.
- Lineup #20 in the report is a strong stress-test case, not proven mathematically impossible. The combination of backup RB Captain, another same-team RB, same-team QB/receiver and opposing DST merits explicit review.
- The user did not supply ownership/contest-return evidence sufficient to prove any player's ideal exposure. Do not add guessed ownership or a novelty penalty.

## 3. Work package A — score and input integrity

### A1. One scoring contract

Preserve legacy response compatibility while adding explicit score metadata. Suggested fields (adapt names to established contracts):

```text
objective_key
objective_label
objective_score
objective_units
objective_semantics
projection_sum
projection_statistic          # median, mean, point_estimate, mixed, unknown
score_system_id
captain_multiplier_applied
forecast_snapshot_id
injury_snapshot_id
availability_conditioning    # conditional_active, scenario_mixture, user_scenario, unknown
solver_status
```

Use the same pure scoring helper/contract in Build, Review, Captain comparison, details CSV and saved diagnostics. Backend values must agree with independently recomputed values within the declared precision. Do not double-apply Captain scoring or salary premiums. The current solver already multiplies Captain `proj`; renderer logic must respect that.

When the goal is ceiling, present **P90-input score** and separately **Projection sum**. Explain once: “Adds each player's P90 input, including the Captain multiplier. Not a predicted lineup percentile.” When the projection is P50, call its sum a sum of player medians, not expected points or a lineup median. A sum of modeled means may be labeled expected points only under compatible scoring/conditioning. Imported unknown point estimates retain that unknown semantic label. Value-objective scores have their own units and must not be labeled fantasy points.

Do not silently change the user's selected objective, remove legacy ceiling mode or add a new default numeric blend to manufacture a better-looking set. For a new diagnostic, show which metric actually ranked alternatives. A bounded solve is not a proof over every legal portfolio.

### A2. Reproduce the suspect forecast chain

Produce an account-safe diagnostic for each relevant player in the pinned slate: canonical/provider/slate IDs; model and source type; actual forecast/data timestamps; observed period; raw point/quantile values; score-system and Captain/FLEX basis; active conditioning; own-status adjustment; teammate opportunity adjustment; scenario/driver IDs; imported overrides; current eligibility/exclusion reason; and final solver coefficient.

Trace the case players Shakir, Coleman and Moore, plus Higbee, Johnson, Knox, Corum, Hawes and Bell **as test subjects, never hardcoded production logic**. Inspect:

1. Correct season/week and pregame cutoff, not a previous slate or later outcomes.
2. Identity mapping and team aliases; no collision or role-row substitution.
3. Cached pool selection, freshness and injury snapshot dependencies.
4. Whether an adjustment is already embedded in baseline inputs and gets applied again.
5. Whether model, roster estimate and imported projection rows use compatible units and conditioning.
6. Whether observed targets/routes are being mistaken for current expected role.
7. Whether recent team changes are represented, stale or unmodeled.

Fix a demonstrated loading, joining, invalidation or composition defect and add a regression test. If a difference is model error rather than a reproducible software defect, document it and leave a separate modeling task; do not tune a player's output to tonight's desired lineup.

Keep any future full/limited/out scenario forecast distinct from the current active-conditioned baseline. A status tag alone cannot provide scenario probabilities or route projections. Existing adjustments are not proof of coherent whole-team target allocation. Unknown numeric components stay unknown.

## 4. Work package B — Showdown construction controls

### B1. Captain–quarterback pairing

Add a clearly named control under existing Advanced rules:

**WR/TE Captain with own quarterback: Require / Warn / Off.**

Proposed policy: Require for *new* DraftKings Showdown configurations, explicitly labeled as a strategy default. Existing snapshots/imports with no such key retain legacy behavior and receive review advice rather than silently changing history. The user can choose Warn or Off without a false platform-illegality warning.

For receiver i and the verified eligible quarterback set Q(team(i)), enforce:

```text
captain_i <= sum(selected_q for q in Q(team(i)))
selected_q = flex_q + captain_q
```

Select Q using verified quarterback-role information, not the first same-team row. Do not satisfy the rule with an arbitrary backup. If no trustworthy pairing identity can be established, expose that blocker or require an explicit user-approved QB choice; do not invent a starter.

Apply the rule during ordinary single/multi Showdown generation and every Captain comparison solve. Independently validate it after solving. Save the resolved policy and QB mapping with the snapshot. Locks and exclusions remain binding. If an exposure cap prevents further valid QB pairings, return a diagnosed shortfall rather than break the rule, quietly exempt the QB or relabel the output complete.

New rules must be propagated through request validation, normalized options, snapshots, comparison-request construction and supported backup paths. Don't accidentally pass Classic-only parameters into Captain mode or strip Showdown rules when dropping portfolio-only limits for a comparison.

### B2. Shared construction audit, not narrative scoring

Return structured findings with stable code, severity, affected canonical IDs, evidence basis, suggested action and whether a user deliberately overrode a policy. Audit every candidate/result, but render compactly.

Initial findings:

- WR/TE Captain without the configured QB.
- QB plus opposing DST, regardless of which is Captain.
- Captain against opposing DST.
- Multiple same-team RBs, especially an RB Captain: describe shared backfield exposure; claim specific rushing-role competition only with supporting role evidence.
- Any selected questionable/limited player and affected teammate dependencies where known.
- Model fallback / unknown current role / stale role evidence; distinguish uncertainty from confirmed zero.
- Multiple selected values relying on the same unresolved personnel assumption.
- High Captain concentration as a displayed count and share, not an arbitrary universal percentage violation.

QB/DST, same-team RB and low-volume flags are **warnings by default in this Showdown PR**. Do not import the Classic default QB/DST prohibition into all formats. Users may exclude a specific pair using supported explicit controls; extending a general group language is not required here.

A warning does not automatically change objective coefficients. No hardcoded “Corum penalty,” no salary-based punt ban, no guessed negative-correlation coefficient. Platform validity and user-selected hard strategy controls remain separate from warnings.

### B3. Exposure reporting

Show Total, Captain and FLEX-only appearances using the actual generated denominator:

```text
total_appearances = captain_appearances + flex_appearances
```

Retain existing total/Captain limit semantics and clearly mark any legacy lock exemptions; do not quietly change the entire portfolio solver in this PR. Show pair counts relevant to warnings. A Captain comparison is one constrained lineup at a time, not evidence about portfolio-wide exposure compliance.

## 5. Work package C — useful review and counterfactuals

### C1. Preserve the approved design

Current approved direction is **Build → Review → Download**, not the superseded three-column workspace. Reuse existing tokens, typography, disclosures, mobile rules and copy modules. No new hero, nested dashboard or bright warning borders on every player.

Build keeps count, honest scoring goal and the primary action. Advanced Showdown settings remain in the existing disclosure, with a short visible summary when a nondefault exception is active.

Review keeps the selected roster legible. Show status beside the player's name, including Captain, and keep a small source/role detail disclosure. Show one summary such as “6 lineups need review” only when the audit actually reports six; clicking filters to those lineups. Group recurring warnings instead of repeating a paragraph in every row. Use text/icons as well as color. Do not turn unknown data into alarming red invalidity.

Separate **At build: Questionable** from **Latest: Active / Out / Unknown** with timestamps. Freshness checks may stage an update; they must not mutate saved inputs, historical scores, the selected roster or accepted-entry state. Current confirmed inactivity must flow through the existing readiness/export checks; a historical lineup remains inspectable as history.

### C2. Role evidence without fabricated explanations

Reuse verified permitted evidence when available: routes, denominator, targets, carries, scoring-area usage, observed period and source. Distinguish observed usage from projected role. If role data are absent, say “Current role estimate unavailable.” If p_zero was not modeled, do not display a calculated-looking zero probability.

A player's inclusion explanation starts with what is known: lock, Captain choice, selected objective coefficient, salary, enforced rules and snapshot. Do not say “selected because the model expects more routes” unless the model actually used that feature and its contribution is supported.

### C3. Bounded “Compare with this player”

Extend existing complete-lineup comparison primitives rather than creating another optimizer:

- User selects a player and Include in FLEX or Use as Captain.
- Compare a baseline and forced-player completion on the same frozen input snapshot, salary constraints, supported hard rules and objective.
- Report replacement players, salary used/left, projection sum, objective score and new/removed warnings.
- Keep player exclusions and incompatible Captain locks; report the conflict rather than override them.
- Distinguish infeasible, timeout/unresolved, feasible and proved optimum according to the actual solver result.
- Preserve current saved lineups. Applying any replacement remains a separate explicitly confirmed operation, subject to the existing portfolio/entry checks; read-only comparison is sufficient for this PR.
- Bound the work, support cancellation semantics honestly and reject stale responses after input/account changes.

This gives a useful answer to “Why no Shakir?” without pretending we have recovered the exact cause of a portfolio-level omission. Label single-lineup comparisons as such; they do not reproduce a constrained 20-lineup or 150-lineup portfolio selection. Include known player/captain caps and filters in the diagnostic context.

## 6. Work package D — measurement and regression coverage

### D1. Quantile/zero diagnostics, not a new calibration claim

Add or extend a small offline report from archived pre-lock forecasts plus official completed-game outcomes. Record model/source, role and salary buckets, active conditioning, source window and sample counts. Report mean error only for actual means, median error/pinball loss for P50, and quantile coverage/pinball loss for P10/P90.

For discrete low-volume outcomes, do not demand exactly 10% of results exceed P90. A valid quantile satisfies `P(Y < q_tau) <= tau <= P(Y <= q_tau)`; report ties/mass at the threshold. Do not infer a zero probability from three quantiles. Report zero-score frequency versus predicted zero probability only where that probability exists, with Brier score and appropriate sample-size uncertainty. Zero opportunities, zero receptions and zero fantasy points are different events.

No current game's final result or a later corrected feed may leak into a pregame benchmark. Hold out later weeks, group uncertainty by slate/week, and keep new model fitting outside this PR. If archived forecasts or outcomes are unavailable, produce a coverage report, not a fictitious validation result. Synthetic fixtures establish code correctness only.

### D2. Required acceptance tests

1. Objective=ceiling: Review score equals the Captain-weighted P90-input sum; projection sum is separately labeled and different where appropriate.
2. Objective=median/value: labels and units are correct; neither sum is called a lineup quantile or expected payout.
3. Captain multiplier applied exactly once for projection, objective, salary and diagnostic comparisons.
4. Known Q/D/out/IR/status variants survive pool → solver result → selected roster → comparison → saved review, with unknown remaining distinct.
5. Original build status/timestamp stays immutable after a later status update; changes stage explicitly.
6. Receiver Captain policy Require includes its verified QB or returns a diagnosed conflict; Warn/Off leave legal alternatives available.
7. A backup QB cannot accidentally satisfy a verified-starter pairing. Missing mapping is explicit.
8. Pairing propagates into every Captain comparison; legacy portfolio-only settings remain correctly excluded.
9. Locks/exclusions/total and Captain caps interact without silent exemptions, changed counts or changed hard rules.
10. Same-team RB and QB/opponent-DST findings are correct; Showdown warnings do not ban every cross-team offense/DST pairing.
11. Total/Captain/FLEX exposure math includes all actual lineups; 12 total and 8 Captain of 20 reports 60%, 40%, 20% respectively.
12. Imported historical snapshots lacking new strategy keys retain legacy settings; new defaults don't rewrite them.
13. Identical input snapshot + deterministic controls reproduce comparison scores and player identities.
14. Forced-player comparisons retain exclusions, report genuine tradeoffs, and cannot mutate the current build or portfolio.
15. Any reproduced identity/staleness/overlay defect has a red test and targeted correction; a vendor discrepancy alone is not a defect fixture.
16. Missing role data, missing zero probabilities and unspecified vendor statistic types stay unavailable; no zero fill, invented targets or implied mean/P50 equality.
17. Offline calibration correctly handles discrete quantile ties, conditional-active denominators, missing outcomes and known-at cutoffs.
18. Existing Classic/native global controls, Showdown identity (Captain + unordered FLEX), reserved-entry export, backups and account boundaries remain passing.
19. Responsive review at 390, 768 and 1280 widths; keyboard/focus/status announcements; light/dark; no inaccessible tooltip-only status or horizontal overflow. Honor current repository visual-testing instructions and say not visually verified when actual visual checks were unavailable.
20. One fixture-led browser path: load a Showdown slate, select goal, enable pairing, build, inspect a warning, compare an omitted player, save/reopen review and reach the unchanged supported export path. Keep an existing usable result after errors/cancellation.

Obtain the actual twenty-lineup artifact through the user's permitted export or connected build access before asserting its exact counts passed. In its absence use synthetic analogous fixtures named as synthetic, and mark the supplied 20-lineup reproduction pending. Never substitute yesterday's Classic rescue JSON.

## 7. Suggested repository touchpoints

These are inspected entrypoints or paths referenced by inspected code, not permission for a broad refactor. Discover exact tests and child instructions in the checkout.

| Layer | Inspect / extend |
|---|---|
| API & validation | `app/api.py`, `src/products/dfs_validation.py`, existing request normalization |
| Captain solver | `src/products/lineup_optimizer.py` (`_optimize_captain_lineup`, multi generation and snapshot capture) |
| Comparison | `src/products/dfs_captain_comparison.py`, `frontend/src/dfsCaptainComparisonRequest.js` |
| Forecast provenance | `src/projections/dfs_pool.py`, `weekly_cache.py`, `injury_overlay.py`, `src/core/opportunity.py`, existing source/status helpers |
| Workspace | `frontend/src/useDfsBuilder.js`, `DfsWorkspace.jsx`, `DfsCaptainComparison.jsx`, `dfsToolPresentation.js` |
| Reusable diagnostics | existing evidence, shared-outcome and complete-lineup comparison contracts; check format restrictions before reuse |
| Design/docs | `docs/PRODUCT.md`, `frontend/src/livingSurfaces.js`, approved `docs/mockups/dfs-flow-a.html`, existing tokens/styles |

Do not add a second injury model in the frontend. All displayed effective input values must be tied to the server/frozen input contract, with explicit uncertainty about current live state.

## 8. New Showdown rule register — proposed, not implemented

| ID | Requirement | Nature / evidence |
|---|---|---|
| SD-01 | Format-specific strategy rules; never inherit every Classic prohibition into Showdown. | Design safeguard |
| SD-02 | Distinguish optimization score, projection statistic and joint outcome; weight Captain once. | Mathematical semantics + confirmed presentation gap |
| SD-03 | Preserve injury/role provenance and distinguish build-time from latest status. | Confirmed presentation gap + data governance |
| SD-04 | Configurable receiver-Captain/verified-own-QB implication across solve and comparison. | Proposed strategy default, not validated edge |
| SD-05 | Flag shared backfield, opposing-DST and uncertain-role combinations without automatic blanket bans. | Proposed review policy |
| SD-06 | Explain omissions with frozen full-lineup counterfactuals, not guessed solver motivations. | Proposed diagnostic |
| SD-07 | Compare like-for-like forecast semantics/conditioning before declaring a model error. | Data/model governance |
| SD-08 | Evaluate cheap-player zero mass and discrete quantiles with archived, pre-lock evidence. | Proposed validation requirement |

These rules supplement the existing Classic registry. They do not change historical slate exposure allocations or retroactively redefine the observed builds.

## 9. Sources and scope of evidence

Repository source refs are pinned to master `98ce4b2c55a3fad3780a6e2e56e7b48ccb3ac24b`, inspected 2026-10-12:

- R01: https://github.com/RandomStatsGuy/ScoreSense/blob/98ce4b2c55a3fad3780a6e2e56e7b48ccb3ac24b/src/products/lineup_optimizer.py — selected pool/solver/Captain sections.
- R02: https://github.com/RandomStatsGuy/ScoreSense/blob/98ce4b2c55a3fad3780a6e2e56e7b48ccb3ac24b/src/products/dfs_captain_comparison.py — full comparison implementation.
- R03: https://github.com/RandomStatsGuy/ScoreSense/blob/98ce4b2c55a3fad3780a6e2e56e7b48ccb3ac24b/frontend/src/DfsWorkspace.jsx — selected Build/Review code.
- R04: https://github.com/RandomStatsGuy/ScoreSense/blob/98ce4b2c55a3fad3780a6e2e56e7b48ccb3ac24b/frontend/src/DfsCaptainComparison.jsx — full component.
- R05: https://github.com/RandomStatsGuy/ScoreSense/blob/98ce4b2c55a3fad3780a6e2e56e7b48ccb3ac24b/frontend/src/useDfsBuilder.js and `dfsCaptainComparisonRequest.js` — request excerpts retrieved through repository code search; agent must read full current functions.
- R06: https://github.com/RandomStatsGuy/ScoreSense/blob/98ce4b2c55a3fad3780a6e2e56e7b48ccb3ac24b/src/projections/injury_overlay.py — active-conditioning declaration and own-status function; also inspected `src/projections/dfs_pool.py`.
- R07: https://github.com/RandomStatsGuy/ScoreSense/blob/98ce4b2c55a3fad3780a6e2e56e7b48ccb3ac24b/docs/PRODUCT.md — approved October 12 guided flow and current DFS feature boundaries.

Public source checks, retrieved 2026-10-12. These are evidence checks, not licensed production feeds:

- W01: https://dknetwork.draftkings.com/2026/10/12/rams-vs-bills-nfl-dfs-value-picks-for-monday-night-football/
- W02: https://www.buffalobills.com/news/buffalo-bills-injury-report-vs-rams-week-5
- W03: https://www.footballguys.com/dfs/showdown/optimizer/week-5-bills-at-rams-draftkings
- W04: https://www.buffalobills.com/team/players-roster/khalil-shakir/
- W05: https://www.buffalobills.com/team/players-roster/jackson-hawes/ and `/career` (the `/situational/` page did not provide a numeric result).
- W06: https://www.buffalobills.com/video/jackson-hawes-increased-role-at-te-chemistry-with-the-o-line-and-highmark-stadium-impressions — description, not an independently watched video.
- W07: https://www.nfl.com/players/blake-corum/stats/logs/ — underlying relevant rows unavailable in retrieved view.

User-provided source: the pasted BUF–LAR audit in this conversation. Its exact 20-lineup percentages, lineup numbers, ScoreSense point values and live UI observations remain reported unless independently reproduced. No game outcomes were used to decide these requirements.

## 10. PR completion and handoff

Deliver one draft PR titled **Showdown decision integrity: scoring, Captain pairing and projection review**. Include a brief confirmed-vs-unconfirmed findings matrix, code/tests, before/after task behavior, actual test output, data dependencies, any unresolved forecast discrepancy and screenshots/layout results consistent with project rules.

The PR succeeds by making the feature more coherent and diagnosable and correcting proven defects. It does not claim a fully calibrated tournament model, force the supplied audit's favorite players into outputs, or certify a profitable exposure distribution.

**Agent instruction:** implement this scoped plan in the existing project. Save this document under docs/reviews or the established DFS docs location. Begin with reproduction and input tracing, then implement the connected contracts, controls and review UI. Keep the original feature operational. Do not stop at a second proposal. Do not merge or deploy.
