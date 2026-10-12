# Conditional portfolio selection contract

Phase 7 chooses a bounded set of supplied DraftKings NFL Classic candidates under declared game, opponent and cash assumptions. It is research, not a calibrated forecast of future returns. The normal projection builder remains available. No portfolio history, accepted entry or result ledger is changed.

## Flow and frozen inputs

Open **Compare & research → Shared-game scenarios → Contest scenarios → Choose a lineup set**. Select the game bank and contest assumptions first. Choose the desired count, one opponent assumption and a goal, then review the proposed set against the projection baseline. Details and risk settings stay closed until needed. A personal proposal download is separate from either platform CSV path.

`POST /api/lineup/contest-research/select` accepts the existing evaluation package: exact `context`, `pool`, `bank`, `contest_field`, `payout_contract`, `lineups`, `input_snapshot_id`, selected `bank_id` and `contest_research_id`, `seed`, `draw_count` and `top_k`. It additionally requires:

| Field | Meaning |
|---|---|
| `selection_request_id` | Exact client identity of the frozen selection request; echoed with the input snapshot ID |
| `projection_scores` | Exactly one declared finite score for every candidate ID, used only for the projection baseline |
| `count` | Whole requested own entry count, 1–150 |
| `scenario_id` | One explicitly chosen admitted opponent assumption; providers are not silently averaged |
| `objective` | One of the three conditional modes below |
| `risk_alpha`, `risk_weight` | Bounded decimal strings; defaults `0.9` and `1` |

The API admits 1–600 distinct legal candidates; the current selected browser research snapshot remains bounded to 150. Scoring-equivalent roster permutations are duplicates. There must be at least one opponent beyond the requested own count. Declared single-entry contests allow at most one own entry, and three-max contests at most three. Candidate projections are frozen supplied metadata, not an authenticated platform/model receipt. The browser derives them from the selected snapshot's player inputs and scoring goal; unknown inputs block selection instead of becoming zero.

Candidate scores are bounded to ±1,000,000. API risk alpha is 0–0.999999999999 and risk weight is 0–1,000; the browser offers a smaller weight range of 0–100. Decimal controls admit at most 24 significant digits and an exponent no smaller than −24. Extreme precision that could silently underflow a positive hard minimum is rejected before native bound conversion.

The request can include native `player_exposure_limits`, `group_exposure_limits`, `locked_player_ids`, `excluded_player_ids`, `max_exposure`, `max_overlap`, `classic_stack_rules`, `block_qb_opposing_dst`, `max_per_team`, `min_salary` and `max_salary`. Minima/maxima are hard bounds; every lock counts. Fraction bounds use native decimal ceil/floor arithmetic. Target preference compares total absolute appearance misses before the conditional goal among examined feasible sets. Exact target misses remain visible; bounded search does not prove a global target optimum. Unsupported legacy allocation/stack controls must be resolved explicitly, never discarded.

Every candidate must satisfy the declared roster, identity, salary, stack, lock, exclusion and quarterback/opposing-defense controls. A conflicting candidate pool produces an explicit failure. Insufficient supplied candidates do not prove that no legal lineup exists elsewhere. The engine never relaxes controls or pads the result with duplicates.

Authentication precedes streamed input. Existing actual-byte 8 MiB, nesting-24 and 250,000-value limits, duplicate-key/nonfinite rejection and the shared CPU executor apply. Selected bank/contest hashes are revalidated on every run. There are no external data fetches or account writes.

## Separate goals

| Mode | Exact selection utility |
|---|---|
| `conditional_mean_net` | Mean sampled portfolio cash payout minus all selected entry fees |
| `conditional_risk_adjusted_net` | Mean sampled net minus `risk_weight × CVaR_alpha(loss)` |
| `conditional_top_finish` | Fraction of samples with at least one own entry reaching `top_k`, including a tie spanning the cutoff |

