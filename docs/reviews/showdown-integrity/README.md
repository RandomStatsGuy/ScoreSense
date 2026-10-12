# Showdown decision integrity

Baseline: `51d0210c1e294f3fc49305ba5c29c72282a292a5` on `develop`.
Scope: the [supplied single-PR plan](../ScoreSense_Showdown_Integrity_One_PR_Plan.md), version 0.2.1.
The approved Build → Review → Download layout remains in place.

## Confirmed and unconfirmed findings

| Finding | Evidence and result |
|---|---|
| Ceiling list displayed the projection sum as generic points | Confirmed in code. Showdown now separates the Captain-weighted P90-input score and projection sum, with explicit units/statistic/conditioning. |
| Captain inputs were already weighted by the solver | Confirmed. Shared pure scoring sums weighted coefficients once; display precision does not replace raw legacy response precision. |
| Receiver-Captain pairing was absent | Confirmed. Require/Warn/Off is a strategy policy, resolved by verified QB role or an explicit approved identity. Require is the new DraftKings Showdown configuration default; missing historical keys retain legacy behavior. |
| Name-based opportunity adjustments could collide | Reproduced with two synthetic same-name canonical WR identities on different teams. Two tests failed before the fix and passed after row/identity alignment was corrected. No player's projection was tuned by name. |
| Existing forecasts might retain pre-fix composition | The weekly/deep pool revision invalidates the old inference policy. No regenerated forecast/model data is included in the PR. |
| Exact reported BUF–LAR build and its omissions/exposures | **Not reproduced.** The original twenty-lineup file, pinned salary slate and build manifest were not supplied. |
| Reported player values were wrong because a vendor differed | Unconfirmed; vendor estimands and conditioning are not established. No projections were replaced with another vendor or forced into a lineup. |
| Current role or zero-score probabilities | Unavailable where absent from supplied inputs. Observed usage is not promoted to a current role forecast. |
| Calibrated tournament edge or ideal exposure | Unavailable. No retraining, field fitting, live contest-return optimization or profitable-exposure claim. |

The [read-only archive trace](forecast-archive-trace.json) records actual file
hashes and periods. This checkout has twelve weekly forecast artifacts covering
2025 week 19 and 2026 week 1, but none for the requested 2026 week 5. All nine case
subjects have zero rows in that requested archive context. Older forecasts are
not substituted as a reproduction of the missing build.

## Resulting behavior

Build keeps the existing count, goal and action. Receiver-Captain policy and
approved QB choices live under Advanced rules. Require is a user strategy rule,
not a DraftKings legality claim. Missing trustworthy QB identity is explicit;
an arbitrary backup never satisfies the rule. Native locks/exclusions and
existing total/Captain exposure semantics remain binding, with legacy total-lock
exemptions identified rather than silently changed.

Review separates objective score from projection sum, keeps status beside the
player name, groups recurring warnings and reports Total/Captain/FLEX-only
appearances using actual generated counts. Same-team RBs and offense opposing
DST remain legal warning cases. Source/role detail preserves unknown components.
At-build status and inputs remain immutable; latest status is separate, and a
confirmed inactive selected player blocks supported Showdown downloads.

Compare with this player completes a baseline and forced FLEX/Captain lineup
from the same bounded frozen input pool. Original single-lineup hard rules,
objective, locks and exclusions cannot silently change. Original portfolio caps
remain visible as context; the comparison does not certify a whole portfolio.
Explicit zero Captain caps remain Captain exclusions; positive portfolio
fractions are diagnostic context in a single-lineup comparison.
Hash-checked supplied snapshots establish content identity, not authenticity,
account ownership or current platform locks. Comparison does not load new
forecasts or reapply salary/point overrides. It never applies a replacement.
Failures/cancellation retain usable review, with account/context safeguards.

A personal review can be saved and reopened as history without changing active
controls, builds, entries or exports. The existing supported CSV and recovery
paths remain separate. No platform late-swap functionality is added.

## Offline measurement

`src.analytics.dfs_showdown_calibration` accepts bounded archived forecast and
declared official completed-game outcome arrays. It checks canonical/slate/scoring
identity, explicit pre-lock forecast/data/model/observed-period timestamps,
FLEX basis and availability conditioning. Later holdout weeks are separate from
earlier reference rows. Missing evidence yields coverage reasons, never zero
filled outcomes or a fictitious performance estimate.
The observed window must be ordered, and source/model evidence must be
available by the actual forecast issue time, as well as before kickoff.

Actual means get signed mean error. P10/P50/P90 get pinball loss, proportions
below/equal/at-or-below/above the threshold, and the discrete quantile condition;
P50 also gets median error. Zero-score frequency, Brier score and predicted
probability are available only when an explicit modeled zero probability exists.
Intervals resample whole slate/week blocks; one block leaves uncertainty unknown.
Reports group compatible source/model/scoring/conditioning/role/salary strata.
Source declarations are not authenticated, and no model is fitted or promoted.

The [coverage report](calibration-coverage.json) has no compatible supplied
pre-lock forecast/outcome cohort, so it contains **no calibration metrics**.
Synthetic tests establish calculation correctness only.

Example for a later permitted archive (from the repository root with `PYTHONPATH=.`):

```powershell
.venv\Scripts\python -m src.analytics.dfs_showdown_calibration `
  --forecasts forecasts.json --outcomes official-outcomes.json `
  --holdout-season 2026 --holdout-week 5 --output report.json
```

