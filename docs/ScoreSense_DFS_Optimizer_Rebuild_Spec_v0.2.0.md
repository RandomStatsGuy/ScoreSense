# ScoreSense DFS — Optimizer Rebuild and Product Specification

**Version 0.2.0 · 2026-10-11 · Agent implementation handoff**  
**Primary scope:** NFL Classic/main-slate GPPs; single-entry through the selected contest's maximum, including 150-entry builds. Preserve Showdown behavior; its strategy and scoring are a separately gated adapter, not part of this Classic implementation.  
**Status:** Consolidated requirements and proposed statistical design. This file is not an implemented optimizer, a successful backtest, or a guarantee of profitable or perfect lineups.

## 0. Start here: the assignment to the coding agent

Implement an end-to-end, contest-aware DFS decision and portfolio workflow **inside the existing ScoreSense product**. Reuse working components, improve the generator and selection layers incrementally, and fix the export/recovery path. “Rebuild” means replacing weak decision logic and removing manual coordination—not deleting the app and starting a second DFS product.

Read `AGENTS.md`, `docs/PRODUCT.md`, the matching `frontend/src/livingSurfaces.js` entry, and the applicable `.cursor/rules/*` before editing. Reinspect the current branch, open PRs, tests, dependencies and uncommitted changes. The repository's explicit product approvals govern appearance; this document supplies DFS requirements and proposed workflow extensions. Resolve conflicts explicitly rather than silently overriding approved designs. Update product documentation and the living-surface registry with any approved new interaction.

Deliver in bounded, reviewable PRs with regression tests, implementation notes, migrations only when necessary, benchmarks and truthful visual-validation results. Keep PRs draft under the repository's cost policy until the user requests otherwise. Do not merge, deploy, purchase data, run paid external research, submit entries, change active lineups, or retrain production models merely because this document exists.

**First deliverable:** a short current-state gap map, a red/green regression baseline and PR 1 implementation. Do not stop at another architecture essay. Subsequent stages must have concrete code and tests, not placeholder APIs presented as finished features. A missing dependency should produce an explicit capability gate while independent correctness/UI work continues.

### The end-state user journey

1. Select the exact slate and, when available, import the actual contest/entry template.
2. Review suggested quarterback-game candidates, their passing opportunities, ownership assumptions and omitted-game challengers.
3. Review recommended player combinations and adjust player/pair/core targets without rewriting projections or manually juggling batches.
4. Generate the requested portfolio, inspect actual exposures and flagged constructions, and approve any replacement/rebalance.
5. Download the correct entry-update CSV and a recoverable backup; reconcile a platform readback when supplied.

The default path must be straightforward. Advanced modeling and controls belong in disclosures. The interface should explain what changed and what needs a decision, not display every intermediate statistic.

### What “optimized” means

A lineup can be optimal **for a specified mathematical objective, input snapshot, candidate universe and constraint set**. That does not make it the eventual highest-scoring lineup. Report a solver's proven optimal result separately from a feasible time-limited result and separately from forecast uncertainty. A candidate-pool optimum is not an optimum over every legal lineup. [R10]

The eventual tournament objective is contest-specific, tie-adjusted expected payout with explicit user risk constraints. Display probability of at least one major finish separately. An optional maximize-first-place mode is a different objective, not a cosmetic risk slider. The sources support investigating these formulations, not asserting ScoreSense has a validated edge. [R08, R09]

**No UI claim of “perfect,” “guaranteed winner,” “validated tournament edge,” or “expected profit” without the capability and evidence required below.** Legal lineups, attractive football narratives and mathematically solved programs are different achievements.

## 1. Evidence, current architecture and what happened in this build

### 1.1 Grounded repository snapshot

Selected files were read at master commit `572522857090adf7755535666c3aa478de898c5f` on 2026-10-11. This is a limited source/documentation review, not a full code audit or independent test run. The implementation agent must refresh this inventory before editing. [R01–R05]

Relevant existing paths:

| Area | Existing starting points | Preserve / inspect |
|---|---|---|
| Builder and API | `frontend/src/useDfsBuilder.js`, `frontend/src/LineupOptimizer.jsx`, `app/api.py`, `src/products/lineup_optimizer.py` | Current request contracts, locks/exclusions, batch counts, independent legality checks and baseline objectives |
| Workspace and copy | `frontend/src/DfsWorkspace.jsx`, `DfsPortfolio.jsx`, `dfsToolPresentation.js`, `styles/dfs-workspace.css` | Approved compact workspace, existing control patterns and copy modules |
| Portfolio | `frontend/src/dfsPortfolio.js`, related tests and backup/restore implementation | Detached original inputs, compatibility checks, actual counts and visible duplicates |
| Export | `frontend/src/dfsExport.js`, `dfsEntryExport.js`, workspace integration | Library CSV versus entry-update CSV; original entry metadata and eligibility |
| Results / provenance | `frontend/src/DfsResults.jsx`, existing build/salary-snapshot/result modules | Account-scoped entries and build history; recorded, not assumed, submission state |
| Forecasts and jobs | `src/projections/`, `src/jobs/`, existing shared CPU worker and prepared artifacts | Cached reads; no model fitting/ETL on ordinary page visits; isolated live-scoring work |
| Design references | `docs/PRODUCT.md`, `docs/mockups/dfs-gpp-a.html`, `frontend/src/livingSurfaces.js`, shared tokens | Explicit DFS layout takes priority over generic hero templates |

The current product documentation records portfolio backup/restore as present. Do not reimplement it on the assumption that the earlier v0.1.3 session-only limitation still applies. Inspect whether real round trips and authenticated export work. The user reported an export failure despite the presence of the feature. The failure's exact root cause has **not** been diagnosed in this handoff. [R03]

The foundation documentation says legacy objectives sum individual P50/P10/P90/value inputs; it distinguishes these from means, lineup quantiles and joint simulations. Treat that as a compatibility baseline to inspect, not a tournament-return model. [R05]

### 1.2 Recomputed incident facts—not postgame conclusions

The complete `scoresense-portfolio-rescue.json` was parsed again for this handoff. It contains 150 unique lineups across 13 batches. Its role here is a reproducible workflow/structure example, not evidence about actual game outcomes. `incident_audit.json` contains the aggregate checks and source hashes. [F02]

| Observation in the recovered original | Interpretation / required response |
|---|---|
| 150 unique nine-player lineups | Preserve this successful recovery and stable ordering; completeness alone does not certify strategy or submission |
| 11 QB-versus-opposing-DST combinations | Add an explicit generation-time strategy safeguard plus final independent audit; legal on the platform is not the same as intended |
| 114 TE-in-FLEX lineups (76%) | Audit positional concentration and compare alternative completions; this is **not** evidence that all two-TE lineups must be banned |
| Aaron Jones and D'Andre Swift each appear 90 times; together 89 times (59.3%) | Individual 60% caps did not meaningfully diversify this pair; require pair/core exposure visibility and optional constraints |
| All 13 recorded batch requests have empty `excluded_player_ids` | Several planning-file exclusions were not transferred into the executed settings; add atomic plan application and plan-versus-actual validation, not blame or an unsupported solver-bug claim |
| Full portfolio recovery was needed after an export failure | Reproduce the actual failure, distinguish conversion/validation from storage/ledger/network problems, and provide a reliable independent recovery path |
| Several differently dated batches share one portfolio | Preserve original inputs for history; evaluate the final working portfolio against one selected decision-time information set, with explicit stale-input treatment |

The six-defense revision is a **separate historical export candidate**. Do not assume it was accepted by DraftKings. The actual accepted entry state requires a platform readback or explicit user confirmation. Do not retroactively rewrite this original incident record.

No scores, ranks, payouts or in-game performance were used to create these requirements. Do not convert this one portfolio or an earlier conversational postmortem into validated training labels.

### 1.3 Controls used that day are not eternal strategy

The 75/25 pace blend, $49,000 minimum salary, 60% batch cap, two-player differences, Proj objective and 55/35/30/15/15 game allocations were working heuristics/configuration. Preserve them as historical inputs and benchmark options, **not fixed requirements for every future slate**. Likewise, the original three-to-four-game focus is optional scope; a fifth challenger was intentionally added. No athlete, team, salary, ownership forecast or game allocation from that day becomes hardcoded production strategy. [F01]

## 2. Capability levels and readiness gates

Use independent capability flags, not a single decorative “ready” chip:

- **Slate/identity/scoring readiness:** exact eligible players, salary, positions, games, rules and source provenance.
- **Forecast readiness:** known mean/quantile semantics, coverage, model version, data age, active/limited/unknown status and score-system compatibility.
- **Combination readiness:** supported opportunity/role estimates; coherent joint outcomes when claimed.
- **Field/contest readiness:** relevant ownership/field model, entrant count, cash payout schedule and tie rules.
- **Export readiness:** current entry template, exact assignment count, structural validity, strategy constraints, current lock checks and account access.

A missing paid route feed should not disable legal lineup generation. A missing player ID or failed roster validation must disable the affected platform export. A missing payout table must disable expected-dollar claims, not replace the unknown table with an invented one.

Provide distinct modes:

| Mode | Available output | Prohibited claim |
|---|---|---|
| Projection-guided | Legal candidates using documented base inputs and explicit rules | Calibrated tournament EV or joint-tail probabilities |
| Opportunity-informed | Role/context adjustments with source evidence and complete-lineup comparisons | Profit guarantees or unvalidated matchup edges |
| Joint-outcome research | Scenario distributions and uncertainty from an experimental model | “Validated” performance before the evaluation gate |
| Contest-aware research / validated | Field/payout evaluation; validated label only for a version meeting preset criteria | Generic MME ownership relabeled as exact contest ownership |

Do not quietly switch from a requested contest-aware objective to a projection sum. Explain unavailable capabilities, offer the supported mode, and require an explicit selection when the objective materially changes.

## 3. Input and identity contracts

The types below are **proposed contracts**, not assertions about endpoints already shipped. Implement through existing modules where appropriate.

### 3.1 SlateSnapshot and ContestProfile

`SlateSnapshot` must include site, sport, format, draft-group/slate ID, exact game IDs, season/week, kickoff timestamps/timezone, eligible roster slots, salary cap, supported scoring version, source records and content hashes. Scope identity by site + sport + format + slate/draftgroup + effective version. A team acronym alone is not a game key.

`ContestProfile` must include selected contest ID, actual name/type, entry fee/currency, intended number of own entries, field-size basis, maximum entries per account, prize schedule including noncash awards, tie policy, lock policy, late-swap capability and as-of time. Distinguish maximum capacity, current entrants and estimated final entrants. Unknown values remain unknown. The user's $0.50 mini-MAX is not the same contest as a Milly Maker merely because both can permit 150 entries.

Do not infer fees/payouts from ranks or a standings file that lacks them. Record settled, void, cancelled and unsettled entries distinctly. Revenue, net and ROI remain descriptive without a verified account ledger and complete financial records.

### 3.2 PlayerIdentity and observations

Store canonical athlete identity separately from PFF ID, nflverse ID and slate-specific DraftKings ID. Preserve aliases and effective team memberships; a player can change teams, and provider abbreviations vary. Resolution priority: verified provider mapping, then unique normalized name + compatible team + position; unresolved/fuzzy candidates require review and do not auto-export. Prevent reused IDs across slates and collisions after suffix cleanup.

Raw observations need provider, source URI/file hash, observed period, event date, source publication time, retrieved time, known-at time, units, counting definition, revision and rights scope. Retain raw fields; normalized values must have explicit transformations. Date filters supplied verbally are metadata claims until supported by the export. Do not modify five-game rows to fit a four-week label or silently average incompatible windows.

