# DFS build inputs and Captain comparisons

This milestone extends the existing optimizer after PRs #562 and #563.
It does not depend on or duplicate the standalone payout/readiness modules in
open draft PR #561. The supplied Classic and Showdown guides are design references,
not instructions to enable unvalidated tournament metrics.

## Build records

`POST /api/lineup/optimize` now returns `build_snapshot` alongside its usual result.
The browser retains it in the existing saved build's `settings.build_snapshot`.
Existing builds without this field remain readable; no database migration is needed.

- `id`: SHA-256 of canonical JSON content (not including capture time).
- `captured_at`: server capture time, not source publication time or proof of pre-lock availability.
- `content.schema_version`: `dfs_build_inputs_v1`.
- `content.rules`: versioned copy of the current legacy roster configuration,
  with its own content hash. Certification remains `unverified`.
- Exact eligible solver players, joined input-pool records including nulls,
  resolved constraints, objective, effective seed, engine and numerical-library versions.
- Source context: requested week/season, resolved pool metadata, injury-adjustment
  flag, private projection overrides, and the client-provided slate label.
- Comparison budget/version when requested.

The serialized frozen record cannot be changed through nested caller references.
Returned JSON is a copy. `verify_build_snapshot` detects content alteration but is
not a cryptographic signature: clients can recalculate hashes. Saved client payloads
must never attest to readiness or platform certification. Existing account-scoped,
insert-only build storage is reused; unsaved responses are not durably archived.

Unseeded projection jitter receives an explicit seed before solving. Supplying
that seed and the same inputs reproduces the tested build on the recorded engine.
Input row order is preserved because solver tie-breaking may depend on it. Numerical
library or engine changes can change tied solutions. This is not a replay endpoint.

This is a versioned **legacy roster/build record**, not an exact-slate provider
registry or complete site-scoring adapter. It does not certify game membership,
lock state, bonuses, DST/kicker distributions, provider identity, or input freshness.
Missing source publication/model metadata is not invented. Full trusted historical
source snapshots and verified scoring remain separate work.

## Captain comparison API

Opt in on the existing endpoint:

```json
{
  "site": "draftkings_showdown",
  "slate_id": "your-slate-label",
  "lineup_count": 1,
  "objective": "median",
  "include_captain_comparison": true
}
```

Use the existing salary and projection inputs for a real slate. The slate label is
client context only; it does not establish membership. FanDuel single-game also
uses its current legacy MVP configuration. The single-game workspace now offers Compare Captains as a separate read-only
diagnostic. It explains which constraints apply before running and leaves the
current portfolio intact. Candidate disclosures show full lineups, salaries,
objective sums and gaps from the best evaluated candidate. Input changes clear
the report and cancel/discard late responses. Partial and failed comparisons
stay explicit. Comparison reports are transient; Save build continues to save
the original portfolio and its own input snapshot.

The comparison solves a complete lineup under each eligible Captain, retaining
current locks, exclusions, salary range and team limit. A Captain lock narrows the
comparison to that player. It never requires choosing the highest raw-scoring player:
a regression fixture demonstrates how a cheaper Captain permits a better full lineup.
Each successful candidate passes the independent lineup validator.

Only one deterministic build without stack or portfolio exposure settings is
supported. Unsupported combinations fail explicitly. Normal portfolio construction
is unchanged. The existing quantile/value objectives remain the only objectives;
summed player quantiles are not lineup quantiles, means, win probabilities or payouts.

Response `captain_comparison` binds to the build snapshot ID and includes:

- Every eligible Captain and its status: `optimal`, `infeasible`, `unresolved`,
  `invalid`, or `not_evaluated`.
- Validated lineup, unrounded objective sum and gap from the best evaluated candidate.
- Eligible/evaluated counts, completeness, best evaluated Captain and budget.

The diagnostic budget is at most 60 eligible Captains, 10 seconds of scheduled
comparison work and 1 second per MILP, with zero requested relative MIP gap.
The deadline is checked between solves; solver/setup overhead can exceed it. A pool
above the Captain cap is reported wholly unexamined instead of silently pruned.
Timed-out solves are unresolved, never declared infeasible or optimal. Completeness
requires every eligible Captain to have an optimal or proven-infeasible solve.
These limits apply to the added comparisons, not the existing baseline build.

## Verification

Tests cover frozen copies and tampering, input sensitivity and missingness, seeded
reproducibility, account isolation, real API integration, exhaustive small-slate
Captain objectives, salary reallocation, locked players, exclusions, both
single-game formats, timeout/deadline reporting and corrupt-solver rejection.

The browser fixture checks server snapshot retention through Save build, Captain
rotation and format switching at 1280 and 390. It uses real components with mocked
responses; it does not verify the authenticated live page or provider data.


## Retained salary catalogs

Authenticated loads/imports now bind builds to an account-scoped retained salary
catalog via `salary_snapshot_id`. See [catalog checks and boundaries](DFS_SALARY_CATALOGS.md).
The build snapshot embeds the resolved catalog summary in source context. Legacy
requests remain explicitly unbound; scoring and game-lock certification remain false.
