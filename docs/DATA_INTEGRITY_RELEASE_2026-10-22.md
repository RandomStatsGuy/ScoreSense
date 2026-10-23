# Data integrity release — October 22, 2026

The reconciled repair is deployed and healthy. The source backfill completed successfully, and all three Pickens IDs return matching projections and complete game history. All 13 fitted models are unchanged after the backfill. The actual running production UI and the public Cloudflare origin both pass the alias, responsive, visual and interaction checks.

The [initial audit](DATA_INTEGRITY_AUDIT_2026-10-22.md) records the historical investigation and older checkout's results. Its statements that deployment/backfill were not performed describe that earlier point in time. This report records the subsequent release and must be read separately from those historical observations.

## Release and preserved contracts

| Item | Confirmed result |
|---|---|
| Release commit | `eb7880e73f9c79bedfcff48aa63d4875535b726b` — Repair canonical projection reads and source backfills |
| Production Git baseline | `master` at `1e6cb4189ac5c9338246af17406dceb566598f7e` |
| Reconciliation baseline | `develop` at `683699ff8f54d64a912bac2d8440b2a8c4f1421f`, with the same source tree as that production baseline |
| Deployment window | October 22, 2026, **19:36:53–19:38:21 UTC** |
| Deployment package | Bounded archive of **36 source files**; all reviewed source hashes match on both the host and live API container, with zero mismatches |
| Deployment health | Healthy after release; frontend build `8b9de425-4adf-46cb-a1c7-b01fc02f22e5` |
| Fitted models | **13 before / 13 after**; identical model file set and SHA-256 hashes at deployment and after the no-retrain backfill |

Production was deployed from the bounded archive: the host Git HEAD remains the baseline `1e6cb4189ac5c9338246af17406dceb566598f7e`, while the actual running `build_info` identifies release `eb7880e73f9c79bedfcff48aa63d4875535b726b`. The host/container manifest comparisons establish which source is running.

The fixes were reconciled in an isolated release checkout rather than uploaded from the original dirty working tree. The newer production recovery coordinator, prepared weekly contexts, shared worker, cache finalization, and public-read restrictions were retained. Stored roster/transaction IDs and financial records are not migrated by these read-side identity fixes.

Cards resolve GSIS, bare Sleeper, and prefixed Sleeper IDs before reading projections and recorded history. TE keeps its true position while using the receiver model. Unsupported forecasts and unresolved identities remain explicit. The recorded-game derivative preserves provider PPR totals, missing values, event teams, and schedule context before training transformations. Completeness requires accounted-for finalized games; a missing player row does not prove inactivity.

Prediction publications carry authoritative metadata inside the atomically replaced parquet. A damaged compatibility sidecar cannot invent another generation. Invalid or failed replacements retain the previous valid publication; retained weekly/ROS memory forecasts are explicitly marked stale. Identity freshness uses the production semantic input revisions, so identical provider-cache rewrites do not falsely invalidate forecasts. Source changes during inference/publication fail visibly rather than relabel an old forecast as current.

## Refresh operation

The existing cron now invokes the module CLI instead of an inline Python call with hardcoded ingestion years and a discarded return value. Its **Tuesday 10:00 UTC schedule, existing locks, and retraining behavior are preserved**. Production's normal full-refresh/training default was retained. The reconciled production CLI returns an explicit busy result and exits **1** when the refresh cannot start; the older checkout's exit-75 implementation remains historical audit evidence. The manual source backfill explicitly uses:

```bash
python -m src.jobs.weekly_refresh --no-retrain --ingest
```

That command ingests recorded results and model inputs, then rebuilds forecasts with the existing fitted models. Ingestion defaults cover the continuous historical range through the active NFL season; training/evaluation splits remain separate. Completion is recorded only after the shared artifact and consumer-readiness gates pass.

The authorized backfill started at **2026-10-22T19:39:02.326941Z** and completed with both status and stage `completed` at **2026-10-22T19:52:20.470594Z**. The operator recorded **exit 0** at **19:52:21.450103Z**, after **799.12 seconds**. It ingested **2018–2026**, did not retrain, and returned an empty warnings list.