PFF-style parsing must distinguish receiving **grade** from receiving **route count**. `targets/routes` is observed target earning. The report's route percentage may divide routes by **the player's own passing snaps**, not all team dropbacks. Never treat those denominators as interchangeable. An annual/aggregate report cannot reconstruct weekly changes by subtraction without reliable matching intervals.

### 3.3 ForecastSnapshot

For each eligible player store mean when actually modeled, median, quantiles, availability scenario, expected workload, score-system identity, role uncertainty, forecast source/version and missing-data reason. Preserve full precision internally. Do not call P50 an expectation; do not call historical `AvgPointsPerGame` a forward forecast. Do not calculate a mean or calibrated joint distribution from three quantiles without declaring/fitting the additional assumptions.

Support user-imported estimates separately from model predictions; preserve original and overridden values, explicit reason and effective period. Do not increase points solely to create exposure. Track whether pace, opponent, market, role or injury features are already embedded so a later adjustment does not count them twice. Injury multipliers may apply once, not again at each candidate or export step.

### 3.4 Availability, freshness and data rights

Keep out/inactive, active, questionable, expected limited and unknown distinct. A blank status is not a verified active signal. An official active designation does not guarantee a full workload. Retain original source values when a newer source supersedes them. Failed refreshes must not empty a usable historical snapshot or label it freshly updated.

Provider rights must be evaluated separately for personal analysis, hosted multiuser ingestion, display, redistribution, model training and sending records to an external model. Consumer downloads do not establish product rights. Use provider-agnostic adapters and permitted public/owned data fallbacks; do not commit the user's paid PFF export, private entries or API credentials as repository fixtures. PFF's current terms require special care here. [R14]

The public nflverse participation and FTN charting feeds have different documented availability and licensing. Do not assume they supply a free complete current-week route/coverage dataset. Verify real coverage and latency; report unavailable fields instead of inventing them. [R12, R13]

## 4. Game selection: keep the pace screen, improve the decision

### 4.1 Exact inherited baseline

For any compatible season and relevant venue plays-for or plays-against input X:

```text
adjusted_X = 0.75 * season_X + 0.25 * venue_X
away_plays_screen = (adjusted_away_for + adjusted_home_against) / 2
home_plays_screen = (adjusted_home_for + adjusted_away_against) / 2
combined_play_screen = away_plays_screen + home_plays_screen
```

Always display the two team values, the combined value, source dates and sample counts. The blend is an **unfitted volume screen**, not pure tempo, a calibrated play projection or proof the betting total is wrong. Season includes venue games; these samples are not independent. Preserve the formula as a reproducible baseline and ablate it against season-only, venue-only and fitted/shrunken models. [F01]

A 125-play screen with a 69/56 split is not a forecast of 62.5 opportunities for both offenses. Choosing a quarterback requires his own team's dropbacks, efficiency and production allocation.

### 4.2 Team opportunity distribution

Develop a coherent count model, initially modest and testable. Retain all-situation volume, neutral tempo, score-state tempo, pass rate over expectation, neutral dropback rate, possession length, opponent plays allowed, situation-dependent run/pass tendencies and drive outcomes as distinct quantities.

Define the modeling universe explicitly: accepted/no-play penalties, sacks, scrambles, spikes, kneels, two-point plays and overtime. A useful declared partition of eligible scrimmage plays is designed runs plus modeled dropbacks; dropbacks partition into sacks, scrambles and pass attempts under that definition. Pass attempts partition into targeted and untargeted attempts. Reconcile official/provider totals with adjustments, rather than assuming one provider uses the same definition everywhere.

Do not multiply an all-situation play screen by a neutral-only dropback rate and call the product a calibrated full-game projection. Use a scenario-adjusted rate or label the result as a rough screen.

Partial pooling should temper tiny venue and personnel samples. A fitted home effect must show held-out improvement beyond the existing base forecast. Weather, roof, travel/rest, game script, offensive line, quarterback and defensive availability are optional supported features—not a checklist of automatic numerical bonuses.

### 4.3 Market information

Use same-book/feed timestamped totals and spreads. Retain opener, defined early-week reference and latest separately, including price when available. A market total represents scoring, not a direct snap count. Downward movement may reflect efficiency, volume or personnel; do not fabricate its cause or label it “sharp money” without evidence.

Combine market-informed priors and football forecasts using fitted, evaluated methods. Do not add a totals boost when the base projection already uses that total. Any explanation that the market may be underestimating a game must specify the mechanism, supporting data and uncertainty; one game going over is not validation.

### 4.4 Challenger screen and allocation

Evaluate plausible quarterback-side candidates across the entire eligible slate **before** applying a narrow game focus. Compare concentrated passing offenses, low-owned but credible combinations, efficient lower-volume games, and games with substantial new role information. Keep a traceable reason for deprioritization, rather than turning the initial pace rank into a permanent exclusion.

A user may restrict primary QB games while leaving complementary players from all games eligible. Suggested game allocation must be revisited after pricing full combinations. Separate:

- games researched;
- games used for candidate generation;
- games receiving primary-QB exposure in the selected portfolio;
- incidental players from other games.

No mandatory fixed count of three, four or five games. When a user imposes a narrow scope, respect it and show the best excluded alternatives and estimated opportunity cost using the supported evaluation mode.

## 5. Player selection: opportunity first, then context and price

### 5.1 Project role within personnel/game scenarios

The interpretable approximation is:

```text
expected_targets_i(s)
  ~= team_dropbacks(s) * route_participation_i(s) * targets_per_route_i(s)
```

Compute within coherent scenarios before averaging. Do not blindly multiply three unconditional averages. Fit/regularize target earning and route participation, retaining uncertainty for small samples and role changes. Reconcile all WR/TE/RB targets, residual receivers and untargeted passes against available attempts. Five receivers may run routes on one play, but only one initial intended target exists; aggregate route counts are not constrained to sum to dropbacks.

Receiver evidence: route opportunities, targets/route, target share, depth distribution, air-yard share, red-zone/end-zone opportunities, alignment, player skill and catchability. Recent touchdowns and yards per target are outcomes, not guaranteed repeatable workload. Without current route data, use a disclosed target-share/count fallback; do not fabricate routes.

QB evidence: passing opportunities, pressure/sacks, scramble probability, designed rushing, red-zone involvement, rushing/passing TD split, and replacement/limited scenarios. A rushing quarterback may support viable unstacked candidates; this must be a consciously evaluated construction, not a default omission of receiving correlation.

RB evidence: carries by situation, goal-line opportunities, routes/targets, two-minute/pass-down work, blocking, committee allocation and team scoring opportunities. A backup promoted to starter is not automatically a slate-winning value. Receiver data alone cannot establish the entire RB pool.

DST evidence: opposing dropbacks/protection, sacks, turnovers, points-allowed distribution, returns and game-state dependence under site scoring. Its value is not merely the cheapest salary that completes a lineup. Missing specialist forecasts need a labeled baseline with uncertainty or an unsupported capability—not hidden fixed upside.

### 5.2 Opportunity quality and matchup

Model the expected fantasy value of projected opportunities by location, depth, outcome probabilities and the exact scoring system. Historical expected fantasy points describe previous opportunities; they are not a forecast of future volume. NFL EPA is a different unit. Touchdowns remain stochastic allocations from team outcomes. [R11]

Matchup features should alter an explicit role, efficiency or uncertainty component. Receiver alignment and route family interact with a mixture of coverage situations; avoid a simplistic full-game WR-versus-one-CB assignment. Pressure can produce sacks or extra blocking as well as shorter throws. Test incremental benefit over the role and base model; do not give arbitrary “good matchup” points.

Use inactive/limited/normal states to redistribute opportunities across the entire offense. Some vacated production may disappear rather than transfer one-for-one. Active/inactive splits must be shrinkage-aware and acknowledge simultaneous quarterback/scheme changes.

### 5.3 Full-lineup marginal attachment test

For each viable QB evaluate one-attachment and supported two-attachment constructions, receiving-RB alternatives, with/without an opposing player, and supported larger groups. Generate multiple feasible completions for each. Judge the optional receiver by the resulting **complete nine-player roster**, not his team logo or correlation alone.

A target-earning star may remain the best play even when popular. A cheap low-owned tight end needs a workload, touchdown-role or whole-lineup salary argument. Low ownership does not manufacture a ceiling. Do not impose a permanent minimum target count as a universal ban.

Explain each core with a short evidence card: expected opportunities; plausible successful scenario; principal alternative; cost elsewhere; uncertainty; and failure condition. Keep historical raw role statistics separate from forward estimates.

## 6. Candidate generation and strategy constraints

Reuse the present solver as a generator behind an interface. Do not assume repeated deterministic optimization with exposure exhaustion selects the best 150 together. It can repeatedly use the same supporting pair early, then abruptly exclude them late.

Generate a wider candidate pool, using a declared compute budget, diverse supported cores, scenario-conditioned objectives and controlled search methods. Candidate counts are configurable and benchmarked; “more samples” is not itself a quality proof. Bounded re-search should focus on underrepresented valid alternatives. Include a comparable-budget unrestricted baseline so a heavily curated pool can be challenged.

### 6.1 Hard rules versus strategy controls

**Hard platform/data invariants:** exact slate membership and IDs, roster slots/positions, no duplicate athlete within a lineup, salary cap, site team/game requirements, current lock rules, valid schema and account access. Never relax these to fill the requested count.

**Explicit strategy constraints:** player/group locks and exclusions; min/max appearances; exact or minimum stack size; pair limits; prohibited QB/opposing-DST pairing; user-selected game scope. Enforce what the user actually requested and report infeasibility. A disclosed, approved change is required before relaxing a hard strategy constraint.

**Preferences:** soft exposure targets, preferred cores, salary-use preferences, optional lineup-difference preferences and risk posture. Preserve them as preferences, measure deviations, and make them distinguishable from hard locks.

### 6.2 Precise stack semantics

Represent `minimum`, `maximum`, `exact`, `optional`, and `forbidden` distinctly. QB +1 minimum is not exactly one receiver. An optional bring-back neither requires nor bans an opponent. A locked opposing player already satisfies an applicable bring-back constraint; do not add another accidentally.

Allow supported receiving RBs as attachments in the role-aware model; an RB should not qualify merely by position when the explicit rule requests a receiving attachment. Define whether a locked receiver counts toward a group and whether defense is excluded from “opposing offensive player.” Preserve actual slots separately from athlete identity.

Named plans must be imported/applied atomically, replacing the previous batch's locks/exclusions/schedule after a preview. A plan-versus-applied manifest must catch missing exclusions before Build. Human labels are not reliable identifiers: in the historical file, `CIN-C` meant a different core from an earlier planning label. Resolve by immutable rule IDs and actual player IDs.

### 6.3 Negative correlation defaults

Default Classic GPP generation should block QB with the DST opposing that QB. This is a **configurable strategy safeguard**, not a DraftKings legality rule or a theorem that the pairing can never win. An advanced explicit override must be recorded. Unknown opponent identity prevents that check from being silently marked passed.

Audit other offense-versus-DST combinations, particularly opposing stacked receivers, with appropriate warnings and model evaluation. Do not universally ban every offensive player facing the chosen DST without testing; the scoring relationship can be more nuanced. The independent final validator must check this policy separately from roster legality.

### 6.4 Salary and FLEX policy

Keep the full platform maximum available. Do not lower $50,000 to $49,800 solely to force uniqueness, and do not force exactly $50,000. A minimum-spend filter is optional, can be disabled, and must be justified through feasible full-lineup quality. The previous $49,000 floor is a historical preset, not a fitted rule.

Do not fill salary with inferior players merely to reach a floor. Show the score/utility opportunity cost of user constraints where measurable. Leaving salary does not prove a lineup is unique.

