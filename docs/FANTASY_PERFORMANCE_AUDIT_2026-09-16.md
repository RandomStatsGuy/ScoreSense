# Fantasy performance audit — September 16, 2026

Production target: https://app.fourthdownlabs.com/hub/

## Measurements

Signed-in desktop browser, existing league, no CPU/network throttling. Assets had already been visited/cached. Times are wall-clock navigation/reload to a visible content marker, including browser automation and locator polling overhead. These are small-sample diagnostics, not LCP, TTFB, cold-load benchmarks, or population percentiles. Different markers represent different amounts of page content.

| Page | Recorded times | Readiness marker |
| --- | --- | --- |
| Home | 2.294, 1.832, 2.154 s | Data-driven lineup-changes heading |
| This Week | 1.623, 1.502 s | Data-driven lineup-changes heading |
| Game center | 0.975, 0.968 s | Selected player's heading |
| My team | 3.371, 3.345 s | Player name in loaded room |
| Rosters | 2.293 s | Contract values table |
| Cap | 5.985, 1.434 s | Preview a roster move heading |
| Trades | 7.486, 11.621 s | Pick a trade partner heading |

Strategy, Draft, Vibes, and Free agents were visited through the navigation, but no defensible data-ready timing was captured for those pages. Free agents initially showed 0 available; this observation does not establish whether the final dataset was empty. Rules, Insights, and staff Roster management were not benchmarked.

Initial navigation failed with `Failed to fetch dynamically imported module: /assets/DraftHub-IxaIR_lY.js`. Reload recovered. A stale deployment asset is a plausible cause, but HTTP status/network evidence was unavailable, so transient network failure is also possible.

Measurement limitations: browser resource/navigation performance entries were unavailable through the read-only evaluation API. Direct HTTP probes failed at TLS negotiation from this environment, including an outside-sandbox probe. No production request waterfall or server timings were captured. Initial click-to-snapshot checks included about 3 seconds of fixed click overhead and were discarded. One batch exceeded the automation time limit; its unpublished samples were discarded and selected pages were remeasured independently. My team required repeated locator waits because the tool's individual selector deadline expired before the player appeared.

## Recommended work, in order

### 1. Remove secondary data from Trades' critical path

`frontend/src/DraftHub/LeagueTrades.jsx:413` starts boot by awaiting league rosters, then awaits proposals, insights, and weekly preview together. The builder is gated by `!loading` at line 1190. Consequently inbox/ideas/weekly data delays the partner picker, even after rosters arrive.

Render the builder after its required rosters and trade seed are ready. Fetch inbox and ideas on demand, or independently with their own loading/error state. Defer weekly preview until it is needed. Preserve seeded trades, account/league switching guards, and validation before proposal submission. This is a confirmed dependency issue; the portion of the measured 7.5–11.6 seconds attributable to each request remains unmeasured.

### 2. Stop loading unused shared payloads on Rosters and Trades

`frontend/src/DraftHub/DraftHub.jsx:62` includes both destinations in `TABS_NEED_VALUE_SHEET`. Neither `LeagueRostersBrowser` nor `LeagueTrades` receives that value sheet (lines 915–948); each fetches league rosters itself. They also appear in the shared roster-needing set without receiving that roster prop.

Remove unnecessary destination dependencies after confirming indirect consumers. Keep value-sheet loading for pages that actually render it. Audit the unconditional league-mode cap-sheet request at lines 420–428 separately: the shared banner may still require some of that data, so replace it with a lightweight summary only after checking consumers. This reduces duplicate server work and contention; no time saving has yet been measured.

### 3. Batch My team's database work and make optional metadata nonblocking

`src/draft_hub/team_room.py:151` loops over starters and bench players, calling `projection_snapshot` for each. That helper (line 26) opens a connection, ensures a table, optionally writes, and reads one player's baseline. `storage.get_conn()` initializes the DB and commits each connection. Batch the baseline reads/writes into one connection/transaction per room build. Preserve the prohibition against creating a missing pregame baseline after kickoff.

`sleeper_nicknames` (line 79) also makes a synchronous external request on a five-minute cache miss. The underlying `_fetch_json` defaults to a 25-second timeout. Its exception fallback does not prevent the room from waiting first. Refresh nicknames during sync or serve cached metadata while refreshing separately.

`frontend/src/DraftHub/TeamRoom.jsx:440` clears data and refetches on entry. A bounded cache scoped to account/league/team/week could improve revisits, with explicit invalidation for edits, authorization changes, and logout. Server batching is the more direct first change for full reloads.

### 4. Reuse roster and weekly data across destinations

`LeagueRostersBrowser.jsx:102` and `LeagueTrades.jsx:370` independently fetch the same league-rosters endpoint. The repository already has roster cache helpers in `hubDataCache.js`, but these two loaders do not use them. Add one shared, in-flight-deduplicated cache with appropriate account/league/version keys and invalidation after contract, trade, or sync changes.

Home requests `include_week=true` (`LeagueHome.jsx:150`); the server builds the full weekly command center before returning a small summary (`league_home.py:515`). Consider a cached lightweight weekly summary or sharing the weekly payload with This Week. Home already displays cached data on revisits, so preserve that behavior.

