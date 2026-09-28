# DFS GPP: shared Classic and Showdown integration

Status: **backend foundation only; no production strategy or UI activation**.
Prepared September 28, 2026. Audited base: `26f2dc691b4291e3719ed5ef304b34e1852c0223`.

This is the integration plan for the supplied **NFL DraftKings Showdown GPP:
Agent Implementation Guide**, version 1.0 (September 21, 2026), and
**ScoreSense: NFL Classic Large-Field GPP Engine**, version 1.0 (September 28,
2026). Their statistical models remain proposals, not demonstrated edges.
This document distinguishes implemented primitives from deferred integration.

## 1. Product decision

Keep DFS inside **Tools**, keep the existing optimizer and exports, and add a
contest-aware **strategy** around them. Do not create a new top-level product,
replace the auction/Fantasy experience, or rebrand projection jitter as simulation.

Use `site=draftkings` plus `game_style=classic|showdown` in new snapshot contracts;
retain existing legacy format IDs at their existing boundaries. Add a strategy
identifier independently of the roster format. Future adapters must map those
identifiers explicitly, not change current site configuration semantics.

Share payout accounting, provenance, readiness, independent evaluation, portfolio
policies and artifact orchestration. Keep roster/scoring, candidate construction,
field construction and timing adapters format-specific. Sharing infrastructure
is not permission for a Classic change to alter legacy Showdown behavior.

The primary tournament objective is **expected net payout after actual ties**
for a user-chosen entry count. First-place probability, major-finish probability,
and downside-constrained payout are separate objectives. Do not automatically
increase entry count, spending, or submit entries.

## 2. What the current code inspection establishes

The inspection read `AGENTS.md`, core/product instructions, test instructions,
`dfs_config.py`, the first 240 lines of `lineup_optimizer.py`,
`dfs_results.py`, `tests/conftest.py`, and the lineup roadmap. It was not an
exhaustive audit of scoring, routes, exports, ownership or model artifacts.

- The roadmap already lists stacks, bring-backs, multi-lineup generation,
  exposures, salary import and site exports as shipped. Do not rebuild them.
- The pool builder converts missing projection columns to zero and defaults to
  a positional top-40 cut for Classic. Preserve legacy behavior; the new GPP
  adapter must retain missingness and construct the exact slate before pruning.
- The roadmap describes a seven-point DST placeholder and unmodeled kickers.
  The current captain configuration excludes K from its FLEX positions.
  Do not claim comprehensive Showdown candidate/field coverage until a separate
  verified adapter and supported kicker outcomes exist.
- `dfs_results.py` already has account-scoped entries, builds and contest payloads.
  Audit their available raw records before creating parallel storage. This does
  not establish that current saved summaries retain every historical field entry,
  payout table or pre-lock forecast needed for model training.
- Legacy `Projected Points` is not certified as a mean by this inspection.
  Verify forecast semantics and site scoring before mean/tail claims.

## 3. Implemented in this foundation

| Module | Actual behavior | Important boundary |
|---|---|---|
| `dfs_gpp/contracts.py` | Immutable cash contest and score-multiplicity records; distinct capacity/fill/modeled size; explicit cents; complete ordered prize vector | Not a slate importer or verified platform rule profile |
| `dfs_gpp/identity.py` | Stable canonical ID identity for nine-player Classic and six-player Showdown; Captain changes remain distinct | Not salary, eligibility, scoring or export validation; retain slot state separately |
| `dfs_gpp/payouts.py` | Cached prize prefix sums; rational tie shares; compressed opponent counts; joint own-entry payouts, fees and scenario return | Receives already-scored common scenarios; does not forecast outcomes, ownership or expected ROI |
| `dfs_gpp/readiness.py` | Fail-closed capability policy; explicit reasons; no silent objective downgrade | Server artifact integration and evidence production are not implemented |