Generate and compare permitted RB/WR/TE FLEX structures. A high TE-FLEX share triggers a review of forecasts, prices and candidate search—not automatic disqualification. Position-specific portfolio ranges may be configured, but the system must not invent an empirically optimal two-TE cap from this single incident.

### 6.5 Deduplication and stable lineups

For pre-lock Classic scoring, a canonical unordered set of nine athlete IDs identifies duplicates, even when WR/FLEX slots differ. Retain alternate slot assignments only for flexibility/legality evaluation; do not count them as different scoring outcomes. Select a valid representative without moving already locked players.

A two-player-difference requirement means at most seven shared athletes for nine-player Classic lineups; define whether applied within a batch or across the selected portfolio. Exact duplicates must be controlled globally. Structural overlap is not a substitute for joint outcome diversification. Explain when user overlap requirements prevent a full count, and never silently repeat rows.

## 7. Joint football outcomes

A coherent simulator should sample shared game state, personnel, possessions/plays, run/dropback decisions, targets/carries, completions, yardage, touchdowns, sacks and turnovers, then derive fantasy scores through the site adapter.

Required properties:

- Targets/completions and passing/receiving production reconcile across QB, selected and unselected receivers, with explicit rare-play treatment.
- Receiver target/TD competition exists inside the positive shared passing environment.
- Defensive sacks/turnovers/return scores derive from the same opposing offensive events, not an independent favorable DST draw.
- QB designed rushes, scrambles, rush TDs and kneels are separate supported processes.
- Rushing/receiving distributions can include zeros, skew, discrete events and injury-limited states. Negative fantasy outcomes remain possible under scoring; indiscriminate nonnegative clipping is wrong.
- Weather, availability and other shared uncertainty affect the right players together, not via unrelated per-player noise.

P10/P50/P90 do not uniquely identify a distribution. Fit a justified marginal/joint model or use a disclosed empirical/scenario approach; do not assume Gaussian fantasy points simply because three quantiles are convenient. Projection jitter is a candidate-search technique, not a calibrated football simulation. Do not add a second correlation bonus after dependence is already present.

Evaluate per-team count identities, marginal interval/quantile coverage, observed covariance and joint upper-tail behavior. Include low-volume and injury scenarios. Generate candidates on one set of random draws, select/tune on another, and assess finalists on untouched draws. Common evaluation draws across alternatives are desirable for paired comparisons; those draws must still be independent of candidate-generation choices.

## 8. Ownership, opponent fields and the actual contest

### 8.1 Ownership is separate from football quality

Store projected versus actual ownership, provider, contest type, site/slate, update time and injury assumptions. Standardize fraction-versus-percent explicitly. Missing ownership is unknown, not 0%. Multi-entry forecasts and single-entry forecasts are not interchangeable; a broad public board is not a certified mini-MAX-specific forecast.

Do not minimize ownership, sum it into a “uniqueness” score, or multiply player percentages to estimate exact stack duplication. Model legal opponent lineups with conditional QB/receiver/bring-back choices, salary use, roster structure and repeated constructions. Check the marginal and joint frequencies against held-out contest exports. [R08]

Model correlated ownership changes following late news. Provider disagreements justify sensitivity analysis; they are not resolved by spurious decimal precision. Do not update predicted player performance merely because ownership rises.

### 8.2 Field size and duplicates

Use the actual contest structure or a disclosed scenario for final field size. Evaluate competitors and our lineups on the same football draw. Sampling a small field and pretending it equals a huge contest distorts extreme ranks and duplicate counts. Use validated scaling/order-statistic methods or a properly represented field; otherwise withhold large-field probabilities.

Represent opponent duplicates with explicit multiplicities. Our own unique-lineup policy and the opponent field's duplicate behavior are separate. Do not eliminate duplicates from the opponent field because our generator forbids them.

### 8.3 Payout arithmetic

For a realized score with `b` entries strictly above it and `m` total tied entries—including own entries—the per-entry cash payout is:

```text
payout_per_tied_entry = sum(prize[r] for r in b+1 ... b+m) / m
```

Ranks outside paid places have zero cash payout. Apply the platform's actual rounding and noncash tie rules through the adapter. Include all our own selected entries when ranking and splitting. A hypothetical tie spanning prizes $100, $50 and $20 pays $170/3 each before platform rounding; two of our entries in that tie receive twice that share, not the entire pot.

For portfolio P and scenarios s:

```text
scenario_net(P,s) = sum(actual_tie_adjusted_payout(l,P,field_s,s) for l in P)
                    - sum(entry_fee(l) for l in P)
expected_net(P) = average_s scenario_net(P,s)
```

Report probability of at least one first-place tie, sole first, top-k, cash and portfolio net-positive separately where estimated reliably. Monte Carlo error, model uncertainty and field uncertainty are different; no observed success in a finite simulation is not proof of zero probability.

## 9. Select the portfolio together

### 9.1 Candidate incidence model

For M candidate lineups and requested N entries, use binary `z_l` indicating selection. Let `a_i,l` be 1 when player i appears in l, `b_ij,l` when a pair appears, and `g_k,l` for the chosen group/core/game definition.

```text
sum_l z_l = N
L_i <= sum_l a_i,l * z_l <= U_i
sum_l b_ij,l * z_l <= U_ij
L_k <= sum_l g_k,l * z_l <= U_k
```

For percentage bounds, use declared rounding: lower = ceil(min_fraction*N), upper = floor(max_fraction*N), with stable decimal arithmetic. Display actual counts. Convert an exact target percentage that cannot yield an integer into an explicit count choice; do not silently round it into a different hard requirement.

All appearances count, including batch and user locks. A global lock requiring N appearances with a maximum below N is a conflict to explain—not an exemption that silently defeats the limit. Overlapping group targets must be checked for feasibility.

Separate a soft target T from a lower/upper bound. A target is a preference with a displayed miss; a minimum is a guarantee if a full feasible result is produced. A lock means every applicable lineup, not “like this player.” Named batch quotas are optional legacy controls; ordinary users should not need 13 separate runs to express a portfolio.

### 9.2 Utility and approximation honesty

Once validated contest-aware estimates exist, maximize expected net under declared risk/strategy constraints. If candidate EV coefficients are evaluated one-at-a-time against a fixed field, linear selection is an approximation: adding our own entries changes rank/tie interactions. Reevaluate the final portfolio jointly and perform supported improvement search or disclose approximation limits.

Diversification does not automatically increase expected dollars. With fixed entry payouts, expectation is additive; diversification changes the distribution, risk and top-finish coverage. Endogenous rank/tie interactions and explicit objectives can change selection. Do not attach an arbitrary correlation penalty and call the result universally better EV.

A user-selected risk penalty may use a clearly defined loss measure such as CVaR of `fees - payouts`. State its units, alpha, weight and effect. A maximize-at-least-one-top-finish mode uses scenario coverage, not sum of individual win probabilities. The research distinction is useful, but its historical results are not ScoreSense results. [R08, R09]

Before the contest-aware gate, select under a disclosed projection/opportunity objective with hard exposure controls, return alternatives and show unavailable metrics. Do not insert arbitrary ownership/pair penalties into projected points without a separate label and validation plan.

### 9.3 Failure and replacement behavior

Return `requested_count`, `selected_count`, unique count, objective mode, solver status, bound/gap when available, constraints applied, remaining violations, candidate count, runtime and a reproducible manifest. “Time limit” is not “infeasible.” Insufficient candidates are not proof that no legal portfolio exists. [R10]

When constraints prevent a complete set, report the conflicting minimums/maximums/groups and propose specific relaxations with their consequences. Never silently lower minima, exceed caps or pad with duplicates. A smaller deliberate export is permitted only after the user changes the intended selected entries/count.

Replacing a lineup must preserve the approved core/locks unless the user relaxes them. Show a before/after preview: changed players, salary, projected score/utility, exposure effects and new/removed warnings. Re-run global checks after replacement. Avoid a greedy one-player swap that improves one issue but violates another.

### 9.4 Pair and structural audit

Show top pairs/cores, RB pairs, TE-FLEX frequency, DST concentration, QB game allocations, injury-assumption groups, salary distribution and actual bring-back/stack size. Pair appearances are counted across any slots. The historical 89/150 RB-pair issue should be visible before export even when both individual caps pass.

No arbitrary pair limit is mandated here. Provide explicit user caps and calibrated recommendations when supported; display their feasible cost. Distinguish repeated talent from repeated exposure to the same role/game-script failure.

## 10. Reliable export, recovery and entry lifecycle

### 10.1 Two separate artifacts and one obvious action

**Lineup-library CSV** contains the site's roster columns and eligible player IDs. **Entry-update CSV** adds the existing Entry IDs and contest metadata from the supplied template. Do not mix these formats. A lineup backup contains neither proof of reservation nor proof of acceptance. The official platform procedure supports editing existing entries through the entry CSV path. [R06]

When valid selected reservations exist, the primary action must say **Download DraftKings entry-update CSV**. “Upload CSV,” “Bulk enter” and “Export” must not be ambiguous ScoreSense buttons that imply submission. Explain that the user uploads the file to DraftKings; this tool does not purchase or submit entries.

### 10.2 Deterministic conversion and metadata preservation

Implement a pure, tested conversion function from approved portfolio + entry template + explicit assignment map + validated slate/lock contract to output bytes and an audit manifest. Preserve Entry ID, Contest ID, contest name, fee, arbitrary extra columns, quoted strings and unrelated rows unless the user explicitly chooses a changed-entries-only export.

DraftKings templates may contain duplicate RB/WR column names, ragged rows, instructions and a side-by-side player catalog. Parse by ordered headers and section positions, not a naive dictionary that loses repeated fields. Accept BOM/CRLF/LF and supported quoted names. Require IDs as strings; never use names alone, float-converted IDs or scientific notation. Detect formula-like text safely without corrupting prescribed template cells.

Selected entries must map one-to-one to the approved output lineups. Do not assign every contest in a downloaded template indiscriminately. The file may contain several contests and unrelated entries. Show selected contest/count and protect untouched rows. Missing eligible-player metadata is unknown readiness; use another verified exact-slate source and record it, or block the affected proof rather than assuming a match.

### 10.3 Do not make nonessential bookkeeping the only route to a valid CSV

Reproduce the reported export failure before choosing its fix. The prior implementation path coupled saving each batch and importing entry-ledger records with downloading a CSV. That is a candidate failure point to investigate, not an established root cause.

Separate structural validation/export from optional provenance synchronization. A storage/ledger timeout should not destroy an already validated local portfolio. Where user-held data are sufficient, offer an explicit local recovery export with **history sync pending** and a deterministic manifest; retry idempotently later. This must not bypass account authorization, required catalog verification, roster rules or locked slots. No server-side object may be read or written merely because an imported ID/hash claims it is owned.

Use idempotent keys for account/site/contest/entry and build/export versions. A retried download must not duplicate fees or ledger rows. A “file created” state is not “uploaded,” and uploaded is not confirmed accepted.

### 10.4 Durable workspace and portable backup

Persist a recoverable working portfolio through refresh/navigation, using existing account-scoped persistence or a clearly scoped local draft. Record saved/unsaved/error state. Manual versioned backup remains available without server writes. Deduplicate repeated immutable catalogs/projection snapshots by content reference inside the package, with all required referenced content included or resolvable through authorized storage. Do not require a giant repeated 17-MB payload as the only recovery format.

Validate import bounds and schemas atomically; reconstruct immutable snapshots; confirm replacement of nonempty work; never implicitly merge. Reset imported cached save IDs and entry assignments; require a fresh entry template. Do not replay imported credentials, URLs, account IDs or executable content. Keep duplicates/limit failures visible and export blocked until addressed.