Preparing the historical 2025 pool exposed a source-revision change. The guard refused the mixed-revision publication and retained the last good pool. The successful final result reports `projection_cache_readiness: ready`, **2 attempts**, and `source_backfill: ready`: all **93 finalized games / 186 team games**, source coverage through **Week 6**, and **0 missing score rows**. This confirms completion through the consumer-readiness gates, rather than merely observing a container start.

The exact cause of the historical October refresh gap remains unknown: the old logs recorded container creation without an attempt outcome. The repaired invocation makes future job outcomes observable; it does not retroactively establish that cause.

## Verification before and during release

| Check | Result and boundary |
|---|---|
| Final affected Python gate | **473 passed**; `outputs/release-tests/affected-final.{log,xml}` |
| Frontend tests | **1,435 passed**, zero failures; `outputs/frontend-release-tests.log` |
| Production frontend build | Passed, including PWA generation; `outputs/frontend-release-build.log` |
| Complete Python suite | **4,359 passed, 54 failed, 2 skipped**; `outputs/release-tests/full-final.{log,xml}` |
| Failure triage and retest | **53 passed, 1 failed** from those 54 cases; `outputs/release-tests/failure-retest.{log,xml}` |
| Remaining full-suite failure | Unchanged `test_fixture_matches_2025_sheet_salaries`: **152 matched, 3 unmatched, 1 duplicate** with the local catalog |
| Rendered card scenarios | **28 passed** at **1280 and 390**; production components with synthetic responses, measured layout checks and inspected screenshots; `outputs/player-card-release-browser.log` and `outputs/agent/player-card-integrity/` |
| Live production card API and completed backfill | Passed as detailed below |
| Actual running production UI | All **13 layout checks passed at 1280/390**, all six screenshots inspected, no runtime errors, close/focus behavior passed through SSH loopback; `outputs/agent/production-card-verification/report.json` |
| Public Cloudflare-origin browser | Passed in actual Edge: same-origin alias requests, matching projections/history, completed refresh, all **13 layout checks at both widths**, six inspected screenshots, close/focus behavior and no JavaScript errors; `outputs/agent/production-card-verification/public-origin-retry/report.json` |

The remaining cap-sheet failure was reproduced by executing the baseline Git parser and fixture in memory with cached data only. The parser, dependencies, test, and cap fixture were unchanged. Unmatched entries are B. Thomas (WR), K. Walker (RB), and A. Richardson (QB). The full suite is therefore **not represented as fully passing**. The 53 repaired failures include meaningful fixture updates for the coherent metadata/raw-source contracts and verification of actual reader fixes; validation was not weakened to accept invalid publications. Test counts overlap and are not additive.

## Final production acceptance

Every card was checked in the same **2026 Week 7 PPR** context. All three alias results were identical after canonical resolution:

| Requested Pickens ID | Canonical ID | Weekly P50 | ROS P50 | Recorded history |
|---|---|---:|---:|---|
| `00-0037247` | `00-0037247` | 10.338 | 113.5 | Weeks 1–6, complete |
| `8137` | `00-0037247` | 10.338 | 113.5 | Weeks 1–6, complete |
| `sleeper-8137` | `00-0037247` | 10.338 | 113.5 | Weeks 1–6, complete |

The six displayed game scores match the raw recorded source exactly: **5.8, 10.0, 15.2, 9.5, 28.0, 13.3** for Weeks 1–6. The card reports **81.8 YTD points**, **13.63 PPG**, and complete history coverage. Raw-source ingestion is recorded at **2026-10-22T19:39:19.398396+00:00**. This reconciles actual source values and totals, not just nonempty responses.

QB, RB, and WR source cutoffs are all **Week 6**. The checked weekly/ROS artifacts are **version 1, ready**, with matching sidecars and current identity revisions; card recovery is **idle**. Durable full-refresh completion, source coverage, matching alias projections, exact recorded rows, and consumer readiness have therefore passed the production API checks.

All **13 model files and SHA-256 hashes remain unchanged** after the no-retrain backfill. The host and live API container also match all **36 reviewed source hashes**, with no mismatches. Retained production evidence in the original workspace is `outputs/data-integrity-audit/production/release-acceptance.json` and `release-operation-evidence.json`.

