# DFS GPP foundation

Implemented September 28, 2026, using the supplied Classic and Showdown guides
as design references. This is a correctness and candidate-coverage milestone,
not a completed tournament model or evidence of profitable play.

## Changes in the existing builder

- Classic and single-game DFS retain all weekly projection rows before the
  salary join. The season-long top-per-position limit is unchanged. This
  prevents low-cost players from disappearing solely because of NFL-wide rank.
- Missing quantiles remain missing instead of becoming zero. The existing
  eligibility filter excludes incomplete forecasts until estimates are imported.
- Salary matching requires normalized name, team and position. A team or
  position mismatch leaves the slate player visibly unprojected. Ambiguous
  join keys fail with a diagnostic instead of selecting the last matching name.
  Existing team-alias normalization is retained.
- Both solvers reject duplicate canonical player IDs before optimization.
- Single-game duplicate cuts distinguish Captain plus the unordered FLEX set.
  With `max_overlap=6`, a different Captain with the same six athletes is a
  distinct candidate; FLEX permutations never create additional candidates.
  Lower overlap settings remain hard player-count restrictions. The UI now offers Captain change only in Minimum differences for single-game
  formats; Classic and season-long still require at least one changed athlete.
- Multi-lineup responses report `requested_count`, `complete`,
  `exposure_valid`, `exposure_violations`, and `exposure_basis`. Exposure checks
  use the actual returned count, while generation limits use the requested
  count. Legacy total-exposure lock exemptions remain explicit; Captain limits
  are checked separately. Partial results remain available for review and the
  existing build notice displays their warning.

## Validation

Regression fixtures cover all five formats' pool retention, missing quantiles,
team/position mismatches, ambiguous mapping, duplicate entity IDs, complete and
partial portfolios, lock exemptions and Captain exposure. An exhaustive
six-athlete fixture checks all six Captain choices, objective ordering and
termination without duplicate FLEX permutations. Existing salary, slate,
optimizer and results tests also run.

Validation on the isolated PR branch based on `origin/master` (`26f2dc6`):
`PYTHONPATH=. python -m pytest tests/test_api_lineup.py tests/test_dfs_salaries.py
 tests/test_lineup_optimizer.py tests/test_dfs_slates.py tests/test_dfs_results.py
 tests/test_player_name_match.py -q` using the existing workspace venv: **98 passed**.

The earlier working-copy pass had 84 passing focused tests. Its full `tests/`
run was stopped after `test_refresh_allowed_when_site_auth_is_off` failed on a
missing refresh-response `status` key; an isolated rerun reproduced that failure.
That run included unrelated local edits and is not a full regression result for
this PR branch. No frontend source changed; frontend and visual checks were not
run. No deployment was performed.

## Related work

[Draft PR #561](https://github.com/RandomStatsGuy/ScoreSense/pull/561) adds standalone
contest contracts, scoring identities, exact payouts and readiness primitives.
This change improves the existing builder and does not duplicate those modules.
The roadmap link is separate from #561's tournament-strategy section to avoid a
documentation conflict. The merged name-alias recovery from PR #529 is retained,
with team/position guards on the suffix pass and consumed rows removed before
the fuzzy pass.

## Remaining dependencies and next milestones

1. Versioned slate/rule/scoring contracts and immutable provenance. The guarded
   name/team/position join is still a fallback, not a persistent provider-to-
   canonical identity registry. Existing salary-ratio Captain inference and
   export validation have not been replaced by certified rule adapters.
2. Complete site-scored outcome models, including supported DST and kicker
   distributions, with chronological held-out calibration. The fixed DST
   estimate and three player quantiles do not support contest-return claims.
3. Shared game outcomes, a contest-conditioned opponent field, complete cash
   payout tables and exact tie allocation including all own entries. Require
   historical full fields paired with pre-lock forecasts/ownership to validate
   this layer; do not infer ownership from missing data or use low ownership as
   a substitute for expected payout.
4. Independent candidate evaluation, portfolio selection and a frozen audit,
   with uncertainty and explicitly gated research/validated capabilities.
5. Treat late swap as a separate feature requiring accepted entry IDs, exact
   locked slots and reliable decision-time live state.

The shipped objectives remain sums of P50, P10, P90 or value inputs. P50 is not
a mean, sums of player quantiles are not lineup quantiles, and projection jitter
is not a joint simulation. No forecast, ownership or payout metrics are
fabricated, and no model fitting or new simulation is added to API requests.


## Follow-up: independent checks and Captain control

Generated rows now pass an independent roster/pool check before the optimizer
API returns success. It checks roster slots and positions, source identity and
slot-specific IDs/salaries, projection multipliers, salary totals and limits,
locks, team limits, single-game team representation, and scoring-lineup uniqueness.
Failed validation returns no usable lineup. Missing export IDs remain usable for
preview but are explicitly reported and continue to block site exports.

Export checks also verify position eligibility and unambiguous catalog identity,
including canonical player ID when available. Existing file formats and reserved
entry metadata are preserved. These checks are not certification of game membership,
site scoring, current lock state, stack policy, or site submission acceptance.
Versioned rule/slate snapshots and all-Captain candidate comparisons remain next.

The single-game Minimum differences menu exposes Captain change only. It sends
max_overlap=6 and explains that repeated scoring lineups remain excluded. Switching
to Classic or season-long restores one changed athlete. Default settings are unchanged.


## Follow-up: build records and Captain comparisons

[Build records and API contract](DFS_BUILD_SNAPSHOTS.md) now capture versioned
legacy roster settings and exact eligible inputs, preserve the effective random
seed, and retain the record through Save build. An opt-in bounded API comparison
solves and independently validates a complete lineup for every eligible Captain,
reporting unresolved and unexamined candidates explicitly. The review UI and
verified platform scoring/exact-slate source contracts remain outstanding.
