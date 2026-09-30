# Fantasy performance: shared reads and independent commands

The latency problem is work placement. A lineup command used to wait for a new
weekly page build before displaying a successful move. Every weekly, Home, and
matchup read rebuilt the same projection index, and reading a saved prediction
could refresh an external roster source. The combined weekly page also remounted
its lineup editor when independently loaded matchup data arrived.

## Boundaries

1. Data refresh jobs own external roster refresh and model computation. Weekly
   artifact reads with `allow_compute=False` also prohibit identity-source refresh.
   They use the most recent saved nflverse and Sleeper snapshots. If a snapshot
   is missing, identity overlay leaves the artifact identity intact.
2. `_load_projection_index` serves a shared process read model keyed by season,
   week, injury mode, model/input fingerprint, weekly artifact revisions, roster
   identity revisions, and schedule revision. Lineup writes do not invalidate this
   global data. File replacements do. Concurrent callers share one builder, cache
   size is bounded, and each caller receives isolated scalar player cards and name
   indexes. Full-name aliases retain the existing uniqueness, team, and position
   checks; they never guess by surname.
3. API startup warms the current week and call-fact sources before accepting
   traffic. This moves cold initialization into deployment readiness. Warmup logs
   and soft-fails if data is unavailable; it does not create lineups or run models.
   Artifact replacement can still cause a fresh read-model build after startup.
4. Lineup PUT/POST validates and persists the command and returns committed rows.
   The client merges those rows into its existing projection cards and releases
   the picker immediately. Advice refresh runs separately and cannot undo a later
   command. Failed commands preserve the previous lineup; failed advice refresh
   preserves the confirmed lineup. League/week/account changes reject late results.
5. The combined week page keeps one editor in one location as matchup data loads.
   Scores and standings refresh separately after a save. A lineup change does not
   force score recalculation for the entire league.

These boundaries fit the current React, FastAPI, SQLite, and artifact architecture.
They do not require a new database or microservices. Native scoring still has a
synchronous calculation path on initial score reads and explicit score refresh;
moving score refresh to a worker-owned snapshot is a separate next step if its
measured latency continues to block matchup readiness.

## Measurement — September 30, 2026

Diagnostics ran on the production VPS in separate Python processes, with a
temporary SQLite backup and candidate modules under `/tmp`. The running app and
live lineups were not replaced. The sample was one 13-player native league team,
2026 week 4, and three builds per version with Python profiling enabled.

| Server build | Existing code | Candidate |
| --- | ---: | ---: |
| First observed build | 10,538 ms | 284 ms after startup warmup |
| Repeat builds | 603, 615 ms | 143, 143 ms |
| Repeat projection index phase | 399, 406 ms | 10, 9 ms |
| Candidate startup preparation | — | 7,041 ms |

The first row includes different initialization placement, not elimination of
all cold work. The repeat comparison is about a 76% reduction. These are server
function measurements, not HTTP latency, browser readiness, p95, or a guarantee
for every league. Shared sources may already have been warm on disk.

Browser regression tests use the real production lineup components with isolated
write responses delayed by 150 ms. A subsequent page read delayed by three seconds
or returning an error must not delay the confirmed lineup. Two consecutive swaps
must survive the first swap's late background response. Desktop and phone checks
also cover slot fills, rejected writes, game locks, linked Sleeper, read-only,
missing projections, loading, and errors.

The confirmed swap appeared in 238–241 ms in these desktop/phone fixtures, with
the 150 ms simulated save delay included. This isolates client behavior and is
not a production HTTP swap measurement. Combined-page, picker, and saved-board
layout checks passed at 1280 and 390 pixels.

## Performance budget and remaining proof

Target common lineup changes at under one second from confirmation to a useful
updated board, with visible input response much sooner. Target warm critical reads
below 250 ms server time so network and rendering have room in that budget.
Measure cold browser loads separately: workspace bootstrap, score calculation,
bundle transfer, and images can still keep complete pages above one second.

After deployment, collect consistent cold/warm browser samples across Fantasy
destinations and record API response time plus content-ready time on desktop and
a realistic phone profile. Treat the one-second goal as a measured percentile
for those profiles. Do not infer an end-to-end guarantee from this diagnostic.