Rendered verification of the **actual running production app** passed through the SSH loopback (`127.0.0.1:18080`): weekly **10.3**, ROS **113.5**, YTD **81.8**, displayed PPG **13.6**, and six game rows. All **13 layout checks pass at both 1280 and 390**, with no runtime errors and correct dialog close/focus behavior. All six `pickens-{weekly,ros,history}-{1280,390}.png` screenshots in `outputs/agent/production-card-verification/` were inspected. The report identifies frontend build `8b9de425-4adf-46cb-a1c7-b01fc02f22e5`.

The **public Cloudflare origin also passed full acceptance in actual Edge**, using same-origin browser requests: all three IDs returned matching **10.338 weekly P50 / 113.5 ROS P50**, identical complete Weeks 1–6 history and **81.8** recorded points. The browser verified the new completed refresh timestamp and release build. All **13 layout checks passed at 1280 and 390**, with correct close/focus behavior and no JavaScript errors. All six public-origin screenshots were inspected. Authoritative public-browser evidence is `outputs/agent/production-card-verification/public-origin-retry/report.json` and its adjacent screenshots. The 28 synthetic component scenarios remain separate evidence; the live results above exercise the released app and real backfilled production data.


## Cap-sheet follow-up — local repair, not deployed

The subsequent request to fix the remaining cap-sheet failure uncovered an actual pre-existing parser defect, rather than only an unstable test dependency. **This cap-sheet change is not part of deployed release `eb7880e73f9c79bedfcff48aa63d4875535b726b` and has not been deployed in this follow-up.** The production release, backfill and source-hash observations above remain historical evidence for that deployed version.

The sheet omits generational suffixes while the provider's `last_name` can contain `Thomas Jr.`, `Walker III`, `Richardson Sr.`, `Robinson Jr.` or `Gordon II`. The old parser compared those provider surnames literally after stripping the suffix only from the sheet input. It therefore missed three players, mapped Brian Robinson to Bijan, and could map Ollie Gordon to Melvin when only the unsuffixed surname candidate was considered.

The local fix uses the shared suffix-aware name key for unique full-name matches and surname candidates, retains the position boundary, and requires a matching first initial even for a unique surname. Returned provider names and IDs remain intact. The existing ranking and abbreviated Brian/Bijan policy are unchanged. Tests now assert Brian Robinson **8154** separately from Bijan **9509**, and Ollie Gordon **12495** rather than Melvin **2320**. Wrong initials, wrong positions and missing Ollie remain unmatched.

The cap import/validation tests use a deterministic fixture of **508 recorded public provider identities**, including competing and historical names, without fetching a provider or changing the runtime catalog. Against that same fixture, an independent in-memory comparison of the exact baseline and repaired parser produced:

| Parser | Matched | Unmatched | Duplicates | Identity check |
|---|---:|---:|---:|---|
| Baseline | 152 | 3 | 1 | Brian → Bijan; Ollie → Melvin |
| Repaired | **156** | **0** | **0** | Brian → 8154; Bijan → 9509; Ollie → 12495 |

Focused verification passed **31 tests** (`outputs/release-tests/cap-sheet-targeted.{log,xml}`); the final cap import/validation gate passed **25 tests** (`outputs/release-tests/cap-sheet-final-targeted.log`). These suites overlap and are not additive. The full-sheet salary assertions were retained and strengthened with exact Brian/Bijan/Ollie identity checks.

**Fresh complete backend suite: 4,428 passed, 2 skipped, 0 failed**, exit 0, in **1,259.39 seconds (20:59)**. The complete `pytest tests/ -q` run finished without a failure-count cutoff. Both skips are existing environment conditions: the draft Excel workbook is not present locally, and Hub authentication is disabled for the WebSocket-auth case. The seven warnings are existing dependency deprecations. Evidence is `outputs/release-tests/full-cap-sheet-fix.log`, `full-cap-sheet-fix.xml` and `full-cap-sheet-fix.outcome.json`. This successful full run supersedes the earlier failing validation as the current branch result; the historical production-release counts above remain preserved. The cap-sheet fix is on `codex/data-integrity-release` in draft PR #818 and remains undeployed.
