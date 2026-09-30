# Fantasy bootstrap verification

The fixture renders the real Fantasy shell and This Week with synthetic account
data. It delays workspace by 1,200 ms and intercepts API calls without writing to
a league. This is an ordering regression test, not a production latency benchmark.

Build `frontend/test-fixtures/fantasy-bootstrap.html` with Vite's programmatic
`build`, `configFile: false`, `publicDir: false`, `esbuild: {jsx: 'automatic'}`,
and `base: '/__fantasy_bootstrap_qa__/'`. Put its output under
`frontend/public/__fantasy_bootstrap_qa__/` in the checkout served by the existing
Vite server. Then run `node scripts/dev/fantasy_bootstrap_browser.mjs` from the
candidate repository root. Set `FANTASY_BOOTSTRAP_QA_URL` if the fixture URL differs.
Remove that temporary output after checking. Do not start a second app server.

The browser script checks that the selected module downloads once and starts
before workspace resolves, no API mutations occur, and no page errors occur.
It saves screenshots and the full shared layout audit. The narrowly identified
existing mobile chat target failure is reported as FAIL without failing the
performance regression check; other layout failures fail the test.

| Viewport | Code ordering | Layout |
| --- | --- | --- |
| 1280 | PASS — starts 1,200 ms before workspace | PASS |
| 390 | PASS — starts 1,197 ms before workspace | FAIL — chat dismiss height 29 px < 44 px |

The chat button's CSS is unchanged. My team, Cap, Rules, and other destinations
were not visually checked in this pass. The production build preserves separate
page chunks. Full frontend unit tests: 884 passed, five failed; the same five
failures reproduce on unchanged base commit `a8bc0dc` (contract labels/salary
formatting, accuracy copy, and the roster living-surface assertion).
