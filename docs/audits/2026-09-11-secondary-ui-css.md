# Secondary UI and CSS load-time follow-up — 2026-09-11

Compared with develop at 6e7c709, including the cached Best ball / parallel startup bundle (#441) and the newly merged DFS workspace. The current DFS implementation and its dedicated stylesheet are preserved.

| Startup asset | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Entry JavaScript, minified | 576.60 KB | 454.98 KB | 21.1% |
| Entry JavaScript, gzip | 174.52 KB | 142.56 KB | 18.3% |
| Shared CSS, minified | 549.46 KB | 286.91 KB | 47.8% |
| Shared CSS, gzip | 92.04 KB | 50.08 KB | 45.6% |
| Service-worker precache | 2,530.24 KiB / 67 entries | 744.82 KiB / 10 entries | 70.6% fewer bytes |

These are local production-build asset sizes, not measured production page timings.

## Changes

Admin, Best ball, account/auth/legal/report routes, player comparison, the player inspector, and its secondary panels load on demand. Invite and claim UI waits for a matching URL token; once opened, its existing completion/dismiss state is retained. The player inspector keeps a dismissible skeleton shell while its chunk downloads.

Section CSS travels with Fantasy, shared DFS/mock tools, Best ball, Admin, player details, sign-in/account forms, Vibes, and Strategy. Shared tokens, page chrome, primitives, and rules that compete across sections stay in the startup stylesheet. The split preserves all 19,662 selector declarations and their media conditions.

The service worker precaches the initial import graph instead of all dynamic chunks. Hashed section assets are cached on first use (128 entries, 30 days). An unvisited section needs a connection for its first download; visited section code can be reused offline. API data retains its existing network behavior.

## Validation

- Production build passed.
- Frontend tests: 734/739 passed on both the current develop baseline and the combined branch. The five existing failures are the availability-effect CRLF assertion, null typical-miss formatting, and three contract-label/salary-format assertions. No new test failures.
- 44 local browser comparisons: 22 routes/states at 1280px and 390px, including the player inspector and comparison. No computed-style differences or browser exceptions. API responses are synthetic and external requests are blocked; this does not cover every populated league state or production timing.
- The layout audit reported the same findings in both fixture builds; none were introduced by this change.
- Browser smoke passed: optional chunks absent during initial load and service-worker install; section navigation; player open/Escape; comparison; visited assets cached.

Reproduce after building with `node scripts/dev/page_load_browser.mjs`. Pass a saved baseline dist directory to run the visual comparison. Requires the frontend Playwright dependency and Chromium. Reports/screenshots default to `.perf-check`; `PERF_AUDIT_OUTPUT` overrides it, and `PLAYWRIGHT_MODULE` supports an isolated Playwright install.

No deployment is included.
