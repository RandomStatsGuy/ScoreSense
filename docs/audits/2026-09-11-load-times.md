# ScoreSense load-time audit — September 11, 2026

## Findings

The largest observed problem is inconsistent time to usable data, including intermittent startup stalls before any page mounts. Best ball also has a concrete expensive request path. Two frontend improvements are implemented locally; production has not been changed.

| Priority | Finding | Evidence | Action |
| --- | --- | --- | --- |
| P1 | Global startup occasionally stalls for more than 20 seconds | Live season and Home each remained on the global `Loading…` screen through a 20-second observation budget | Parallelize config and identity requests (implemented). Instrument their response times and origin queueing before attributing the remaining stalls to a specific service. |
| P1 | Best ball does live work on every board request | Board remained on `Building board` beyond 20 seconds. `build_bestball_board` calls `predict_draft_season` for QB, RB and WR, and optionally prefetches FantasyPros ECR | Serve a materialized board or reuse the current draft pool; move external ECR refresh to a job. Preserve the combined WR/TE ranking semantics. Not implemented in this patch. |
| P1 | Fantasy entry includes unrelated page implementations | Baseline production build: `DraftHub` 528.51 KB / 144.71 KB gzip | Split ten page components into lazy imports (implemented). Entry becomes 62.36 KB / 18.69 KB gzip, with page-specific modules loaded separately. |
| P2 | Shared JS and CSS are still large | Entry JS 576.27 KB / 174.36 KB gzip; CSS 549.46 KB / 92.04 KB gzip in the baseline | Audit eager App/router imports and extract section CSS with cascade/layout checks. Not changed here. |
| P2 | Fantasy boot has additional request dependencies | `refreshAll` waits for workspace and presets before releasing the initial loading state; roster/cap/value-sheet work follows workspace | Move optional presets out of the critical path; keep league identity authoritative before issuing scoped requests. Not changed here. |
| P2 | Model accuracy waits for optional reports in sequence | `App.fetchAccuracy` awaits accuracy, then upside, then season-long before clearing loading | Load independent reports concurrently or reveal the primary report independently. Not changed here. |
| P2 | Secondary data panels can lag behind their chrome | Spend, History, Salary sheets, Members and DFS showed loading or disabled controls at first inspection | Measure each panel's endpoint and distinguish a mounted heading from usable data. |

## Method and limits

- Inspected the live site at https://app.fourthdownlabs.com with the existing signed-in commissioner session. Used navigation and reads only; no league sync, roster changes, imports, messages, draft resets or optimization jobs were submitted.
- Covered the main product destinations and management/account subpages below. This is a desktop, single-session diagnostic audit, not a representative mobile benchmark or every filter/league/permission combination.
- Timed full document navigation to a specific visible data marker using the supported browser tooling. Browser storage, service worker and HTTP caches were retained. These are **warm-browser observations**, not cold-cache results.
- Timing includes browser-tool overhead. They are approximate elapsed observations, **not LCP, INP, TTFB, or pure API latency**. Click navigation has a roughly three-second tool floor and is therefore recorded qualitatively rather than as a speed score.
- Native Performance API entries are unavailable in this browser's read-only evaluation scope. Direct HTTP probes also failed TLS negotiation from this environment; SSH stopped at host-key verification. No browser or SSH security protections were bypassed. Server timings, CDN compression, cache headers and origin CPU/queueing were not measured.
- A timeout means content was still loading when the observation budget ended. It does not mean the request permanently failed. Best ball eventually recovered with 626 players and no captured console errors.
- The root checkout is old (`93f61cf`). Code/build analysis and changes use an isolated worktree based on local `origin/develop` at `a412895`, whose navigation matches the current site. The exact deployed commit was not verified.

## Timed samples

Single samples unless multiple observations are shown. Do not average these into a p95 or claim they are production speed improvements. For timeout rows, the accompanying loading state independently confirms that data was not ready.

| Page | Observed elapsed | Completion signal / result |
| --- | ---: | --- |
| Weekly projections | 10.58 s | A projected player's detail button appeared in the data table |
| Season — preseason | 2.79 s | A projected player's detail button appeared in the data table |
| Season — live | >20 s | Still at global `Loading…` (21.38 s including tool overhead) |
| Fantasy Home | 1.54 s; later >20 s | Matchup region appeared in one sample; another stalled at global `Loading…` for 21.30 s |
| Strategy | 4.13 s | Player ranking action available |
| Draft | 2.17 s | Review teams action appeared for the completed draft |
| This Week | 2.32 s | Week board visible in DOM snapshot; coarse observation |
| Vibes | 1.69 s | Player Vibes meter appeared; coarse observation |
| Game center | 1.37 s | Matchup win-probability content appeared; coarse observation |
| My team — Room | 7.83 s | Room roster controls appeared |
| Free agents | 2.68–3.63 s | Available-player count / player detail action appeared |
| Rosters | 2.18 s | Contract values table appeared |
| Cap | 0.76 s | **Heading only**; not a completed-data measurement |
| Trades | 2.06 s | Trade-partner chooser appeared |
| DFS | 1.00 s | Build control visible; **not an enabled-control or completed-pool measurement** |
| Best ball | >20 s | Still `Building board` after 21.33 s; eventually recovered |

The range of observations and global-loading stalls justify profiling shared authentication/startup before treating each page as an independent problem. They do not establish whether the delay originated in the browser, network, Cloudflare, authentication dependencies or server contention.

## Page coverage

