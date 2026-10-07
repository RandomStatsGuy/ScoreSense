# Fantasy draft clock performance — September 30, 2026

## Production diagnosis

Production revision `86a88dc` includes the valuation snapshots and shared
computation changes in PRs #597 and #598. The upgraded VPS has two logical CPUs,
3,910 MiB RAM, about 2,250 MiB available at the diagnostic sample, and no swap in
use. RAM pressure does not explain the remaining recurring stalls in this sample.

Twelve sequential loopback `/api/health` reads were mostly 4–8 ms, but two took
1,262 and 1,277 ms. These requests avoid Cloudflare and the browser. The clock
task calls synchronous `tick_expired_drafts()` on the same event loop that accepts
HTTP and WebSocket work, after each one-second sleep.

Profiling a temporary SQLite backup showed nine in-progress draft sessions. An
unchanged warm tick built 27 complete room views and entered 506 database
connection contexts. Bot/autodraft eligibility checks unnecessarily built rooms
before examining the on-clock team, and the clock returned another room view
even when nothing changed. This recurring synchronous work blocks the event loop.
It is a confirmed contributor; it does not establish the cause of every browser
readiness delay or prove a hardware ceiling.

## Command and view separation

- `advance_draft_clock()` applies due transitions with room results suppressed.
- `check_timers()` advances commands, then builds one view for the actual caller.
- Bot/autodraft checks read session/team inputs directly. Successful commands
  return an empty dictionary when presentation is suppressed; callers distinguish
  that success from `None` (no action).
- Scheduled starts and timer expiry use the same command behavior. Pause,
  offline drafts, simulation guards, full-roster completion and award settlement
  retain their existing checks.
- The application clock awaits one worker-thread tick before scheduling another.
  It shares the application's in-memory simulation guards and does not enqueue
  clock ticks behind ML jobs in the CPU process executor.
- WebSocket state reads run in worker threads. Broadcasts read committed room
  state and do not trigger a second clock advancement.

## Isolated comparison

Candidate modules ran in a separate Python process on a temporary database
backup inside the existing production container. The running API code, live
database and server configuration were not changed. The same process measured
both versions with cProfile; these are component timings, not production page
load benchmarks.

| Warm tick | Deployed code | Candidate |
| --- | ---: | ---: |
| Duration | 1,609.9 ms | 329.6 / 324.6 ms |
| Room views | 27 | 0 |
| Database connection contexts | 506 | 119 |
| Changed sessions | 0 | 0 |

Logical contents of every copied database table were unchanged after both
versions in this comparison. Profiling adds overhead and the live server still
runs the old clock during this experiment.

Regression coverage includes view-free idle ticks, scheduled starts, nomination
expiry, bot nominations, bot/human picks, expired awards, caller identity,
broadcasts without a second tick, and event-loop progress while a clock worker
is blocked. Existing draft timer, bot, pause, offline, pick and completion tests
remain the behavioral checks.

Deploy this item and repeat browser timings and loopback health probes before
moving to the next optimization. The candidate has not yet demonstrated
subsecond full-page loads in production.

## Idle practice rooms — October 7, 2026

The admin job export still showed the clock every 1.6 s at about 0.6 s of
thread CPU per tick (roughly 9 CPU-hours a day). Production had the same nine
abandoned `My Auction (test)` practice sessions, all nominating and unpaused.
Nobody had them open, so the clock auto-nominated and bots kept drafting.

- Practice (test-mode) rooms with no WebSocket viewer and no room read for
  five minutes pause with a `pause` event by `idle`. Opening the room (WebSocket
  connect or `GET /league/{id}`) resumes it and shifts deadlines by the paused
  time. Manual pauses are never auto-resumed. Real leagues never idle-pause.
- Presence is process-local in `DraftRoomManager`; production runs one API
  worker. For a full grace period after startup presence is unknown and nothing
  pauses.
- The ticker skips paused sessions and ticks every 5 s instead of every second
  when no unpaused draft is running (scheduled starts are at most 5 s late).
- `broadcast_room` builds no room state when the room has no listeners.
- Unchanged clock ticks count in hourly diagnostic buckets without a retained
  run row, so they no longer push other jobs out of the 2,000-run history.
