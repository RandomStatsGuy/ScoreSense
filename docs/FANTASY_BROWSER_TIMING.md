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
| `ready` | Named data phase committed and two animation frames elapsed. |
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
Discard hidden-tab frames and superseded actions. A fixture's viewport width
does not simulate a real phone CPU/network. Back/forward cache restores and
programmatic transitions do not have the same start definition as link clicks.

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