### 5. Harden deployment asset continuity

Investigate the observed lazy-module failure against deployment and CDN logs. The frontend build clears its output (`frontend/vite.config.js`), and the Docker build copies the new bundle. The existing old-asset recovery in `app/api.py:2274` covers Fantasy CSS only, not missing JavaScript chunks.

Retain prior hashed asset generations for a bounded period and publish HTML/assets atomically, so open clients can still load their referenced chunks. Do not substitute new JavaScript under old content hashes. Consider a single guarded chunk-error reload as a secondary recovery mechanism, avoiding reload loops and preserving unsaved work.

## Follow-up validation

Use authenticated browser network traces and server timings to attribute the measured delays before claiming savings. Compare at least five first-navigation and revisit runs per destination, then test cold assets and mobile throttling separately. For changes above, verify cross-league isolation, cache invalidation after mutations/logout, seeded trades, and pregame snapshot correctness. Repeat deployment with an already-open client to validate old lazy chunks.

This audit changed no application code or production configuration.


## Implementation � September 16, 2026

Implemented locally, not deployed:

- Trades releases the builder after roster/seed loading. Inbox and insights run separately from builder readiness; their failures are shown on the affected section. Weekly preview waits until the builder needs it or Inbox opens. Aborted boot requests cannot consume the next league's trade seed.
- Removed unused shared value-sheet requests on Rosters and Trades, and unused shared roster requests on Home, Rosters, and Trades. The cap-sheet request remains because the shared league strip consumes it.
- Added a 30-second in-memory roster request cache scoped by account and league, with shared in-flight requests, explicit refresh, expiry, and invalidation on successful hub/auth writes and existing sync/revision invalidation paths. Late invalidated responses cannot repopulate it. It is not persisted to browser storage.
- My team reads/writes projection baselines in one transaction per room. Kickoff guards still preserve frozen baselines and never backfill a missing historical projection. Optional nicknames serve cached metadata immediately, with at most two background network refreshes and failure backoff.
- The supported deployment runner archives the running container's exact frontend assets before replacing it. The API can serve these retired chunks for seven days after retirement (pruning occurs on deployment). Existing shell/SW revalidation remains. Deployment archive files are excluded from laptop packaging and Docker build context.

The optional new Home weekly-summary cache and client-side Team room cache were not added. Home's existing cache remains; this implementation prioritizes eliminating unused reads, the Trades dependency chain, and room database/network work. No production improvement percentage is claimed without a post-deploy measurement.

### Validation

- Production frontend build: PASS, including service-worker generation.
- Targeted Python tests: 39 passed across team room, static assets, deployment packaging, and league home. Final rerun of the 26 directly affected backend tests passed.
- New/shared frontend cache and trade boot tests: 8 passed. Includes account/league isolation, in-flight coalescing, stale-response rejection, expiry, mutation/logout invalidation, optional-request failure, and leaving a league before its seed is applied.
- Deployment shell syntax: PASS. Exact retired JS/CSS serving, missing-chunk 404 behavior, path traversal rejection, retention, and immutable collision rejection exercised in Python tests. No live VPS deployment or Docker container swap was performed.
- Full frontend suite at final check: 760 passed, 6 failed. Five failures were independently reproduced from HEAD in an isolated baseline: draft availability, auction contract labels, two roster-format labels, and accuracy copy. A sixth failure (My team stadium count/layout) appeared alongside concurrent edits to My team/shared UI outside this performance patch. Those edits were preserved.
- Browser: clicked Builder, Inbox, and Ideas locally; inspected Trades and Rosters at desktop and phone sizes. Local My Auction has no other managers/contracts, so this covers empty states, not a populated production trade or mutation flow. Screenshots were shown in the task. No trades or league syncs were submitted.

| Layout audit snapshot | 1280 | 390 |
| --- | --- | --- |
| Trades | FAIL: Sign in and Invite managers both primary | FAIL: trade steps 33px; chat dismiss 29px |
| Rosters | PASS | FAIL: chat dismiss 29px |

These layout findings concern existing visual controls; no layout primitive or style was edited for this performance work. Populated league flows, native/linked scoring interaction in a real room, other Fantasy destinations, and cold/mobile production load times still need post-deploy validation. The development API and Vite were left running on localhost ports 8000 and 5173; a temporary process-only JWT secret was used without changing saved configuration.


### Isolated PR branch validation

The performance-only patch was reapplied to develop at `61682db`, preserving newer non-salary Trades behavior. The shared checkout's concurrent UI/scoring edits, local databases, and generated artifacts are excluded.

- Production build passes on this branch.
- Targeted frontend tests: 10 passed (includes the base branch's additional cache capability checks).
- Full frontend suite: 799 passed, 6 failed. Five match the earlier baseline failures; the additional failure is DFS Edit Entries export behavior, outside the changed files. The earlier shared-checkout My team failure is absent.
- The rebased branch is not visually verified. Earlier layout findings remain documented above; no new production timing claim is made.