These modules are **not wired to the existing API, solver or frontend**. Existing
users' lineups and exports are unchanged. This is a testable prerequisite, not a
claim that tournament optimization is already available.

### Exact payout contract

For `a` entries strictly above an entry and `b` other entries tied with it, split
the prizes occupying ranks `a+1` through `a+b+1` across all `b+1` tied entries.
Different lineups with equal scores share prizes too. A cash-boundary tie includes
zero-prize places. Do not divide only the top prize by duplicate count.

```python
from src.products.dfs_gpp.contracts import CashContest, ScoreMultiplicity
from src.products.dfs_gpp.payouts import CashPayoutEvaluator

contest = CashContest(
    modeled_entries=5, capacity=10, current_entries=3,
    entry_limit=5, entry_fee_cents=100,
    prizes_cents=(10000, 6000, 4000, 0, 0),
    advertised_prize_pool_cents=20000,
)
evaluator = CashPayoutEvaluator(contest)
result = evaluator.evaluate_portfolio(
    own_scores=[10, 10],
    opponent_scores=[ScoreMultiplicity(10, 1), ScoreMultiplicity(5, 2)],
)
# Three entries tie for first; each earns exactly 20000/3 cents.
# The two own entries together earn 40000/3 cents before their 200-cent fees.
```

Scores must be Python integers in one verified fixed-point scoring unit per
scenario. Convert array-library scalars explicitly; reject floats rather than
rounding them into artificial ties. The caller must apply Captain scoring before
passing final lineup scores. The payout code does not apply scoring multipliers.

Evaluate all K own entries, including existing/duplicate entries, against N-K
opponents. Multiplicities must preserve the declared count; an unweighted small
field is rejected. Do not subtract a second rake estimate. Fractional cents stay
exact internally; platform rounding/reconciliation remains an adapter requirement.
`net_roi` here is **one scenario's net return fraction**, not an expected ROI.
A free-entry contest returns `None` for ROI.

### Readiness contract

`requested_capability` remains distinct from available capabilities. A denied
request has `effective_capability=None`; it is not silently satisfied by a
lower-quality objective. An explicitly chosen legacy build remains available when
new model dependencies are missing.

| Capability | Requirements |
|---|---|
| `legacy_projection` | Legal slate/salary mapping and legacy projections |
| `joint_score_model` | Verified rules/scoring, fresh full distributions, validated dependence, complete field-player and DST support; kicker support for Showdown |
| `contest_research` | Joint-score prerequisites plus complete ownership, a joint field model and complete cash payouts |
| `contest_validated` | Research prerequisites plus held-out football, field, payout and contest-family validation |
| `late_swap_ready` | Always denied in this phase, even when other evidence is present |

The boolean evidence object is a **trusted internal policy input**, never a public
client attestation. A future artifact reader must bind every assertion to compatible
immutable snapshots, timestamps, hashes and validation reports. Unit tests setting
a flag to true do not validate a model. This version does not implement the guides'
optional ownership-sensitivity scenario mode: missing ownership blocks dollar claims.

## 4. Unified delivery sequence

### A. Correctness and data readiness — next integration PR

**Backend:** build immutable exact-slate, rule/scoring, salary, player-ID,
contest/payout and provenance adapters. Preserve site row IDs as text; preserve
Captain/FLEX row identity separately from canonical athlete identity. Reject
ambiguous name matches, wrong-slate players and unsupported variants. Do not use
screenshots as the engineering import format.

Connect readiness to server-derived evidence through an authenticated thin read
endpoint. Return null metrics with reasons, source cutoffs and stale status. Do
not let client flags enable a capability. Validate actual roster/scoring fixtures
before certifying profiles, including negative outcomes, bonuses, overtime,
defensive attribution and Captain treatment. Keep the existing legal export path.

**Frontend:** add a compact data-readiness panel within `/tools/dfs`, following the
living-surface and presentation-copy conventions. Show exact slate, selected
objective and blockers before a build. Do not introduce a new design system.