Recovery order: valid backup JSON; otherwise exact platform IDs from validated lineup export; pasted text only as a last resort with explicit ambiguity resolution. Never guess a missing player based on similar spelling. A rescue reformat does not change player selections without an approved edit manifest.

### 10.5 Pre-lock versus late swap

Keep the current live slate read-only for this rebuild. Future late swap is a separate capability requiring actual accepted entry state, verified live/lock timestamps and exact locked slots. It must never call an ordinary pre-lock rebuild over started players. [R07]

Define `slot_assignment[entry, slot]` and preserve every locked player's ID **in that exact slot**, plus salary consumed. A player in locked WR cannot be moved to FLEX to manufacture flexibility. Eligible late players can be reassigned only among still-unlocked compatible slots. Reject unknown kickoff/lock state rather than guessing. The remaining construction can account for actual scored points and conditional field outcomes only when reliable data exist; do not always label “behind” as a reason for a reckless low-owned swap.

Maintain portfolio/export versions and diffs. A platform readback supersedes the intended CSV as the best record of accepted entries. After stat corrections or results import, do not rewrite the pre-lock forecast or the submitted lineup history.

## 11. Aesthetic design and ease of use — acceptance requirements

This is a product requirement, not a final coat of CSS. The user wants reliable, low-friction decisions and an attractive sports product, not a research terminal.

### 11.1 Respect the actual approved ScoreSense design

`docs/PRODUCT.md` explicitly approves `docs/mockups/dfs-gpp-a.html`: compact title/slate bar, three-column **settings / player pool / selected lineup** workspace, paginated player table, Build/Results navigation and two export paths. It supersedes the older DFS hero/summary and full-page Vegas board. **Do not restore a giant hero, add a fourth top-level product area or replace this with a generic card dashboard.** [R01–R04]

Retain `Projections · Fantasy · Tools`, with DFS under Tools. User-facing “Fantasy,” not “Draft Hub.” Keep shared Results. New research/portfolio controls should be local views/drawers inside the approved workspace; broader navigation changes require a documented product decision.

Use existing design tokens and theme semantics. Classic dark: matte navy surfaces and restrained blue primary action. Light: soft neutral canvas, white surfaces and readable dark text using approved theme tokens. Teal means healthy/saved, amber means attention, red means error/destructive, gold is for awards—not predicted profit. Team accents/headshots may orient the reader; no fake visual certainty. Respect the existing optional account themes and reduced-motion settings without covering functional content. [R02]

Typography and spacing should use the existing token scale. Prefer 14–16px working text; never violate the product's 12px mobile minimum, and keep legal/support requirements at their specified size. Align numeric columns with tabular numerals; show real zeros and unavailable dashes distinctly. Visual hierarchy comes from weight, spacing and surface lift, not a bright border around every panel.

### 11.2 Proposed workspace composition

**Compact slate bar:** site/format, slate identity and kickoff context, contest/count when known, current data age and recoverable-save state. Show 150 as the selected target, not a marketing badge. Keep the user's one obvious next action visible.

**Left settings rail:** count, evaluation mode, game scope, saved strategy and a short constraint summary. Disclose advanced salary/difference/simulation options. Use a labeled count field, not a menu missing a needed count. Keep errors beside Build, not far above a long page.

**Center decision board:** local Players / Combinations / Portfolio views or equivalent approved disclosures. An optional compact Games strip opens the game evidence drawer; do not reintroduce a full-page odds dashboard. Keep sorting and filtering consistent with existing menus.

**Right selected-lineup inspector:** current lineup, salary remaining, projected score with correct semantics, stack visualization, key uncertainties and comparison/replace action. Show one selected lineup at a time; do not render 150 full player cards down the page.

**Bottom/action rail:** before generation, Generate N lineups; after generation, Review portfolio; after validation and entry assignment, Download entry-update CSV. “Download backup” is a quiet secondary action. No success badge implies platform acceptance.

On narrower laptop widths, adapt to two columns or move the inspector below; do not crush three columns into unusable controls. On phone, use compact local navigation and sheets with a safe-area-aware action bar. Forms/names stay left aligned, numeric columns right aligned. No viewport-wide horizontal overflow.

### 11.3 Specific components and interactions

**Game evidence card/drawer:** separate expected team plays, combined screen, neutral tempo, passing tendency, total/spread, ownership context and uncertainty. Explain why included and the strongest excluded alternative. Missing metrics are not zero. A high total or pace rank should not be a green “good game” verdict by itself.

**Player row/inspector:** name, position/team/opponent, salary, correctly labeled forecast, ownership when available, desired versus actual appearances and an actionable status. Detailed routes/target quality/coverage belong in the inspector. Expose one clear reason to include the player and one uncertainty—not a wall of badges.

**Exposure control:** separate Minimum / Target / Maximum, with percentage and count linked to the chosen N. Show `Target 40% = 60 of 150`; show actual `54 of 150`, not a misleading fulfilled target. Explain hard bound versus soft preference. “Use more” changes a target preference, not the athlete's forecast. “Lock everywhere” must be explicit and preview its full scope.

**Combination explorer:** compare complete-lineup alternatives side-by-side with common data and metric scale. Show how adding the second attachment changes the remaining salary and supported utility. Record optional/required/forbidden bring-back semantics in plain language. Batch/core labels are editable explanations, not the only rule representation.

**Portfolio audit:** one summary for requested / generated / selected / unique / assigned counts. Provide Player, Pair/Core, Games and Structure views with bounded tables. Filters should jump directly to affected lineups. Pair warnings show the numerator and denominator, such as `89 of 150 share this RB pair`, without inventing a universally safe percentage.

**Replacement preview:** select affected lineups, keep stated cores, propose alternatives, show global exposure and conflict deltas, then confirm. Undo or restore prior portfolio version. Never silently repair the user's lineup.

**Export review:** identify selected contest and entries, actual player rows, validation state and remaining actions. Importing a salary file where an entries file is required should produce a specific correction message. The output name and primary button must distinguish library versus existing-entry CSV.

### 11.4 State and error design

Required states: initial loading, no slate, invalid import, partial projection coverage, stale-but-usable data, failed refresh, build running, cancelled, partial result, infeasible constraint set, valid portfolio, policy warnings, invalid assignment, save pending, storage failure, recovery export, and acceptance unconfirmed.

Use skeletons and truthful progress. Long-running builds show stage, elapsed time, cancellability and last usable result; do not fabricate a percentage or ETA. A failure preserves edits and last good portfolio. Retry should be scoped and idempotent. New data must not silently replace an active reviewed build; show affected players and allow a deliberate re-evaluation.

A hard blocker must say why and what fixes it beside the disabled action. Ordinary uncertainty should not cover the screen with red warnings. Strategy disagreements are distinct from platform illegality. Errors and notices must not push the primary action offscreen.

### 11.5 Accessibility and performance

Target WCAG 2.2 AA and the stricter existing ScoreSense touch-target convention. The repo's 44px interaction target is a product requirement; WCAG's target-size criterion has its own smaller minimum and exceptions. Use visible focus, keyboard-operable menus/tables/dialogs, text alternatives, semantic headers, named controls, correctly associated errors and restrained live-region announcements. Sticky UI must not obscure the focused control. Respect reduced motion. [R02, R15, R16]

Paginate/window expensive views; never mount every lineup, player, pair and chart at once. Preserve the approved paginated DFS pool rather than replacing it casually with an inconsistent infinite scroller. Offload large JSON/CSV parsing and analysis off the main thread as appropriate; generation belongs in bounded background work, not the render path. Cache by exact input hashes and invalidate narrowly. Pause nonessential polling in hidden tabs.

Proposed performance targets are **engineering goals to benchmark**, not claims already achieved: warm interaction feedback within 100ms; accepted background-job acknowledgement within 1s; normal page navigation must not invoke heavy inference; generation and export measured on declared hardware with candidate/scenario budgets and p50/p95 time/memory. Establish actual production budgets before making latency promises.

### 11.6 Required visual/usability checks

Use the actual production components, not a mock that bypasses validation. Check 390, 768, 1280 and 1440px, both supported color modes and relevant theme tokens. Reuse the existing layout audit and route fixtures. Capture before/after screenshots and inspect when the environment supports it; otherwise say **not visually verified**, including any audit results without conflating them with screenshots.

An experienced fantasy user should be able to complete these tasks without reading internal docs: identify why a game is suggested; set a player to target 40% without changing his forecast; distinguish minimum from maximum; create 150 without 13 manual lock cycles; discover a repeated RB pair; review/replace affected lineups; recover after reload; download the correct reserved-entry file. These are testable tasks, not just aesthetic adjectives.

## 12. Implementation sequence and completion gates

Keep the existing default workflow available behind a feature flag until each replacement passes. Do not break live scoring, Fantasy, single-game builds or unrelated APIs while working on Classic.

| PR stage | Deliverable | Release gate |
|---|---|---|
| **0. Inventory / fixtures** | Current code/data/design map; sanitize historical incident into test fixtures; reproduce export failure; freeze baseline outputs | Explain confirmed versus suspected defects; no fake reproduction |
| **1. Reliable export and recovery** | Pure conversion + correct assignment; resilient provenance synchronization; backup/restore verification; actionable error states | 150-entry round trip, metadata preservation, retry/account checks and browser export flow |
| **2. Global portfolio selection / guardrails** | Native min/target/max exposures; pair/core controls; default QB-opposing-DST block; exact stack semantics; plan application | Feasibility tests; actual-count guarantees; no hidden lock exemption; no silent fill |
| **3. Integrated polished workspace** | Preserve approved layout; progressive controls, portfolio audit, replacement preview and clear export action | End-to-end task tests, responsive/theme/accessibility checks; no dummy metrics |
| **4. Opportunity and game evidence** | Provenance-aware role ledger, inherited pace baseline, team-specific dropbacks, challenger review, supported full-lineup comparisons | Chronological role/count evaluation and additive-feature ablation |
| **5. Joint outcomes and specialists** | Coherent game/player/DST distributions; site scoring; independent evaluation draws | Conservation, quantile/joint-tail calibration and bounded runtime |
| **6. Contest field and payout** | Legal correlated field, actual payout/tie adapter, uncertainty and ownership sensitivity | Field calibration, exact-tie fixtures and extreme-rank validation |
| **7. Contest-aware portfolio engine** | Joint portfolio evaluation, risk modes, qualified recommendation explanations | Untouched forward evaluation; comparison with baseline and candidate-pool limits disclosed |
| **8. Separately gated late swap** | Exact accepted entries/slots, reliable lock state, conditional remaining-slate evaluation | Started-slot immutability and end-to-end late-swap export tests |

Design work is part of each feature, not something postponed entirely to PR 3. PR 3 consolidates the workflow after correctness controls exist. Avoid unnecessary new dependencies, parallel scoring stores, duplicate identity services or a second UI shell. Reuse existing data adapters and solver implementations where supported.

### Agent delivery contract per PR

Include changed rules/IDs, feature capability state, tests actually run, failure baselines, data dependencies, migration/backward-compatibility behavior, runtime/memory measures where relevant, screenshots/layout results and known limits. Update the living-rule implementation matrix. No claim that a fixture test equals real DraftKings acceptance.

The final code should provide a reproducible command or documented local flow that runs fixture input -> candidate generation -> global selection -> validation -> entry-update CSV -> round-trip audit. Any guessed command in this specification is not an existing repo command; define it during implementation and test it.

## 13. Acceptance test catalog

Each rule below must link to applicable test cases. The identifiers here are proposed stable test requirements, not a claim tests already exist.

### Structural and data