Loss is **fees minus gross cash payout**, in USD cents. CVaR is the mean of the worst `1 − alpha` fraction of sampled losses, with exact fractional boundary weight. At alpha 0.9 it averages the worst 10% of samples. A weight of 1 subtracts one cent of utility per cent of tail loss; the weight is dimensionless. CVaR may be negative when even the worst samples are profitable. This is a declared preference, not a claim that diversification universally raises expected dollars. Mean-net and top-finish modes do not silently use the risk penalty.

Every trial set is priced jointly. The field contains exactly `entrant_count − count` opponents, preserving sampled multiplicities. Own entries affect ranks, ties and cash shares together. Exact cash policies/rounding and fees-once semantics reuse the phase-6 adapter. No solo-entry EV coefficient is added and presented as an exact joint result. Top-finish utility counts the union of hits, not the sum of individual win rates.

## Search and independent assessment

The existing native binary selector supplies a hard-feasible projection baseline using the same count and controls. Small supplied pools are exhaustively enumerated when their combination count fits the trial budget. Larger pools use feasible single-swap improvement, evaluating each trial's exact joint utility and target miss. Candidate traversal and tie-breaking are deterministic, but wall-time stopping can change the returned set across runs or hosts. Search is bounded to 2,048 trials and an eight-second selection budget by the route; preparation and final evaluation are additional measured work. The pure engine accepts engineering budgets of 0.01–30 seconds and 1–4,096 trials. The manifest reproduces inputs and budgets, not a guaranteed identical timed result.

`optimal_candidate_pool` requires exhaustive completion and applies only to these candidates and frozen selection draws, after minimum exact target miss. `feasible_heuristic` and `feasible_time_limit` retain a complete audited proposal without claiming an optimum. Native conflicts, insufficient candidates, infeasible candidate pool, unresolved timeout and solver errors remain distinct. Conditional goal bounds and gaps stay null unless exhaustive proof supports them; a proved goal bound applies among portfolios attaining minimum exact target miss, not across every hard-feasible portfolio regardless of targets. A projection solver bound is labeled separately and is never reused as a bound on cash, risk or coverage.

Native projection/target solver certificates use floating tolerances. `baseline_proven_exact` remains false even when that solver reports optimal. Exact target proof is recorded separately and requires exhaustive completion or independently recounted zero miss. Reports retain both native and exact target statuses, and exact rational total target misses.

Purpose-derived selection and evaluation seeds freeze different game/field streams. Search sees only selection draws. The proposed set and baseline receive the same separate final assessment draws across every admitted opponent assumption. Exact final payout-adapter results must agree with the fast trial arithmetic for the selected assumption before a proposal is returned. A proposal can perform worse than baseline on those separate assessment draws; display the actual difference without reselection. Separate streams cannot prove that data, prior experiments or earlier assessments were untouched.

## Report and review state

`dfs_contest_portfolio_selection_v1` records requested/selected/unique/candidate counts, exact candidate IDs and rosters, the explicit goal/risk definition, applied constraints, target misses, conflicts, solver method/status/budgets/runtime, baseline and proposed selection/assessment summaries, all supplied-assumption assessment reports, stream identities and a reproducible input manifest/hash. Money remains exact rational USD cents; display dollars are rounded approximations.

Capabilities permit conditional portfolio selection and exact joint ties, while calibrated ownership/joint outcomes, expected payout, forward forecasts, platform settlement and untouched evaluation remain false. No observed success in finite samples certifies a future probability or tournament advantage.

Changed settings, candidates or selected assumptions stale a proposal. Cancel discards late responses without claiming to stop server computation. Failures preserve the last review; account changes clear research state. Personal downloads retain computed results and frozen own inputs/controls, omitting raw opponent templates, ownership observations and game event ledgers. They confer no submission or acceptance status.

## Remaining release evidence

No permitted actual archived full field, authenticated payout contract or untouched forward portfolio study was supplied. Fitted field/football calibration, comparable-budget multi-slate baseline evidence, candidate-search sensitivity, scenario-loss concentration and marginal top-finish attribution, and real user task acceptance remain open. This implementation does not promote a contest-return forecast. Accepted-entry late swap remains phase 8, gated by reliable exact lock/slot contracts.