**Acceptance:** unresolved salaries fail visibly; missing data is not zero; a fixed
DST placeholder cannot enable payout metrics; no legacy mode/export regression.

### B. Better candidates and joint score comparisons

**Backend/modeling:** add explicit generation coefficients to the existing MILP,
without overwriting displayed forecasts. Build the imported slate before strategic
pruning. Preserve a validated mean baseline and the unchanged legacy baseline.
Retain candidate-family diversity and report solver status and time-limit gaps.

For Classic, search single/double pass stacks, receiving-RB stacks, unstacked
rushing-QB candidates, varied bring-backs, secondary correlations, alternative DSTs
and whole-lineup salary reallocations. No mandatory stack or low-ownership quota.

For Showdown, compare complete lineups under every supported Captain, including
cheap options and eventually modeled kickers/DSTs. Preserve both teams and legal
3-3/4-2/5-1 structures. Do not select Captain solely by raw projected points.

Fit site-specific marginal distributions from held-out residuals and learn valid,
shrunk within-game dependence. Keep zero mass, negative scores and tail calibration.
P10/P50/P90 do not by themselves define a mean or a full distribution. For Classic,
do not reuse one random percentile across unrelated games. Use one complete score
vector to score both our candidates and all opponents. Compute lineup quantiles
from those joint draws, never by summing player P90s.

**Acceptance:** synthetic small-slate comparisons, empirical calibration reports,
independent candidate-evaluation draws and complete field-player/DST coverage.
Without a field model, expose score comparisons only.

### C. Ownership, opponent fields and tournament research

**Backend/modeling:** import timestamped ownership first. Audit current results
imports and add full-field archival without discarding duplicate entries. Keep
final realized ownership as a training/evaluation label, never a same-slate pre-lock
feature. Preserve participant grouping only in an anonymized, authorized form.

Fit legal fields by contest family and entry limit. Classic targets include QB
stacks, bring-backs, FLEX mix, salary distribution and popular combinations.
Showdown needs distinct Captain/FLEX ownership and construction distributions.
Validate realized ownership after legality/salary rejection. Never multiply marginal
ownership into a purported lineup probability. User exclusions do not shrink the
opponent pool; private projection edits are not public opponent knowledge.

Score compressed correctly sized fields on shared scenarios and use cumulative
score counts plus the exact payout primitive. Keep generation, screening,
selection and frozen audit random streams separate. Report Monte Carlo error
separately from uncertainty about roles/ownership. Reused outcomes do not create
additional independent football trials. Do not add ownership penalties or stack
bonuses again after the payout model already includes those effects.

**Acceptance:** field calibration beyond marginals; no naive rank scaling from a
small field; ties and total prizes reconcile; near-tied candidates remain labeled
uncertain. Release as research until predeclared held-out criteria are met.

### D. Portfolio selection and review

**Backend/full-stack:** select a user-sized portfolio under a declared objective;
include own-entry interactions in the final pass. Exposure limits are risk policies,
not guaranteed sources of value. Use `ceil(min_fraction*K)` and
`floor(max_fraction*K)` with exact decimal/count semantics. Surface conflicts
between locks and exposure caps; never silently exempt locks in the new mode.

Report requested/completed counts and revalidate incomplete portfolios. Distinguish
player, Captain, QB, primary-stack, primary-game, any-player-game and shared-value
exposures. Measure outcome/payout dependence instead of treating a two-player swap
as proof of diversification. Compare whole-lineup opportunity costs.

**Frontend:** show objective, data cutoff, confidence, constraints, concentration,
alternatives actually evaluated, and stale/partial states. Explain from metrics
and sourced evidence; no post-hoc invented football stories.

### E. Late swap — separate, gated release

Classic's staggered locks need accepted entry IDs, exact slot assignments, trusted
platform locks and supported remaining-game state. A score-equivalent slot
permutation can change editability. Do not move a locked player between slots or
add a started player. Never assume a kickoff delay makes a slot editable.