- **T01:** Reject mixed sport/site/format/slate and out-of-slate or duplicated canonical player IDs; preserve effective team aliases.
- **T02:** Score/roster adapter fixtures cover position eligibility, salary totals, supported bonuses/negative points and site-specific scoring; keep specialist missingness explicit.
- **T03:** PFF-like duplicate RECV fields and player-pass-snap versus team-dropback denominators are distinguished; no divide-by-zero or fabricated route rate.
- **T04:** Unknown/missing ownership, forecast, status, kickoff and payout remain unavailable; historical averages and P50 are not silently relabeled means.
- **T05:** As-of joins exclude future/in-game corrections; source period mismatch is flagged; updates preserve old snapshots and override reasons.
- **T06:** Invalid/noisy names do not auto-match via fuzzy guesses; string IDs survive CSV/JSON round trips.

### Generation / portfolio

- **T07:** Optional versus required/forbidden bring-back and minimum/exact stack counts work as requested; qualifying receiving-RB and existing locks are counted correctly.
- **T08:** Default QB/opposing-DST rule rejects the 11 historical conflicts; override is explicit; no blanket platform-illegality claim.
- **T09:** WR/RB/FLEX permutations count as one Classic scoring lineup; actual slot mapping remains valid and later locks remain intact.
- **T10:** N=150, target 40%=60, hard bounds, fractional rounding, global locks, partial portfolios and conflicting pair/core limits have correct arithmetic.
- **T11:** Two players each at 90/150 but together 89/150 are flagged in pair view; a selected pair cap is enforced by selection, not just export.
- **T12:** Portfolio preserves the requested count or returns explicit shortfall/conflict; no silent duplicates, constraint relaxation or market-percentage substitution.
- **T13:** A 114/150 TE-FLEX fixture renders a structural warning, not an automatic ban; configured position bounds are enforced only when requested.
- **T14:** Every named plan's locks/exclusions/schedule matches the applied manifest; applying one plan replaces stale prior fields atomically.
- **T15:** Candidate ordering and repeated batching do not silently determine the final pair exposure; compare reorderings under the documented deterministic/tie policy.
- **T16:** Full $50,000 is allowed; disabled minimum means no artificial floor; inability to reach $49,000 never violates the site maximum or forces a mislabeled full result.

### Modeling and evaluation

- **T17:** Inherited pace formula reproduces known inputs; team-specific values sum correctly; absent venue samples have a declared fallback.
- **T18:** Dropbacks/sacks/scrambles/attempts/targets/completions and passing/receiving TD-yard identities reconcile under the declared play definition.
- **T19:** Marginal, zero-mass, quantile and joint-tail calibration use chronological splits; more simulated draws do not relabel an unvalidated model.
- **T20:** Generation, selection/tuning and final evaluation draws are separated; alternatives share common independent evaluation scenarios where appropriate.
- **T21:** Legal field respects roster/salary and empirical ownership/stack frequencies; sensitivity to provider and field size is reported.
- **T22:** Ties crossing payout tiers include own entries and opponent multiplicity, unpaid ranks, currency precision and noncash rules; fees subtracted exactly once.
- **T23:** Missing contest payout/field capabilities prevent EV claims; explicit projection fallback is labeled and user-approved.
- **T24:** Feasible versus proven optimal versus timed out versus infeasible remain distinct; candidate-pool limitations and numerical scaling are visible.

### Export / safety / UX

- **T25:** 150 approved lineups map to exactly 150 selected entries; extra unrelated contests/rows and metadata remain unchanged.
- **T26:** BOM, CRLF/LF, quoted commas/quotes, duplicate position headers, ragged rows and side-by-side player catalogs parse without field loss.
- **T27:** A lineup-only file uploaded as an entries template produces a targeted correction, not invented Entry IDs.
- **T28:** Storage/ledger failure retains valid local work, offers allowed recovery and reports pending sync; retries do not duplicate builds/fees/entries or bypass ownership.
- **T29:** Restore is bounded and atomic; malicious or inconsistent references cannot fetch other accounts; malformed imports do not erase the prior portfolio.
- **T30:** Reformatting recovery preserves original players/order unless an explicit edit diff is approved; acceptance remains unconfirmed until readback.
- **T31:** Locked players cannot change identity or exact slot, including WR/FLEX; unknown lock state blocks affected late edits.
- **T32:** Refresh, cancel, retry, hidden-tab polling and stale data do not overwrite a reviewed portfolio; update produces a versioned diff.
- **T33:** Desktop/mobile and theme/a11y checks cover keyboard, focus, overlays, scroll, field labels and visible actions; screenshot claims match actual work.
- **T34:** A user completes the role -> exposure -> generate -> audit -> recover -> correct-export tasks without manual batch arithmetic.
- **T35:** Every saved build preserves rules/model/field/solver/source hashes, effective seeds and strategy intent; API/model inputs match the UI summary.
- **T36:** Pure expected-value, risk-penalized and top-finish objectives are not conflated; final joint evaluation includes our whole selected portfolio.

## 14. Evaluation and research discipline

Use walk-forward time splits and retained pre-lock information. Tune only on training/validation blocks; keep untouched future weeks for reporting. If a historical source was not archived at lock, describe the study as retrospective and do not present it as live-reproducible performance. Split by week/slate rather than randomly across highly related player rows.

Benchmark the existing projection-sum generator, an improved global-selector-only version, role-aware version, matchup increment, joint model, and field-aware selector at comparable candidate/compute budgets. Track team plays/dropbacks, player opportunities, marginal calibration, joint stack tail calibration, ownership/pair errors, constraint costs, export failure rate, runtime and user task completion. Use block-aware confidence intervals; rare payouts require wide uncertainty and many slates.

Ground-truth “best possible lineup” may be a hindsight diagnostic, not the pre-lock objective or achievable promise. Today's raw role data and earlier conversational game reports require independent validation before use as research labels. Do not tune permanent exposure percentages to this slate's eventual winner.

Record why a selection failed: data scope/identity, availability/role, efficiency, unexpected injury, game state, field forecast, candidate search, portfolio concentration, constraint application, or export/submission. A good process can lose and a bad process can cash; neither excuses avoidable software errors.

## 15. Source register and scope

Sources below ground external claims or preserve original evidence. Proposed architecture, UI and test requirements are authored design recommendations, not quotations or claimed findings of the cited sources. Earlier market/injury/ownership snapshots are historical; no current slate predictions are refreshed by this handoff.

| ID | Source | What it supports / limitation |
|---|---|---|
| **F01** | Canonical `ScoreSense_DFS_Living_Rulebook.md`, v0.1.6, retrieved 2026-10-11; Drive file ID `1s8YNzM3NpbeCi39Xw8C1nHlau1dFYPE1` | All prior stable rules and append-only decision records; statistical ideas remain unvalidated |
| **F02** | User `scoresense-portfolio-rescue.json`; original exportedAt `2026-10-11T16:36:12.088Z` | Complete recovered candidate portfolio and build settings; not verified accepted entries or actual outcomes |
| **F03** | User `DKSalaries (2).csv` and `DKEntries.csv`; local filled and six-DST-revision exports | Exact source-template structure/IDs for the historical exercise; not present-day eligibility or acceptance |
| **F04** | User `receiving_summary (3).csv`, declared Weeks 1–4 | Historical schema/denominator lesson; no paid raw observations bundled or authorized for public product reuse |
| **R01** | https://github.com/RandomStatsGuy/ScoreSense/blob/572522857090adf7755535666c3aa478de898c5f/AGENTS.md | Product, architecture, agent process and review-cost constraints |
| **R02** | https://github.com/RandomStatsGuy/ScoreSense/blob/572522857090adf7755535666c3aa478de898c5f/docs/PRODUCT.md | Approved aesthetic tokens, layout hierarchy, accessibility and current DFS exception |
| **R03** | Same PRODUCT.md, approved DFS portfolio section; https://github.com/RandomStatsGuy/ScoreSense/blob/572522857090adf7755535666c3aa478de898c5f/frontend/src/LineupOptimizer.jsx | Backup/restore is documented; Build/Results shell; not an independent runtime certification |
| **R04** | Historical PR #692/#693 and earlier inspected `dfsPortfolio.js`, `dfsEntryExport.js`, `useDfsBuilder.js` | Prior operational implementation/known limitations; re-audit latest code |
| **R05** | https://github.com/RandomStatsGuy/ScoreSense/blob/572522857090adf7755535666c3aa478de898c5f/docs/DFS_GPP_FOUNDATION.md | Existing foundation, forecast semantics and staged remaining capabilities |
| **R06** | https://help.draftkings.com/hc/en-us/articles/4405223998867-How-do-I-upload-or-edit-multiple-lineups-at-once-US | Official distinct library and entry-edit CSV workflows; recheck at implementation |
| **R07** | https://www.draftkings.com/help/rules/nfl | Locate current contest scoring/roster/lock rules; generic landing page alone is not a complete versioned ruleset |
| **R08** | https://papers.ssrn.com/abstract=3393127 ; https://doi.org/10.1287/mnsc.2019.3528 | Haugh & Singal, contest/opponent-aware expected-reward framework; not a validated ScoreSense result |
| **R09** | https://arxiv.org/abs/1604.01455 | Hunter, Vielma & Zaman, distinct at-least-one-win portfolio objective; do not copy Gaussian assumptions as fact |
| **R10** | https://developers.google.com/optimization/cp/cp_solver | Solver status distinctions and integer modeling for a possible solver choice, not a mandated dependency |
| **R11** | https://ffopportunity.ffverse.com/ | Example opportunity-value modeling; historical opportunity value is not a forward role forecast |
| **R12** | https://nflreadr.nflverse.com/reference/load_participation.html | Participation coverage/latency must be checked, not assumed current-week |
| **R13** | https://nflreadr.nflverse.com/reference/load_ftn_charting.html | Different limited public charting subset, availability and attribution/license |
| **R14** | https://www.pff.com/terms | Consumer versus separately authorized data use; evaluate applicable rights before product ingestion or model use |
| **R15** | https://www.w3.org/TR/WCAG22/ | Accessibility target; project-specific design conventions may be stricter |
| **R16** | https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html ; https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | Sticky-focus and target-size guidance; do not conflate 44px product standard with every WCAG minimum |

## 16. Complete current rule register

The following register contains **65 rules: all 35 prior stable IDs plus 30 explicit implementation/UX requirements**. `Design policy` describes a chosen guardrail; `heuristic` means a strategy choice to test; `proposed model` means an unvalidated statistical component. None is certified as a profitable ScoreSense edge. Historical implementation status is not proof that the latest runtime satisfies the revised requirement.

Use the companion machine-readable registry for traceability, not as executable optimizer configuration. Runtime configuration must pass the application's schema and authorization checks. The written specification is the human authority; keep the JSON synchronized in every rule change.
### GOV-01 — Version every rule and every build

**Governance · Retained / clarified · Revision 1**  
Give every rule a stable ID, inputs, formula or decision test, rationale, evidence state, implementation state, and append-only changes. Pin each lineup build to a ruleset version and pre-lock snapshot.

**Reason:** Keep promising ideas separate from proven findings and prevent hindsight edits.  
**Verification:** T05, T35. Verify old build manifests still reproduce their original decisions.


### DATA-01 — Classic main slate only

**Constraint · Retained / clarified · Revision 1**  
This rulebook covers NFL Classic main-slate GPPs and the user's 150-entry workflow. Keep Showdown/Captain rules in a separate registry; validate the actual contest's eligible games.

**Reason:** Prevent cross-contest salary, eligibility, ownership and scoring contamination.  
**Verification:** T01, T02. Reject out-of-slate players and Showdown-only fields in a Classic build.


### DATA-02 — Freeze source, identity and availability

**Governance · Retained / clarified · Revision 1**  
Store source URL/provider, retrieved_at, source_as_of, available_at, slate_id, player_id, game_id, injury assumptions, scoring version and data completeness. Never interpret missing as zero. Preserve pre-lock raw inputs.

