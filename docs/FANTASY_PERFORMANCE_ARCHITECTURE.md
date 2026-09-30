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
They do not require a new database or microservices. Native score refresh now
runs in the application's shared process worker, independently of page reads.
Explicit commissioner calculation remains a command that waits for publication.

## Native score snapshots

Native GETs read saved player/team totals and scoring rules. A refresh request
queues a durable `(league, season, week)` job in SQLite and returns immediately.
Duplicate reads coalesce, attempts have a 60-second minimum interval, and leases
recover work after a crashed worker. Expired workers cannot publish or finish a
new owner's job. Each bounded batch shares one statistics lookup per season/week.
The ticker queues current native leagues and unfinished scoring runs every minute;
Sleeper leagues and final results are excluded. It uses the existing shared CPU
executor and participates in API shutdown. `NATIVE_SCORING_REFRESH_ENABLED=false`
disables the ticker; explicit Calculate still works.

Automatic publication checks the lineup, scoring rules, saved scoring run, and
worker lease inside the publication transaction. Changed lineups trigger a retry.
Final results and published commissioner corrections are protected. Changed saved
scoring settings require commissioner recalculation rather than silently rewriting
an existing week's rules. Failed inputs retain previous scores and expose a
refresh failure. The page shows this state while keeping lineup editing available;
pending jobs poll snapshot status every five seconds while visible. `synced_at`
is the saved calculation time rather than the time somebody viewed it.

The existing nflverse weekly-stat feed is **not a live play-by-play feed**. This
worker polls that feed; it cannot guarantee live game coverage or specialist
inputs. Automatic worker writes stay provisional, including after the last game's
scheduled kickoff, because this feed does not confirm all games have completed.
Commissioner Calculate/Publish remains the finalization path. A confirmed game
completion provider, validated live stat feed, and complete-input gate are still
required for reliable automatic finalization. Page speed does not establish that
scoring-freshness requirement.

### Scoreboard measurements — September 30

Same VPS, deployed `d663041` versus isolated candidate modules, temporary SQLite
backups, same six-team league and 13-player viewer, week 4, warmed projection
context, no profiler. Neither sample had week statistics available.

| Scoreboard function build | Deployed | Candidate |
| --- | ---: | ---: |
| First read after projection preparation | 851 ms | 129 ms |
| Repeat refresh requests | 237, 244 ms | 82, 83 ms |

The first deployed read includes an upstream statistics request; the candidate
returns a pending refresh without waiting for it. This measures useful page data
readiness, not completed scoring or end-to-end browser readiness. The separate
profiled deployed sample was 1,148 ms / 352 ms / 350 ms. Do not compare those
profiled numbers directly to the unprofiled candidate.

Real-component browser fixtures passed pending/unavailable score states and
confirmed lineup edits in both, plus desktop/phone layout at 1280 and 390. These
fixtures isolate UI behavior and do not establish a production p95 page-load time.

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