Condition on observable information only. Do not add current points to another
full-game draw; cumulative bonuses must be applied once and DST points may fall.
Hidden opposing players cannot be filled from a later standings export during
replay. Search feasible unlocked assignments and replacements; a generic
"behind means contrarian" rule is not the model.

Preserve reserved-entry metadata; a lineup-library file is not an entry-edit file.
Revalidate locks at export. File generation never establishes platform acceptance.

## 5. Architecture, security and agent boundaries

Keep fitting, joint simulation, field generation and large evaluations in bounded
artifact jobs using the existing executor conventions. No request-time heavy
fitting, per-route process pools, live Sleeper polling or simulation/projection
truth in Fantasy roster tables. Reuse existing private-results conventions only
where their contracts fit; shared models and private user runs have different scope.

A run manifest must bind rule/scoring versions, exact slate/salary hash, identity
mapping, forecasts and training cutoff, availability, ownership/field version,
contest fill/fees/prizes, private overrides/constraints, stage seeds, solver status,
code revision and (for swaps) live/lock state. Publish artifacts atomically. Changed
inputs make results stale without erasing historical snapshots.

Authorize every job/result/export, include private input hashes in cache keys,
reject arbitrary artifact paths and bound uploads/compute. Preserve repeated CSV
slot headers positionally. Keep ordinary analytical CSV injection protection
separate from the provider's accepted entry-upload format.

The LLM can reconcile news/entities, propose reviewable assumptions, flag anomalies
and explain outputs. It must not invent route percentages, ownership, probabilities,
scoring arithmetic or ROI. Deterministic code and fitted models own those tasks.

## 6. Data and evaluation priority

The most useful next bundle is one raw Classic salary CSV and one raw Showdown
salary CSV, exact contest fees/entry limits/payouts, matching pre-lock projection
snapshots with column meanings, full historical standings and any archived pre-lock
ownership. A supported DST source/model is blocking; Showdown also needs kickers.

Import-first keeps the product independent of any new paid provider. An internal
ownership model is a later experiment: archive broadly, fit on pre-lock features,
validate chronologically by game/slate groups, and compare to imported/simple
baselines. Many contests on the same games are not independent football outcomes.
Post-lock data cannot be relabeled as pre-lock evidence by changing a timestamp.

Measure football calibration, legal-field calibration, and decision-engine returns
separately. Compare against existing/mean/stack baselines and ablate field/portfolio
layers. Report compute and uncertainty; a positive week or larger simulation count
is not proof of an advantage. A failed improvement hypothesis is a valid result.

## 7. Tests and actual verification

The foundation tests cover immutable unit contracts, unsupported/missing inputs,
Classic/Showdown identities, exact rational ties across the cash boundary, own-entry
interactions, compressed field counts, negative scores, free-contest ROI and fail-closed
readiness. Exhaustive five-entry score fixtures and seeded random fields check
payout conservation and agreement with an independent rank calculation.

Actual local checks for this change:

```text
PYTHONPATH=. python -m pytest tests/dfs_gpp/test_foundation.py --noconftest -q
79 passed
PYTHONPATH=. python -m compileall -q src/products/dfs_gpp tests/dfs_gpp
passed
```

Tests ran on Python 3.13.5 / pytest 9.0.2 in an isolated copy containing the new
modules, not a complete repository checkout. `--noconftest` explicitly excludes
the repository's global Hub/cache fixtures, whose dependencies were not available.
This is **not** a full integration or regression pass. No venv was present; direct
repository cloning was unavailable in this environment. No dependency upgrades or
fixture bypasses are added to repository configuration.

Before merge, run the repository-prescribed full backend gate in its supported
environment. No frontend code changed; frontend tests/build and visual checks were
not run. Keep the PR draft; do not activate production metrics or claim profitability.