**Reason:** A later-corrected table is not proof that information was available at lock.  
**Verification:** T04, T05, T06. ID joins, known-at-lock tests, source freshness and schema validation.


### PACE-01 — Combined-play screen: inherited 75/25 blend

**Heuristic · Retained / clarified · Revision 1**  
Adjusted X = 0.75*season_X + 0.25*venue_X. Away plays = mean(adjusted away plays-for, adjusted home plays-against). Home plays = mean(adjusted home plays-for, adjusted away plays-against). Combined = away + home.

**Reason:** Transparent volume screen; NOT a fitted snap projection, pure speed ranking, probability distribution or proof of betting value. Season already includes venue games.  
**Verification:** T17. Rolling team/combined-play MAE vs league average, season-only and venue-only baselines; test sensitivity to venue weight.


### PACE-02 — Let sample size govern venue adjustment

**Model · Retained / clarified · Revision 1**  
Track home, away and season sample counts. Test a fitted, partially pooled home/away effect rather than permanently fixing 25%. Avoid treating overlapping season/venue samples as independent observations.

**Reason:** One home game should not set a precise team-specific home effect.  
**Verification:** T17, T19. Forward ablation: venue term must improve held-out forecasts across weeks/seasons.


### PACE-03 — Separate volume, tempo, dropbacks and scoring

**Governance · Retained / clarified · Revision 1**  
Retain plays-for/against, neutral clock use, game-script tempo, dropback rate, pass rate over expectation and market scoring as separate concepts. Never multiply incompatible rate/count definitions.

**Reason:** Many snaps do not necessarily mean many pass attempts or valuable fantasy opportunities.  
**Verification:** T03, T17, T18. Document denominators and filters; reconcile counts against game totals.


### PACE-04 — Define a coherent count system

**Model · Retained / clarified · Revision 1**  
Use one play-by-play specification for modeled offense: handle no-plays, penalties, kneels, spikes and overtime explicitly. Model dropbacks, sacks, scrambles, throws and targets with consistent denominators; retain provider raw counts separately.

**Reason:** Prevent routes, attempts and targets being generated from incompatible play totals.  
**Verification:** T18. Per-game count identities and reconciliation tests including unusual plays.


### MARKET-01 — Timestamp movement without inventing causes

**Governance · Retained / clarified · Revision 1**  
Compare the same book/feed and timestamp convention. Preserve opener, defined early-week reference and latest quote separately. A falling total can reflect volume or efficiency; do not assign a cause without evidence or count overlapping market adjustments twice.

**Reason:** Price changes inform the model but do not independently establish a DFS fade or mispriced over.  
**Verification:** T05, T17, T19. Check reference selection, availability times and ablate the extra market-change feature.


### OWN-01 — Ownership is a field forecast, not player ability

**Governance · Retained / clarified · Revision 1**  
Store projected/actual ownership separately with provider, update time, platform, contest type and injury scenario. Compare vendors or sensitivity ranges where available; do not label broad projections as Milly-specific.

**Reason:** Popular can be correct; unpopular can be poor. Ownership does not change expected NFL plays.  
**Verification:** T04, T21, T23. Compare archived forecasts with actual contest ownership; evaluate bias and error by salary/position/news.


### OWN-02 — Do not multiply marginal ownership into stack ownership

**Governance · Retained / clarified · Revision 1**  
Estimate combinations through archived conditional selection behavior or a constrained field model. QB-receiver, bring-back and salary choices are dependent; simple sums/products do not identify exact duplicates.

**Reason:** Avoid false precision about uniqueness and leverage.  
**Verification:** T21, T22. Hold-out calibration of pair/stack frequencies, salary use and repeated lineups.


### ROLE-01 — Project the role before the matchup

**Model · Retained / clarified · Revision 1**  
Within each game/personnel scenario: targets approximately equal dropbacks * route participation * targets per route. Reconcile jointly across the full offense and residual players/throwaways. Without verified routes, use a labeled target-share fallback, not fabricated routes.

**Reason:** Separates being on the field, running a route and actually earning the ball.  
**Verification:** T03, T18, T19. Forward target MAE, distribution calibration, route-count error; compare with target-share baseline.


### ROLE-02 — Value opportunities by location and scoring

**Model · Retained / clarified · Revision 1**  
Model expected fantasy value of carries/targets using field position, target depth, catch probability and scoring rules. Add player skill and uncertainty separately. For RBs distinguish carries, goal-line work, routes, targets and two-minute roles.

**Reason:** Ten low-value opportunities need not equal ten high-value opportunities. Historical xFP describes past usage; forecast future usage before applying it.  
**Verification:** T02, T18, T19. Forward receptions/yards/TD calibration vs simple count-only model; scoring-unit tests.


### ROLE-03 — Pool small samples and honor structural changes

**Model · Retained / clarified · Revision 1**  
Blend role estimates with appropriately fitted player/team/position priors. Condition on QB, personnel, scheme and known role changes. Preserve small-sample flags for red-zone, coverage and injury on/off splits.

**Reason:** Avoid both chasing one game and blindly preserving a role that genuinely changed.  
**Verification:** T05, T19. Rolling estimates, shrinkage tuning only in training, role-change subset evaluation.


### ROLE-04 — Redistribute opportunity, not just vacated totals

**Heuristic · Retained / clarified · Revision 1**  
For each relevant inactive/limited/normal scenario, reallocate routes and touches across WR/TE/RB and allow team volume/efficiency to change. A depth-chart promotion does not guarantee receiving work, scoring chances or ceiling.

**Reason:** Capture the earlier injury-value concern without treating one bad result as proof.  
**Verification:** T05, T18, T19. Assess conditional role forecasts; shares/counts must remain coherent.


### MATCH-01 — Match receiver role to defensive tendencies

**Model · Retained / clarified · Revision 1**  
Test slot/outside alignment, depth, route families, coverage mixture, pressure/protection and opponent-adjusted tendencies as incremental features. Each adjustment must change an explicit opportunity, efficiency or uncertainty term.

**Reason:** A defense-vs-position rank is not a causal assignment of a weakness to one receiver.  
**Verification:** T19, T20. Ablate matchup features after role/salary/base projections; retain only robust held-out improvement.


### MATCH-02 — Do not invent shadow coverage or automatic pressure beneficiaries

**Governance · Retained / clarified · Revision 1**  
Require evidence for likely coverage responsibility and relevant sample size. Coverage can pass between defenders. Pressure might create shorter throws, sacks or extra blocking; no automatic TE/checkdown bump.

**Reason:** Mechanism first; downgrade confidence when actual assignments or role effects are unknown.  
**Verification:** T04, T19. Audit matchup claims against available charting; flag missing evidence rather than score it as favorable.


### STACK-01 — A second attachment must improve the build

**Heuristic · Retained / clarified · Revision 1**  
Compare QB+one receiver, QB+two receivers and other supported structures. The second receiver needs a plausible conditional ceiling, salary fit or opportunity case; team membership alone is insufficient.

**Reason:** Preserves the lesson about forced second attachments without universally banning double stacks.  
**Verification:** T07, T20. Evaluate matched full-lineup alternatives on independent scenarios; no fixed target-count ban.


### STACK-02 — Bring-backs and stack size are optional choices

**Heuristic · Retained / clarified · Revision 1**  
Evaluate no bring-back, one bring-back and supported larger stacks. Allow receiving RB attachments and appropriately supported unstacked rushing-QB candidates. Do not force weak players to make a narrative look symmetrical.

**Reason:** The correct construction depends on how the offense and its opponent reach a ceiling.  
**Verification:** T07, T20. Compare structural alternatives within the same salary/eligibility constraints.


### STACK-03 — Compare complete alternatives, not isolated players

**Model · Retained / clarified · Revision 1**  
For each core, generate multiple feasible completions. Compare adding receiver B against freeing that slot/salary for the best alternatives elsewhere. Value is the change in complete-lineup results, not correlation alone.

**Reason:** A cheaper or more correlated player can still make the overall lineup worse.  
**Verification:** T20, T36. Paired-scenario comparison, adequate candidate diversity and held-out selection.


### SIM-01 — Generate coherent joint game outcomes

**Model · Retained / clarified · Revision 1**  
Sample shared game/personnel states; allocate team opportunities, completions, yards and TDs jointly. A QB's conventional receiving counterparts must match passing totals; include unselected/residual players and special-play handling. Model TD competition, sacks and turnovers.

**Reason:** Two receivers cannot independently claim the same finite targets or every touchdown.  
**Verification:** T18, T19, T20. Conservation identities, empirical covariance and joint-tail/stack calibration.


### SIM-02 — Do not add individual ceilings or assume normal tails

**Governance · Retained / clarified · Revision 1**  
P10/P50/P90 do not uniquely determine a distribution or player dependence. Never sum player P90 values and label the result lineup P90. Any fitted distribution and joint model require calibration; no extra correlation bonus after it is modeled.

**Reason:** Avoid attractive but incoherent ceiling estimates and double-counted correlation.  
**Verification:** T04, T19, T20. Quantile coverage, zero-mass/tail checks, joint outcomes; gate uncalibrated tail claims.


### FIELD-01 — Simulate legal, correlated opponent lineups

**Model · Retained / clarified · Revision 1**  
Fit a contest-relevant opponent generator with player ownership, salaries, roster rules, conditional stacks, bring-backs and duplicated constructions. Vary ownership assumptions; hold out field samples for evaluation.

**Reason:** The value of a combination depends on what other legal lineups benefit in the same outcome.  
**Verification:** T21, T22, T23. Validate marginals and joint frequencies against independent historical contest exports.


### PORT-01 — Declare objective and price ties correctly

**Model · Retained / clarified · Revision 1**  
Report expected net payout under the actual rank/tie rules and probability of at least one top finish separately. Default proposal: optimize tie-adjusted expected payout with user-selected risk limits; preserve a separately labeled win-probability mode.

**Reason:** Winning probability and expected dollars are different objectives. Salary left and novelty alone are not objectives.  
**Verification:** T22, T23, T36. Exact tie-prize pool tests including own entries; sensitivity to model/field assumptions.


### PORT-02 — Audit shared assumptions, not just shared names

**Heuristic · Retained / clarified · Revision 1**  
Track player/pair/core exposure plus shared injury-value and game-script dependencies across the 150. Prefer the next lineup's incremental contribution; arbitrary three-player-difference rules do not guarantee real diversification.

**Reason:** Different stacks can all fail because they depend on the same weak supporting-player assumption.  
**Verification:** T11, T13, T36. Scenario loss concentration, marginal top-finish coverage, sensitivity tests.


### PORT-03 — Three-to-four-game focus is a configuration, not a law

**Governance · Retained / clarified · Revision 1**  
Respect the user's selected primary QB game pool; keep other eligible players available as complements. Do not promote the earlier 60/40/30/20 example to a permanent rule. Revisit game ranking after evaluating feasible player combinations.

**Reason:** A good aggregate game is not enough if all affordable constructions are weak.  
**Verification:** T14, T20. Benchmark the focused pool against a broader research pool; document sacrificed coverage.


### VALID-01 — Test forward and remove layers one at a time

**Governance · Retained / clarified · Revision 1**  
Train on past data, tune on separate validation weeks, evaluate untouched later weeks. Compare base projections, role layer, matchup layer, joint combinations and field layer with the same candidate budgets. Freeze pre-lock facts; use separate generation and evaluation draws.

**Reason:** Avoid data leakage, simulator overfitting and feature additions that only look scientific.  
**Verification:** T05, T19, T20. MAE plus probabilistic calibration, block-by-week uncertainty, multi-season/scoring-regime checks.