“Loaded” below is a functional observation, not an exact load-time measurement.

| Area | Destination | Observed result |
| --- | --- | --- |
| Projections | Weekly | Loaded 75 QB rows; timed sample above |
| Projections | Season / preseason | Loaded 87 QB rows |
| Projections | Season / live | Loaded during navigation; a subsequent reload stalled at global loading |
| Fantasy | Home | Loaded action deck, matchup and standings; intermittent startup stall |
| Fantasy | Strategy | Loaded ranking pair and controls |
| Fantasy | Draft | Loaded completed-draft summary; active-draft timing not exercised |
| Fantasy | This Week | Loaded lineup decisions and week board |
| Fantasy | Vibes | Loaded player cards and rating meters; no ratings submitted |
| Fantasy | Game center | Loaded matchup and league scores |
| Fantasy | My team / Room | Loaded room and lockers; delayed after some reloads |
| Fantasy | My team / Manage roster | Opened; briefly showed zero contracts before roster data resolved; not separately timed |
| Fantasy | Free agents | Loaded 674 available players |
| Fantasy | Rosters / Contract values | Loaded contract table |
| Fantasy | Rosters / Team rosters | Opened; league-roster loading state at first inspection; not separately timed |
| Fantasy | Cap | Loaded cap summary and calculator |
| Fantasy | Trades / Builder | Loaded trade partners; no proposal created |
| Fantasy | Trades / Inbox and Ideas | Opened both; no pending proposals / no suggested trades; not separately timed |
| League menu | Rules | Loaded league and contract-rule controls; no changes saved |
| Roster management | Contracts | Loaded league totals and team controls |
| Roster management | Salary sheets | Loading state remained at first inspection; no completed-data timing |
| Roster management | Members | Loading state remained at first inspection; no completed-data timing |
| Roster management | Access & imports | Loaded access and import controls; no mutations |
| Insights | Overview | Loaded championship history and records after initial placeholder |
| Insights | Spend | Loading placeholder and empty table at first inspection |
| Insights | Scoring | Loaded scoring race and scores |
| Insights | History | Loading player list at first inspection; explicit Sleeper history refresh not triggered |
| Tools | DFS | Eventually loaded 160-player pool and lineup controls; no lineup built |
| Tools | Mock draft | Loaded room-creation form; no room created |
| Tools | Best ball | Exceeded observation budget building board; eventually loaded |
| Account menu | Model accuracy | Loaded summary and report controls |
| Account menu | Account settings | Loaded settings form |
| Account menu | Report a bug | Loaded report form; no report sent |
| Admin | Overview / Users / Leagues | Opened all three views; leagues list loaded; no separate data-readiness timings |
| Legal | Terms / Privacy | Loaded document content |

Login/register/reset/callback flows, invite-token pages, shared-room links, mobile panels, player drawers and alternate seasons/positions need separate scenario coverage. The audit does not claim measurements for those flows.

## Implemented changes and validation

1. `authBootstrap.js` starts config and identity together and waits for both to settle before releasing the auth gate. Config still applies if identity fails. Tests cover concurrent start and both failure orderings. This removes one sequential request round trip; it does not eliminate slow individual responses.
2. `DraftHub.jsx` loads ten page implementations on demand. A page-level Suspense boundary uses the existing table placeholder and keeps league chrome/chat outside it. Existing nested Draft, Vibes, Game center and Insights fallbacks remain.

| Build item | Before | After |
| --- | ---: | ---: |
| Fantasy entry JS | 528.51 KB | 62.36 KB |
| Fantasy entry gzip | 144.71 KB | 18.69 KB |
| Main entry JS | 576.27 KB | 576.50 KB |
| Main entry gzip | 174.36 KB | 174.46 KB |
| Shared CSS | 549.46 KB | 549.46 KB |
| PWA precache total | 2518.33 KiB | 2523.15 KiB |

The 88% entry-module reduction is not an 88% reduction in all site bytes: shared dependencies and the selected page still load. Service-worker precaching still downloads the full offline asset set in the background; total precache size increased slightly with chunk overhead.

- Production frontend build: passed before and after.
- New auth tests: 3 passed.
- Frontend suite: 716 tests, 714 passed, 2 failed in unchanged files. `draftAvailabilityPresentation.test.js` has a source-string check sensitive to Windows CRLF. `accuracyPresentation.test.js` expects an empty label for null while the implementation returns a zero-point label.
- `git diff --check`: passed.
- Node 24 did not accept the repository's directory-style test command on this Windows environment; tests were rerun using the explicit `.test.js`/`.test.mjs` file list.
- Backend was not changed. No repo Python virtualenv is present; the bundled Python lacks pytest/scikit-learn, so backend inference/cache changes were not attempted without validation.
- The changed build has not been exercised against production APIs or deployed. Post-deploy performance and complete browser regression checks remain outstanding. Changes are kept local because the deployed revision is unverified and the broader test gate is not fully green.

## Next measurement pass

Capture at least five cold and warm loads per main destination, plus internal navigation, on desktop and a throttled mobile profile. Record navigation timing, LCP, long tasks, transferred bytes and time until the primary data/action is ready. Instrument config, identity, workspace and the slow page endpoints with Server-Timing; use existing HUB_TIMING phases for Fantasy requests. Do not record tokens or account payloads.

Prioritize Best ball's materialized data path and global startup stalls. Then rerun the same scenarios after the frontend changes are deployed to quantify actual user-visible improvement.