Each forecast row records season, week, slate_id, player_id, score_system_id,
forecast_at, data_known_at, observed_period_start/end, model_frozen_at,
kickoff_at, model_id, source_id/type, basis (`flex`), projection_statistic,
availability_conditioning and any actually available projection/P10/P50/P90,
salary/role bucket and p_zero. Outcomes record matching identities, points,
active state, basis, complete, source_id/type (`official_completed_game`),
ended_at and known_at. Declare synthetic calculation checks with `--synthetic`.

## Verification

| Check | Actual result |
|---|---|
| Whole-repository backend run | 3,907 passed, 2 skipped, 1 existing warning, 1,785.50 s |
| Consolidated DFS/Showdown/lineup/Vegas regression | 1,404 passed, 1 existing warning, 121.88 s |
| Final Showdown score/composition/rules/API/snapshot/calibration tests | 142 passed, 1 existing warning, 9.66 s |
| Injury/forecast/cache/refresh regression | 109 passed, 1 existing warning, 21.32 s |
| Final full frontend regression | 1,266 passed / 3 failed of 1,269, 24.439 s |
| Focused frontend regression | 48 passed, 243.908 ms |
| Final production build | PASS, 13.82 s; existing bundle-size warning |
| Instruction/product/living-surface checks | 49 passed, 3.71 s |
| Existing Classic export/recovery smoke | PASS, 390 dark; sealed CSV and exact worker recovery |
| Production-component Showdown tasks | PASS, 6 width/theme cases, 18 layout states, 8 guard groups |

The full and broad affected runs started before the final malformed-snapshot
scalar and forecast-issue-time guards; the final 142 cover those changes and
explicit zero Captain exclusions. Runs overlap and are not added together. The existing
Starlette warning is the `BlockingPortal` deprecation. Raw logs remain local
under `outputs/` and are not committed. The Windows Node runner requires test
files to be enumerated explicitly; all frontend tests and the layout unit suite
were included.
The full test run wrote two draft-pool cache files inside this isolated checkout;
their original tracked versions were restored before publication. The primary
checkout's caches and league data were not changed by this task.

All three frontend failures were independently reproduced on the exact
unchanged baseline, without weakening tests:

- `auctionAwardContractLabel describes locked rookie and vet deals`
- `accuracy copy names the miss, not a trust slogan`
- `My team keeps the approved summary above a flat roster`

The original numerical/identity/source refresh-equivalence assertions remain
intact. Only new per-run provenance timestamps/hashes are compared separately;
those fields must be present, context-correct and absent on unavailable rows.

| Layout width | Light | Dark |
|---|---|---|
| 390 | PASS | PASS |
| 768 | PASS | PASS |
| 1280 | PASS | PASS |

The [browser receipt](browser-receipt.json) records actual components/workers
and engine-generated **synthetic** responses with all network requests
intercepted. It exercises pairing/build, objective versus projection scores,
warning inspection, frozen forced-player completion, save/reopen and supported
site CSV download. Guard checks cover keyboard/focus, failure/mismatch retention,
cancellation/late responses, fresh account access, confirmed inactive download
blocking, immutable Questionable beside Latest Out with a timestamp, stale-input
responses and account clearing. Existing history remains unchanged.

Final desktop and phone screenshots were visually inspected:
[desktop review](review-1280-light.png), [phone review](review-390-dark.png),
[desktop comparison](comparison-1280-light.png), [phone comparison](comparison-390-dark.png).
Other Fantasy, Projections and Results surfaces were not visually rechecked.
No original twenty-lineup reproduction, authentic platform/current lock feed,
real-user acceptance, deployed version, contest submission or live entry is
verified by these fixtures.

## Requirement coverage

| Plan acceptance cases | Evidence |
|---|---|
| 1–3: objective/statistic/units and Captain once | `test_showdown_integrity.py`, `test_dfs_showdown_rules.py`, `dfsShowdownReview.test.js`; actual synthetic 217 P90-input score versus 152 projection sum |
| 4–5: status propagation and frozen/current separation | Pool/solver/comparison/snapshot status regressions; browser immutable Questionable beside Latest Out guard |
| 6–9, 12: pairing, verified identity, locks/caps and legacy settings | `test_dfs_showdown_rules.py`, `test_dfs_showdown_snapshot.py`, `test_dfs_showdown_api.py`; explicit zero Captain exclusions retained |
| 10–11: warning-only combinations and actual-denominator exposures | Shared audit tests including synthetic 12 total / 8 Captain / 4 FLEX-only of 20 |
| 13–14: deterministic frozen counterfactuals and no mutation | Solver budget/conflict tests, frozen API no-live-load tests, browser history/cancellation/staleness checks |
| 15: demonstrated input defects | Synthetic same-name opportunity collision red/green; cache policy and status-alias propagation regressions |
| 16–17: unknowns, discrete quantiles and cutoff leakage | Provenance/calibration tests; missing pre-lock cohort produces coverage only |
| 18: Classic, exports, recovery and account boundaries | Consolidated 1,404-test regression plus Classic browser export/recovery smoke and fresh-access/account guards |
| 19–20: responsive end-to-end task | 390/768/1280 light/dark receipt, inspected screenshots and eight behavior guard groups |

SD-01 through SD-07 have scoped engineering implementations. SD-08 has the
offline calculation/coverage tool, while real archived-cohort measurement remains
unavailable. No numbered test case turns the missing original audit into a pass.
