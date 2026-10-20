# Data-loading performance investigation — 2026-10-19

## Scope and evidence

The requested production timings are diagnostic leads, not a seven-day baseline.
The matching local server export, `scoresense-server-20261019-2024.json`, reports
response-complete timings: salaries/load 3517.6 ms (6), slates 1643.1 ms (4),
predict 1521.5 ms (5), and native.snapshot.hit 167.2 ms (138). It describes a
single Linux API worker on two CPUs, deployed revision `7027895f6093`.
The user's job summary covers about 68 minutes despite requesting seven days.
The available local jobs export is older (October 13, 222 rows spanning 53.2
minutes) and is not the same recording. It shows CPU-heavy DFS/projection jobs
and small recorded queue waits, without request correlation.
Neither export establishes a causal link between a job and a slow request.

This investigation used the current Windows checkout, `a6dca0c7` plus existing
local edits. The deployed commit object is unavailable locally. Results below
are local measurements, not a predicted production percentile. Existing work
was retained; this change does not optimize season_refresh, scheduler policy,
disk retention, models, scoring, or native snapshot representation.

## Confirmed causes and focused change

`lineup_slates` fetched the public DraftKings lobby twice: once for the visible
list and again through `pick_default_slate`. A single live upstream call took
1057.9 ms and returned about 2.5 MB. Six original route calls reproduced a
1965 ms median. Individual lobby parsing calls took approximately 3 ms; network
access plus response JSON decoding dominated. This is the demonstrated cause
addressed here. A second cold-cache profile isolated repeated identity indexing:
the pool's three `_index_sleeper` calls consumed 3.744 of 4.173 profiled seconds
(90%), mostly converting unused fields to dictionaries and normalizing names.
The prediction profile attributed 1.172 of 1.838 profiled seconds to the same
index plus 0.458 seconds to initial player-frame loading. These are attribution
profiles, not comparable unprofiled latency samples.

`src/integrations/dfs_slates.py` now resolves list/default from the same raw lobby
response and combines simultaneous identical public-lobby fetches. Its key is
the exact provider URL and sport. Only the pending fetch is retained. Success
and failure remove it, so later requests always contact the provider and see
updated contest/slate data and time transitions. Parsed output belongs to each
caller. There is no new TTL, persistent cache, user/league overlay cache, or
shared FanDuel authenticated response. Category classification, sorting, empty
results, and the existing default fallback behavior are preserved.

`app/api.py` uses that discovery helper. The route stays synchronous under
FastAPI's existing worker-thread execution. No process/thread limits changed.
Salary metadata lookup also uses the shared pending lobby fetch when it overlaps
discovery. A standalone salary request still performs its own fresh lobby read.

`src/integrations/roster_identity.py` now indexes only the five fields actually
used for identity resolution: GSIS ID, name, team, position and status. A bounded
four-revision cache reuses this private lookup by a digest of the ordered input
fields, columns and dtypes. It works for both default sources and explicit
caller frames; an in-memory edit or reordered duplicate name is a different
revision. Concurrent identical builds share a future; failures permit retry and
different revisions can build independently. No lock spans a build. Changes to
unrelated source fields do not invalidate a lookup that never consumes them.
Projection rows, injury adjustments, schedule/bye calculation, scoring and
league data are not cached in this lookup. Existing source/overlay TTLs and
season/week-specific overlay keys remain in effect. The lookup itself has no
clock-dependent input, so it remains valid across time transitions until one of
its five inputs changes.

## Traced paths and costs

| Path | Actual work and observed boundaries |
|---|---|
| slates | Auth, public lobby HTTP/JSON, category parsing and default selection, FastAPI encoding/delivery. No model, league DB, native snapshot, or schedule calculation. |
| salaries/load | Lobby metadata; salary parquet read/ID validation or provider fallback; captain collapse; context from QB features; three weekly artifacts and roster identity overlays; schedule/bye flags; canonical identity/salary join; row conversion; FastAPI encoding/delivery. |
| predict (explicit season/week) | Fingerprint/stat validation, weekly parquet/in-memory frame, roster identity overlay, opportunity columns, records conversion, movement artifact/index join, FastAPI encoding/delivery. Missing artifacts already dispatch inference through the existing process pool. |
| native cached snapshot | Separate native lineup/scoring consumers. Disk path reads/parses JSON; both disk and memory paths deep-copy the nested snapshot. The memory path copies under its own native lock. |

The warm live salary probe's pool took roughly 27–37 ms after warming, salary
join 90–139 ms, and response construction 38–61 ms. Fresh lobby reads remained
roughly a second. Its first request also exercised salary-provider fallback and
cold roster/feature loading: 6565 ms before and 4763 ms after, one sample each,
with pool work 4123/3331 ms. Those first requests have different cache/provider
conditions and are **not** comparable optimization results. The existing public
salary cache was populated by its normal fetch path during this diagnostic.
No inference/retraining or projection artifact rebuild was triggered.