### VALID-02 — Audit decisions before judging results

**Governance · Retained / clarified · Revision 1**  
Store expected opportunities, plausible scenarios, rejected alternatives and failure conditions before lock. Postgame separate role misses, efficiency misses, injury variance, field-model error and solver/constraint error. Do not convert a single result into a permanent rule.

**Reason:** A correct process can lose; a weak process can win. Earlier narrative results are not validation data until checked.  
**Verification:** T30, T35. Reconcile exact submitted entries and official stats/contest results before computing outcome metrics.


### OPS-01 — Reuse artifact-first architecture; gate readiness

**Governance · Retained / clarified · Revision 2**  
Reuse the existing ScoreSense generator, scoring/identity contracts and refresh-time artifacts behind separate opportunity, joint-outcome, field and portfolio layers. Ordinary page reads remain cache-first; heavy builds run in bounded background jobs. Avoid duplicate projection stores, unsupported specialist certainty and automatic entry submission. Inspect the current repository before changing architecture.

**Reason:** Fits the prior implementation direction without claiming the proposal is deployed.  
**Verification:** T23, T32, T35. Data/scoring/slate/unit checks first; explicitly label research-only versus production-ready.


### OPS-02 — Check availability and rights before promising a feed

**Governance · Retained / clarified · Revision 1**  
Distinguish public PBP and limited charting from full current routes/coverage. Record provider-specific availability and terms. Do not bypass paywalls or assume a subscription permits redistribution. Do not purchase data or start paid work without authorization.

**Reason:** Historical availability and code licensing do not guarantee a usable live commercial data product.  
**Verification:** T03, T04. Coverage/latency/license review and graceful unavailable-data behavior.


### OPS-03 — Separate live-slate execution from model development

**Governance · Retained / clarified · Revision 1**  
For an imminent slate, first prove the currently deployed generator and export path with a small pilot. Use a versioned slate-specific player pool, explicit stack groups and conditional injury rules. Do not make an unvalidated opportunity, joint-simulation or ownership-field release a dependency of entry submission. A pre-lock code change must be narrowly necessary, isolated, regression-tested, reversible and re-tested end-to-end. A last-known-good run remains available.

**Reason:** A code merge or green unit test does not establish deployed export readiness or predictive improvement. Keep an imminent contest deadline from becoming a model-release deadline.  
**Verification:** T28, T32, T35. Record deployed version, input snapshot, smoke-test result, successful export/readback and rollback path; label unavailable features rather than implying they are active.


### OPS-04 — Separate entry reservation from final lineup selection

**Governance · Retained / clarified · Revision 1**  
When the contest supports reservations, the user may secure only the already-budgeted entries before completing research. Verify contest entry limit and total fees; 150 is not mandatory and is not a reason to increase the budget. Reserving an entry does not populate it, and failure to draft does not by itself earn a refund. Establish legal baseline lineups promptly, then refine them before lock.

**Reason:** Reduce sellout pressure without mistaking an empty paid reservation for a completed lineup.  
**Verification:** T25, T30. User verifies reserved count and fees; then confirms every reserved entry contains a complete legal lineup. Do not reserve, pay or submit on the user's behalf without separate authorization.


### OPS-05 — Validate actual entries, not only an exported or saved lineup file

**Governance · Retained / clarified · Revision 1**  
Use the exact contest's current player IDs and a fresh entries template. Validate unique player identities, salary, slots, eligible games, final player status and all intended constraints. For reserved entries, preserve entry/contest metadata and fill through Edit Entries rather than assuming Upload Lineups enters the contest. Audit exposures across the final combined 150, not per batch; preserve a baseline backup and read back the actual contest entries. Allow processing time before lock. Do not use a full pre-lock regeneration after any player locks; late swap requires supported contest rules and tested preservation of locked players in their exact slots.

**Reason:** Prevent correct-looking output from being unassigned, stale, duplicated unintentionally, mapped to the wrong entry, or invalid after lock.  
**Verification:** T25, T26, T27, T30, T31. Pilot upload; exactly the intended number of populated entries; no unresolved validation errors; compare a post-upload entries export against the intended player-ID sets and metadata.


### OPS-06 — Use a time-boxed workflow patch before an imminent slate

**Governance · Retained / clarified · Revision 2**  
Allow one isolated, opt-in pre-lock workflow PR when it materially reduces manual batch handling or validation risk. The proposed minimum is compatible-batch collection plus a whole-portfolio audit and existing export reuse. Treat the user-authorized timebox as inclusive of testing, not a delivery promise. Do not change statistical objectives, data dependencies, solver algorithms, auth, schemas or late-swap behavior. If validation cannot finish in the budget, keep the patch unmerged and retain the manual fallback.

**Reason:** Distinguish a useful execution improvement from an unvalidated model release; reduce operational work without creating a new critical dependency.  
**Verification:** T25, T28, T32, T33. Regression tests for retained batch provenance, source compatibility, duplicate handling, count/exposure arithmetic, existing exporter behavior; frontend build and browser smoke test before deployment.


### PORT-04 — Count all locks across the final portfolio and gate incomplete exports

**Governance · Retained / clarified · Revision 3**  
Keep Classic scoring duplicates separate from valid slot assignments; retain immutable per-batch inputs. Audit all actual appearances, including locks, across the final selected portfolio. Do not silently fill, prune or repeat user-supplied lineups. Export gates validate unique count, explicit strategy bounds and one-to-one selected-entry assignments. These audits supplement, not substitute for, the new global portfolio selector in PORT-05.

**Reason:** Batch-local exposure and different core labels do not guarantee correct portfolio-level concentration. An audit gate is not an automatic solver or expected-return model.  
**Verification:** T09, T10, T12, T25. Test permutation duplicates, mixed source rejection, locked-player aggregate counts, cap math, removal/recalculation, 149-versus-150 gating, metadata preservation and fresh assignment/readiness checks.


### OPS-07 — Make an assembled portfolio recoverable without changing its history

**Governance · Retained / clarified · Revision 2**  
Provide explicit versioned JSON portfolio backup and restore before relying on a session-only collection overnight. Preserve batch labels, immutable lineups/settings, projection/build snapshots, slate/catalog identities and appearance limits. Treat imports as untrusted: validate a bounded schema and identities, reconstruct frozen batches and rerun compatibility, roster and audit checks; reject malformed or mixed-slate input atomically without destroying existing work. Preserve visible duplicates and limit violations for correction, but keep export blocked. Confirm before replacing a nonempty collection; never merge implicitly. Reset entry templates/assignments and cached saved-build mappings; do not treat imported snapshot IDs as authorization or historical authenticity. Retain backend account validation. Re-import a fresh Edit Entries template and recheck live availability/lock state before final submission. A restored historical projection remains its original age; do not refresh its timestamp or silently rebuild its lineups.

**Reason:** Prevent loss of several approved batches on refresh/navigation while preserving reproducible pre-lock decisions and existing safety gates.  
**Verification:** T29, T30, T32. Multi-batch/150-lineup round trip; same lineup IDs, snapshots, limits and audit results; duplicate/limit blocks retained; malformed/mixed inputs leave prior state intact; browser reload/restore; account authorization and fresh entry-assignment/export checks remain intact.


### GOV-02 — Define optimality and prohibit false certainty

**Governance · New in v0.2.0 · Revision 1**  
Pin objective, candidate universe, constraints and inputs. Distinguish feasible, solver-proven optimal, time-limited and empirically validated forecasts. No perfect-lineup or guaranteed-profit language. Candidate-pool optimality is not full-universe optimality.

**Reason:** Mathematical optimality cannot eliminate future performance or model uncertainty.  
**Verification:** T23, T24, T36. Implement and pass the linked acceptance cases; record actual results and limitations.


### GOV-03 — Separate design requirements from historical decisions

**Governance · New in v0.2.0 · Revision 1**  
Keep live/accepted entries and historical decisions immutable. Do not learn permanent exposures, salary floors, game counts or bans from one slate or a conversational postmortem. This rebuild does not authorize editing current entries, deploying code or purchasing data.

**Reason:** Preserve honest forward evaluation and prevent accidental live-slate changes.  
**Verification:** T05, T30, T31, T35. Implement and pass the linked acceptance cases; record actual results and limitations.


### DATA-03 — Use exact, account-scoped slate and player identities

**Constraint · New in v0.2.0 · Revision 1**  
Scope provider IDs by slate/site/format and effective team. Prefer verified mappings; unresolved normalized-name/team/position matches require review. Imported hashes and snapshot IDs confer no authentication. Distinguish PFF, platform and canonical IDs.

**Reason:** Names and stale IDs can produce valid-looking but incorrect uploads.  
**Verification:** T01, T06, T25, T29. Implement and pass the linked acceptance cases; record actual results and limitations.


### DATA-04 — Preserve source windows and count denominators

**Governance · New in v0.2.0 · Revision 1**  
Retain raw filters, dates, counts and definitions. Distinguish receiving grade from route count and player pass-snap route rate from team-dropback participation. Flag contradictory game counts and missing dates; do not repair them with guesses.

**Reason:** An impressive ratio with the wrong denominator is not a reliable role estimate.  
**Verification:** T03, T05. Implement and pass the linked acceptance cases; record actual results and limitations.


### DATA-05 — Keep projection semantics and overrides explicit

**Governance · New in v0.2.0 · Revision 1**  
Store model mean, median, quantiles and historical averages as different fields. Overrides retain original values, reasons and provenance. Apply injury/pace/matchup effects once and preserve source uncertainty. Exposure preferences must not silently alter forecasts.

**Reason:** Projection manipulation hides portfolio intent and double-counts information.  
**Verification:** T04, T05, T35. Implement and pass the linked acceptance cases; record actual results and limitations.


### DATA-06 — Gate data use by actual rights and coverage

**Governance · New in v0.2.0 · Revision 1**  
Record permissions for personal use, hosting, redistribution, training and external-model processing separately. Do not ship paid raw user exports or private entry identifiers as repository fixtures. Use permitted synthetic/public fixtures and a visible missing-data fallback.

**Reason:** A consumer download is not automatically a licensed multiuser data product.  
**Verification:** T03, T04, T29. Implement and pass the linked acceptance cases; record actual results and limitations.


### DATA-07 — Freeze one decision-time evaluation snapshot

**Governance · New in v0.2.0 · Revision 1**  
Retain original batch forecasts for history, but select/evaluate a working portfolio against one explicitly selected information snapshot. New data creates a previewed version; failed refreshes preserve the last good data and never refresh its timestamp artificially.

**Reason:** Historical reproducibility and current decision consistency are different requirements.  
**Verification:** T05, T32, T35. Implement and pass the linked acceptance cases; record actual results and limitations.


### PACE-05 — Rank quarterback-side opportunity and challenge omissions

**Heuristic · New in v0.2.0 · Revision 1**  
Show both team play estimates and passing opportunities. Research all eligible games before optional focus restrictions; revisit omitted concentrated or efficient offenses after full-lineup pricing. No fixed number of stack games or automatic low-total fade.

**Reason:** A high combined-play number can hide poor volume for the chosen quarterback.  
**Verification:** T17, T20. Implement and pass the linked acceptance cases; record actual results and limitations.


### ROLE-05 — Research all complementary positions

**Model · New in v0.2.0 · Revision 1**  
Build RB, WR, TE and DST cases independently of the selected quarterback-game pool. Receiving data cannot establish rushing/goal-line roles; defense is not just a salary filler. Preserve limited/normal/inactive distributions and specialist model coverage.

**Reason:** Strong stacks can be undone by unexamined supporting players.  
**Verification:** T02, T04, T18, T19. Implement and pass the linked acceptance cases; record actual results and limitations.


### STACK-04 — Block QB versus opposing DST by default

