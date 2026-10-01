# Fantasy browser diagnostics

After deploying this change, open `/hub/week?fantasyPerf=1` in a signed-in browser.
Diagnostics stay enabled in that tab's session across Fantasy navigation. Open
`?fantasyPerf=0` and reload to disable them. Other visitors have no observer,
readiness-frame callbacks, or diagnostic output. No measurements are uploaded.

Read console entries beginning `[FantasyPerf]`. They use `performance.now()`
inside the browser, avoiding browser-control RPC overhead. Records contain a
build UUID, viewport width, navigation type, route visit number, known destination
and request categories, timings, and status. They exclude raw URLs, queries,
account/league/team/player IDs, payloads and authorization headers. Unknown hub
requests use `other`. Resource status is null when the browser does not expose it.

| Event | Meaning |
| --- | --- |
| `route-start` | Initial load starts at navigation time zero. Link navigation starts in click capture; programmatic navigation starts at the router layout effect. |
| `data-ready` | The named phase's React effect ran with usable data after a commit. This is not an exact commit or paint timestamp. |
| `frame-wait` | Time from that effect to the first animation callback, then from the first callback to the second. Includes visibility and document focus. |
| `ready` | Original named readiness mark after two animation callbacks. Also contains `dataReadyMs` and total `frameWaitMs`; its total duration is unchanged. |
| `page-state` | Initial visibility/focus and subsequent visibility, focus or blur changes, with a browser timestamp. |
| `profile-support` | Whether this browser supports long animation frames and long tasks. |
| `long-frame` | A browser-reported long animation frame: start, duration, blocking time, render/style start through frame end, and up to five longest attributed scripts. |
| `long-task` | A browser-reported main-thread task's start and duration. Raw task attribution is excluded. |
| `profile-limit` / `profile-unavailable` | Main-thread profiling stopped at 200 combined task/frame records, or an observer could not start. Other diagnostics continue. |
| `api-headers` | `apiFetch` started through response headers; includes HTTP outcome and server duration when present. |
| `resource` | Browser resource completion, duration, response transfer time, bytes and status when exposed, for same-origin API or JS/CSS assets. |
| `action` | Confirmed lineup swap/fill through two frames after committed state is applied, or a rejected/superseded result. Background advice does not delay this mark. |
| `asset-error` | Vite dependency preloading failed; inspect nearby browser network errors for the specific asset. |

Readiness phases are deliberately separate: Home `home-data` and `matchup`,
This Week `lineup` and `matchup`, My team `roster-data` and `team-room`, and
Free agents `player-board`. A cached lineup can be useful before matchup data
arrives. Do not describe the lineup mark alone as complete-page readiness.
These do not wait for images, chat history, all secondary requests, or fresh game
statistics. Errors with no usable data do not emit successful readiness marks.
In-page filters and league switches do not start new route visits.

Handled hub HTTP responses include `Server-Timing: hub;dur=...` regardless of `HUB_TIMING`.
This is coarse request-to-response-headers time, including application scheduling,
handler work and serialization before those headers. It excludes response-body
transfer and network travel. Existing server metrics/headers are preserved.
Browser resource completion includes body transfer; `api-headers` does not.
Do not sum overlapping requests or subtract coarse timings to claim exact network
or render time. Readiness minus the critical resource completion is an estimate.

For a production audit, record build, viewport/device, cache condition and network
profile; take repeated initial/reload and warm navigation samples separately.
Use the relevant combined phases and confirmed save marks to calculate p50/p95.
Discard hidden-tab frames and superseded actions. Document focus/visibility do
not establish that the window was uncovered or physically presenting frames.
A fixture's viewport width
does not simulate a real phone CPU/network. Back/forward cache restores and
programmatic transitions do not have the same start definition as link clicks.

## Separating data readiness from frame scheduling

Keep `ready.durationMs` as the original two-frame mark. Compare its
`dataReadyMs` and `frameWaitMs` before treating a post-response gap as expensive
React work. A delayed animation callback is not a measurement of CPU utilization
or a guarantee that the user saw a frame. The same limitation applies to the
existing two-frame confirmed lineup `action` mark.

Use overlapping `long-frame` and `long-task` records to investigate busy periods.
The [Chrome long animation frame documentation](https://developer.chrome.com/docs/web-platform/long-animation-frames)
describes the browser's blocking-time and script-attribution fields. Render/style
values here run from their respective start timestamps through frame end; they
overlap and do not isolate exclusive layout or paint cost. Tasks and frames also
overlap: do not sum them. Missing script attribution does not prove no script ran,
and short tasks are not represented by these long-entry APIs.

Script records retain only a same-origin `/assets/*.js` basename, a numeric
source character position, a known invoker type, duration and forced style/layout
time. Other sources become `app`, `external`, `inline` or `unknown`. Full URLs,
function names, DOM invokers, task attribution and raw performance entries are
excluded. Main-thread output is capped at 200 records per enabled session and
at five script records per frame. All observers/listeners disconnect on cleanup;
the default disabled session installs none of them.

### Local verification for the frame profiler

The isolated `test-fixtures/fantasy-frame-profile.html` uses the real Fantasy
shell with synthetic account data and a 1,200 ms workspace response. Add
`?slowFrames=1` to delay each requested animation callback by 1,000 ms; its QA
button deliberately blocks one callback for 200 ms. These cases validate the
measurements and are excluded from the production entry.

In the actual Brave session, the unmodified frame scheduler still produced a
1,003 ms second-frame wait. The corresponding 930 ms long frame had zero
blocking time. With the synthetic delay enabled, data readiness was 1,371 ms
and the two-frame wait was 3,115 ms; native scheduling added to the synthetic
delay. A deliberate 200 ms callback produced a 200.6 ms long frame, 150.4 ms
blocking time and a 200.1 ms attributed script. These are local diagnostic
validation samples, not production speed measurements or proof of window
occlusion. Report: `docs/reviews/fantasy-frame-profile/report.json`.

The 11 targeted profiler tests pass and the production build passes. The full
frontend suite on the rebased PR passes 913 of 916 tests; the same three unrelated
assertions fail on unchanged `master` (`f77fa6e4`). The original frame samples above
were captured on `b4a45ff3`. Layout results and capture limitations
are recorded with the report. Production confirmation remains pending deployment
and the user's confirmation of which release is live.

## September 30 verification

The real-shell fixture delays workspace by 1,200 ms. At 1280 and 390 it checks
one selected module request overlapping workspace, readiness for both lineup
and matchup, JS resource records, API timing, synthetic server timing, and no
mutations/page errors. Full report and screenshots:
`docs/reviews/fantasy-bootstrap/`. Desktop layout passes; phone reports the
unchanged 29 px chat dismiss target below the 44 px requirement. Other destinations
were not visually checked in this pass. This is not a production p95 measurement.

Recovery tests cover the immediate asset-error signal, one same-build recovery,
open dialogs, pending writes, protected routes, offline checks and cleanup. The
exact asset archive remains the primary release continuity mechanism. Recovery
cannot restore an already absent historical asset or diagnose the root cause of
the previously observed transient Home CSS fetch failure by itself.