An independent cache-read diagnostic measured explicit predictions at 11.7 ms
warm (5 samples) and pool construction at 37.8 ms warm (5). Its separately
profiled cold calls found parquet/import/roster work, not a native reader.
Profiled elapsed times are excluded from unprofiled latency comparisons.

The current native reader used an existing 2,196,698-byte snapshot. Unprofiled
memory hits had a 75.0 ms median (5), disk reads 112.1 ms (5). Separate profiles
attribute virtually all memory-hit CPU time to `copy.deepcopy`, and most disk
time to that same copy after JSON loading. This explains local hit cost without
assuming that it lies on the three named routes. Tests of the full route
responses with native readers forbidden also verify the lack of direct access.
The deployed telemetry label is absent from this checkout, so exact deployed
timer boundaries remain unverified.

## Live lobby-change isolation

These measure handler completion with a real public upstream, excluding ASGI
serialization and internet delivery to a browser. Each series has six calls;
the first is reported separately and five subsequent calls supply the warm
median. There is no persistent lobby cache in either version.

| Route | First before → after, ms (1 each) | Warm before → after, ms (5 each) |
|---|---:|---:|
| slates | 1961 → 1377 | 1967 → 1069 |
| salaries/load | 6565 → 4763, differing cold states | 1274 → 1364 |
| explicit predict/QB, 2026 week 6 | 11.9 → 15.5, already warmed by salary loading | 8.8 → 11.9 |

Across all six slate calls the median changed from 1964.2 to 1115.0 ms, about
43% lower despite a slower upstream in the second series. No improvement is
claimed for standalone salary or prediction requests from the lobby change
alone. These measurements preceded the identity-index change. The exports do
not identify whether the production samples were cold or warm; their query/cache
state and concurrent work are missing.

## Response-complete concurrency and background work

Controlled replay uses the captured lobby body, 950 ms upstream delay (close to
the observed live call), real app routes and full ASGI responses. It excludes
TCP, Cloudflare, browser delivery, and startup jobs. The prior path is replayed
by restoring its original list/default calls and independent fetches. Temporary
SQLite databases isolate preferences; the actual non-blocking refresh lock is
held with a running refresh-status fixture. Six batches each issue six concurrent
slate requests and four refresh/status + prefs pairs.

| Measurement | Before → after |
|---|---:|
| Idle slates, median, 36 responses each | 2563 → 1069 ms |
| Upstream fetches per six-request batch | 12 → 1, all six batches |
| Idle refresh/status, median, 24 each | 7.37 → 7.37 ms |
| Idle hub/prefs, median, 24 each | 35.50 → 35.25 ms |
| Native-copy stress slates, median, 36 each | 2816 → 1400 ms |
| Native-copy stress refresh/status, median, 24 each | 488 → 453 ms |
| Native-copy stress hub/prefs, median, 24 each | 1456 → 1290 ms |
| Idle event-loop lag, median/max | 5.4/439.7 → 2.7/162.8 ms |
| Native-copy stress event-loop lag, median/max | 10.1/374.8 → 9.3/231.5 ms |

The stress condition continuously invokes the real cached native reader in one
background thread (357 copies before, 316 after). This intentionally saturates
the shared interpreter. Stack samples show background deepcopy while preference
threads run SQLite connection/PRAGMA operations; the status lock fails fast
rather than waiting for refresh completion. The artificial load demonstrates
an **indirect** shared-interpreter contention mechanism, not a direct route
dependency or production attribution. It is far more frequent than the recorded
138 native hits. The current native scheduler uses a thread, while the older
jobs export describes worker processes; that deployment difference also prevents
using this test to justify a scheduler/execution-context change here.

Versioned raw cold/warm and live observations, plus the concurrency/background
summary, are in [the measurement JSON](performance/data-loading-2026-10-19.measurements.json).
The original scratch harnesses remain local under `outputs/data_loading_*.py`;
they depend on local artifacts and a captured 2.5 MB public lobby response.

## Correctness and limits

Focused regression tests cover all categories, category absence and empty
catalogs, existing default ordering/fallback, mutation isolation, next-request
provider removals/transitions, six simultaneous successful/failed readers,
failure cleanup/retry, sport separation without a global network lock, overlapping
salary metadata and discovery, provider error mapping, and the separate FanDuel
path. Identity-index tests cover unchanged content across different frames,
every relevant field revision, ignored unused fields, duplicate-name order,
row deletion, bounded eviction, simultaneous success/failure/retry and independent
revisions. Existing salary/optimizer tests check canonical IDs, captain export IDs,
eligibility and scoring behavior; existing predict tests check JSON handling
and cold inference offload. Auth dependencies and league-scoped code are unchanged.

