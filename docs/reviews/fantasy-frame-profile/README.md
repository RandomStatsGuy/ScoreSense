# Fantasy frame profiler verification

Scope: opt-in timing helpers, no rendered product control/style changes.
Production validation awaits the user's confirmation of deployment.

## Checks

- Targeted profiler tests: 11 passed. Covers delayed frames without reducing the
  original readiness total, cancellation, superseded visits, disabled sessions,
  visibility/focus listeners, unsupported APIs, privacy, bounded attribution and
  observer cleanup/output limits.
- Production frontend build: PASS.
- Full frontend unit gate after rebasing: 913 passed, 3 failed. All three also
  fail against unchanged `master` (`f77fa6e4`): auction contract label; accuracy
  copy; My team living-surface description. The earlier `b4a45ff3` pass had five
  baseline failures; the new master resolved the other two.
- Real-shell browser fixture: usable lineup/matchup phases, synthetic frame
  delay, and a deliberate 200 ms callback recorded. All account responses are
  isolated fixtures. No production requests or lineup writes were exercised.

## Layout

Repository `npm run audit:layout` on the built isolated fixture pages:

| Surface | 1280 | 390 |
| --- | --- | --- |
| This Week | PASS | FAIL: existing 29 px chat dismiss target |
| Free agents | PASS | PASS |
| My team | PASS | PASS |

The chat primitive was not changed. Its existing failure is also recorded in
`docs/reviews/fantasy-bootstrap/`. Free agents and My team layout audits use the
existing production-component fixtures; their full-shell loading behavior was
not profiled in this local pass. Home and other Fantasy destinations were not
checked in this pass.

**Not visually verified at 1280/390.** Browser viewport overrides did not match
requested CSS widths. `browser-proof.png` is a native browser capture confirming
the completed QA block, not a responsive screenshot pair. The frame timing
sessions report their actual CSS widths (1920 and 585). Headless layout checks
use actual 1280/390 viewports and do not simulate real phone hardware/network.

## Evidence and limits

`report.json` retains sanitized application diagnostic records and layout checks.
Frame samples were originally captured on `b4a45ff3`; the final native browser
check, unit gate, build and six layout checks were repeated on `f77fa6e4`.
The native scheduler waited 1,003 ms for a second callback; a corresponding
930 ms frame reported zero blocking time. The deliberate block reported a
200.6 ms frame, 150.4 ms blocking time and 200.1 ms attributed script.

This verifies that the profiler separates CPU work and callback waiting. It
does not establish why production pages are slow, whether Brave was uncovered,
or a production p50/p95. Data readiness is a React effect after a commit, and
two animation callbacks do not prove physical presentation. See
`docs/FANTASY_BROWSER_TIMING.md` for collecting the next deployed audit.