**Heuristic · New in v0.2.0 · Revision 1**  
Enable a Classic GPP strategy constraint preventing a quarterback with the defense facing that quarterback. Treat it as an overridable policy, not platform illegality. Verify opponents by game identity and audit other offensive-DST conflicts separately.

**Reason:** The recovered portfolio had 11 unintended QB/opposing-DST combinations.  
**Verification:** T01, T08. Implement and pass the linked acceptance cases; record actual results and limitations.


### STACK-05 — Make group and bring-back semantics exact

**Constraint · New in v0.2.0 · Revision 1**  
Represent minimum, maximum, exact, optional and forbidden explicitly. Count existing locks toward groups. Distinguish receiving-RB eligibility from all RBs. Apply named plans atomically and compare the requested plan with actual optimizer inputs before building.

**Reason:** A checkbox or stale batch configuration must not silently change the intended construction.  
**Verification:** T07, T14, T35. Implement and pass the linked acceptance cases; record actual results and limitations.


### SIM-03 — Derive specialist outcomes from shared events

**Model · New in v0.2.0 · Revision 1**  
Use the same opposing sacks, turnovers, returns and points allowed when generating DST scores and offensive scores. Apply verified site scoring, including negative outcomes. Keep unsupported specialist distributions explicitly gated.

**Reason:** Independent offense and defense simulations can create incompatible ceiling events.  
**Verification:** T02, T18, T19. Implement and pass the linked acceptance cases; record actual results and limitations.


### FIELD-02 — Use the actual contest and correct field size

**Model · New in v0.2.0 · Revision 1**  
Condition ownership/field/payout inputs on the selected contest; distinguish mini-MAX, Milly, single entry and other structures. Model competitor multiplicities and field-size uncertainty. Do not extrapolate a tiny simulated field into precise huge-contest ranks without validation.

**Reason:** The same players can have different selection value in different payout and opponent environments.  
**Verification:** T21, T22, T23. Implement and pass the linked acceptance cases; record actual results and limitations.


### PORT-05 — Native global minimum, target and maximum exposure

**Constraint · New in v0.2.0 · Revision 1**  
Select the final portfolio with separate hard lower/upper counts and soft targets. Include all appearances, even locks. Convert percentages with declared ceil/floor policy. A lock conflicting with a cap must be resolved, not exempted. Targets never silently become altered projections.

**Reason:** Users should not need thirteen manual lock-and-exclude runs to express their intent.  
**Verification:** T10, T12, T34, T35. Implement and pass the linked acceptance cases; record actual results and limitations.


### PORT-06 — Expose and constrain pairs, cores and shared assumptions

**Constraint · New in v0.2.0 · Revision 1**  
Count pairs and groups across all slots and batches, distinguish intentional core concentration from repeated supporting assumptions, and support explicit upper/lower bounds where feasible. Pair caps are optional user/model decisions, not universal fixed percentages.

**Reason:** Two players each within a marginal cap can still co-occur almost every time.  
**Verification:** T11, T15, T36. Implement and pass the linked acceptance cases; record actual results and limitations.


### PORT-07 — Allow full salary without requiring full spend

**Heuristic · New in v0.2.0 · Revision 1**  
Keep the exact site maximum available. Minimum spend is optional and labeled as a search constraint. Do not force unused salary for uniqueness or expensive filler to satisfy an arbitrary floor. Compare complete alternatives and display constraint cost where measurable.

**Reason:** Salary use and duplicate risk are not the same objective.  
**Verification:** T16, T20. Implement and pass the linked acceptance cases; record actual results and limitations.


### PORT-08 — Audit FLEX structure rather than ban it blindly

**Heuristic · New in v0.2.0 · Revision 1**  
Report RB/WR/TE FLEX distribution and investigate extreme concentration against projected roles, salaries and alternatives. Do not hardcode a two-TE ban or a permanent optimal percentage from the observed 114/150. Enforce only explicitly selected structure bounds.

**Reason:** Structure concentration can reveal a model/search issue without proving every instance is wrong.  
**Verification:** T13, T20. Implement and pass the linked acceptance cases; record actual results and limitations.


### PORT-09 — Separate candidate generation from portfolio selection

**Model · New in v0.2.0 · Revision 1**  
Generate a diverse candidate pool with declared budgets and independent evaluation. Do not equate sequential projection maximization with jointly optimized entries. Report feasible/optimal/time-limit status and permit bounded re-search when candidates cannot satisfy the requested portfolio.

**Reason:** Repeated greedy saturation creates rigid pairs and order effects.  
**Verification:** T12, T15, T20, T24. Implement and pass the linked acceptance cases; record actual results and limitations.


### PORT-10 — No silent relaxations or unintended lineup substitution

**Governance · New in v0.2.0 · Revision 1**  
Expose infeasible constraints, count shortfalls and soft-target deviations. Suggest specific changes and require approval before changing hard strategy constraints, editing selections, pruning supplied lineups or filling with duplicates. Revalidate the entire portfolio after a confirmed replacement.

**Reason:** A green count must not conceal a different request than the user made.  
**Verification:** T10, T12, T14, T25, T30. Implement and pass the linked acceptance cases; record actual results and limitations.


### OPS-08 — Separate valid CSV generation from nonessential ledger sync

**Governance · New in v0.2.0 · Revision 1**  
Create a deterministic validated entry-update serializer. Investigate the real export failure. Allow disclosed local recovery when sufficient authorized user-held inputs exist, even if optional history synchronization fails; never bypass identity, authorization, legality or lock checks. Retrying must be idempotent.

**Reason:** Bookkeeping failures should not destroy a valid portfolio or require manual reconstruction.  
**Verification:** T25, T26, T27, T28, T29. Implement and pass the linked acceptance cases; record actual results and limitations.


### OPS-09 — Keep entry lifecycle and export versions truthful

**Governance · New in v0.2.0 · Revision 1**  
Separate built, approved, assigned, CSV-created, user-uploaded and acceptance-confirmed states. Preserve entry/contest metadata, prior versions and explicit edit diffs. User platform readback is the best evidence of accepted entries; intended output is not proof of submission.

**Reason:** A saved lineup, paid reservation and populated accepted entry are different objects.  
**Verification:** T25, T27, T30, T35. Implement and pass the linked acceptance cases; record actual results and limitations.


### OPS-10 — Treat late swap as exact locked-slot optimization

**Constraint · New in v0.2.0 · Revision 1**  
Require accepted-entry baselines, current contest rules and verified lock data. Freeze each started player in its actual slot with salary consumed. Reject unknown lock state and do not run a pre-lock full regeneration after kickoff. Keep late swap gated until tested end to end.

**Reason:** Moving a locked WR to FLEX can invalidate an otherwise plausible late-swap export.  
**Verification:** T31, T32. Implement and pass the linked acceptance cases; record actual results and limitations.


### VALID-03 — Turn observed incidents into reproducible regression evidence

**Governance · New in v0.2.0 · Revision 1**  
Keep hashes and expected audit counts for the 150-lineup recovery, original 11 QB-DST conflicts, 114 TE-FLEX rows and 89 RB-pair appearances. Use sanitized fixtures for code. Test structural facts separately from unverified outcome/strategy claims and verify the reported six-row revision independently.

**Reason:** Regression evidence should detect actual workflow defects without hindsight football rules.  
**Verification:** T08, T11, T13, T25, T30. Implement and pass the linked acceptance cases; record actual results and limitations.


### UX-01 — Preserve the approved DFS visual system

**Product · New in v0.2.0 · Revision 1**  
Use the approved compact slate bar, settings/pool/selected-lineup layout, paginated pool, Build/Results navigation, shared tokens and theme semantics. Do not restore the superseded DFS hero or add a new top-level product area. Record intentional design changes in PRODUCT.md and the living registry.

**Reason:** A better optimizer should feel like the same coherent ScoreSense product.  
**Verification:** T33, T34. Implement and pass the linked acceptance cases; record actual results and limitations.


### UX-02 — Make the normal 150-lineup path one coherent workflow

**Product · New in v0.2.0 · Revision 1**  
Let users select slate/contest, review game and combination suggestions, set portfolio preferences, generate N, audit and export without manual batch arithmetic. Keep legacy batches as an advanced option; use progressive disclosure and one obvious next action.

**Reason:** The manual batch workflow is an implementation workaround, not the desired product experience.  
**Verification:** T14, T25, T34. Implement and pass the linked acceptance cases; record actual results and limitations.


### UX-03 — Make exposures and stack controls understandable

**Product · New in v0.2.0 · Revision 1**  
Label Minimum, Target, Maximum and Actual separately with counts and percentages. Clarify hard bounds, soft targets, lock scope and optional/forbidden bring-backs. Use-more changes selection preference only. Preview constraint effects and show unmet targets without misleading success.

**Reason:** The user should never confuse an audit cap with a command to select a player.  
**Verification:** T07, T10, T34, T35. Implement and pass the linked acceptance cases; record actual results and limitations.


### UX-04 — Show decision evidence and uncertainty, not invented precision

**Product · New in v0.2.0 · Revision 1**  
Keep source age, forecast semantics, availability, capability and confidence visible at the appropriate level. Explain why a game/core is considered and its credible alternative. Use unavailable states for unsupported ownership/EV; do not color a high total as proof of a good play.

**Reason:** Good presentation must not disguise unknown inputs or an unvalidated model.  
**Verification:** T04, T19, T23, T34. Implement and pass the linked acceptance cases; record actual results and limitations.


### UX-05 — Preserve work through errors, refreshes and replacements

**Product · New in v0.2.0 · Revision 1**  
Retain edits and last good portfolio on failures. Place actionable errors beside the affected control, show truthful job stages, support cancel/retry, and preview versions after data updates or confirmed replacements. Make saved, backup and pending-sync states explicit.

**Reason:** Recovery and clarity matter most near lock, when lost state is costly.  
**Verification:** T28, T29, T30, T32, T34. Implement and pass the linked acceptance cases; record actual results and limitations.


### UX-06 — Accessibility, responsiveness and responsiveness-to-input

**Product · New in v0.2.0 · Revision 1**  
Meet WCAG 2.2 AA and the repo touch/typography standards. Preserve focus, keyboard use, readable contrast, reduced motion and theme semantics. Keep sticky actions from obscuring focus; avoid rendering all players/pairs/lineups or blocking the main thread with heavy work.

**Reason:** A dense sports tool must remain usable on real laptops and phones.  
**Verification:** T33, T34. Implement and pass the linked acceptance cases; record actual results and limitations.


### UX-07 — Require real task and visual acceptance

**Product · New in v0.2.0 · Revision 1**  
Exercise the production workflow at multiple widths/themes: game explanation, exposure edit, 150 generation, pair review, replacement, reload recovery and correct export. Run layout audits; inspect screenshots when available and explicitly disclose when not. Do not certify visual quality from a build passing alone.

**Reason:** Aesthetic and usability quality need testable outcomes, not generic instructions to make it pretty.  
**Verification:** T33, T34. Implement and pass the linked acceptance cases; record actual results and limitations.


## 17. Final completion standard

The feature is complete only when a user can select a real permitted slate, understand the supported recommendation mode, change player/core preferences, produce the intended globally audited portfolio, preserve and restore it, and create the exact selected-entry CSV without manual reconstruction. Every displayed metric must be sourced or explicitly modeled and capability-gated. Every output has an immutable manifest; every material change has a diff.

Statistical quality is promoted separately through forward validation. Engineering correctness, usable design, reliable export and sound probabilistic claims are all required; none substitutes for another. Keep the stable prior workflow available until its successor meets these gates.

**End of current implementation specification.** Historical one-slate allocations and prior implementation notes are retained in the archive/updated canonical rulebook, not applied as global defaults.