Remaining work is to correlate production request parameters, queue/thread wait,
event-loop lag, upstream timing, artifact/roster revisions, and concurrent jobs
on the deployed revision. Native snapshot copying and its long lock scope merit
a separate measured change that preserves defensive-copy correctness. Existing
salary-cache refresh policy and cold prediction inference are outside the new
pending-lobby sharing mechanism. No seven-day frequency, production p95, model
accuracy change, or browser-visible end-to-end speedup is established by this
small local sample.

## Final comparable cold and warm results

Both changes were compared with the original implementations restored inside
the same controlled harness. Each cell below is a median of **six full ASGI
responses**. The public lobby fixture and salary frame are identical, and every
decoded response (including all player IDs, rows, values and metadata) matched
before/after. Native snapshot access and inference were forbidden throughout.
The 950 ms upstream replay delay stays identical. These are not live production
or browser-delivery measurements.

| Route | Before, cold reads | After, lookup also cold | After, lookup reused with cold weekly/overlay cache | Before warm | After warm |
|---|---:|---:|---:|---:|---:|
| slates | 1913 ms | 961 ms | 962 ms | 1913 ms | 960 ms |
| salaries/load | 3647 ms | 1627 ms | 1407 ms | 1167 ms | 1171 ms |
| predict/QB, 2026 week 6 | 921 ms | 359 ms | 108 ms | 16 ms | 13 ms |

Cold reads here mean valid artifacts on disk with weekly and identity-overlay
memory caches cleared before each request. The after lookup-cold column also
clears the new lookup cache before every request; the reused column preserves
the content-keyed lookup across invalidation/reloading of weekly predictions.
Python imports, OS file caches and underlying provider player dataframes are
warm for these repeatable median comparisons. They do **not** represent an empty
disk cache, missing model output, cold interpreter or initial provider download.
Warm requests retain all applicable memory caches. No persisted lobby cache
exists in either version, so slate discovery still pays one fresh upstream read.

The cold salary route improves by about 55%, predictions by 61%, and slates by
50%. Once weekly/overlay data is already warm, salary and prediction costs are
essentially unchanged. The separate live lobby experiment validates that the
saved upstream request exists outside the controlled replay as well.

The original local experiment used `PYTHONPATH=.` with
`outputs/data_loading_cold_warm.py` and the captured public fixture at
`outputs/dfs-lobby-probe.json`; results are saved to
`outputs/data-loading-cold-warm-final.json`. The background/concurrency replay is
`outputs/data_loading_asgi.py`, and standalone cold attribution profiles are
`outputs/data-loading-cold-{predict,pool}-profile.txt`. The older local jobs
export is not required by any harness. The Windows sandbox blocked event-loop
socket-pair initialization; ASGI benchmarks were run outside that sandbox.

## Verification and delivery

Task-owned changes are in `app/api.py`, `src/integrations/dfs_slates.py`,
`src/integrations/roster_identity.py`, `tests/test_dfs_lobby_loading.py`,
`tests/test_roster_identity_index_cache.py`, this report, and the measurement JSON.
The first two
runtime files already contained unrelated edits; those were retained.

The original-checkout affected suite passed **209 tests** (one existing Starlette deprecation
warning). It includes the new lobby/index regressions and existing roster
identity, weekly/artifact refresh, DFS salaries, lineup optimizer, prediction
serialization/offload, Sleeper identity, player identity, projection context,
movement, and draft-pool cache checks. A separately run instruction test exposes
an existing mismatch: `test_run_tests_skill_has_commands` expects the literal
`node --test frontend/src`, which the current run-tests skill does not contain
(7 passed, 1 failed). Neither that skill nor its test was changed here.

The original dirty checkout's full-suite gate is not reported as passed. The original full run was stopped
after early failures while it entered unrelated slow tests. The fail-fast rerun
finished with 60 passed and one failure:
`test_admin_auth.py::test_refresh_allowed_when_site_auth_is_off`. Its existing
`mark_refresh_started` stub returns only `started_at`, while its assertion
requires a `status` field. The unchanged refresh handler returns that stub result.
This failure is outside both modified paths; it was left for a separate fix.
The run is recorded in `outputs/data-loading-gate-tests.log`.
No frontend source changed, and no UI build or visual claim
is included. The PR ports only the task changes onto `origin/develop` at `1c913574`; unrelated
local edits and runtime caches are excluded. The measurements above remain those
from the original experimental checkout. No production deployment is included.

Publication verification on the isolated latest-develop branch passed **184 tests**
(one existing Starlette deprecation warning), covering both new regression modules
and the affected DFS, roster, prediction, artifact-revision and cache suites.
The original 209-test run also included local identity tests not present on the
clean base. Existing latest-develop behavior, including retired-roster filtering,
was preserved during the port. The full suite was not rerun on this isolated base;
the PR stays draft.
