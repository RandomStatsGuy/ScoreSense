# Prepared Fantasy weekly player context

Fantasy HTTP reads consume a durable weekly player snapshot. They no longer
rebuild the QB/RB/WR player lookup or aggregate prior PPG, defense matchup facts,
and schedule lines when an API process is cold or sources change.

## Boundary

`src/draft_hub/prepared_week_context.py` owns the prepared public player data.
Rosters, saved lineups, ownership, league rules and score snapshots remain in
SQLite and are read for the current request. Saving a lineup does not invalidate
the shared player snapshot. It never contains league, account or team data.

Snapshots live under `artifacts/fantasy_week_context/`, configured by
`FANTASY_WEEK_CONTEXT_DIR` in `src/config.py`. The existing production artifacts
volume persists them across container restarts. Generated files are ignored by
Git. Each season/week/injury variant has its own JSON envelope with a schema,
source revision and preparation timestamp. Compact player references preserve
ID aliases and ambiguous-name candidates. API callers receive isolated copies.

Revisions track weekly artifacts and their metadata, the weekly model/data
fingerprint, nflverse/Sleeper identity snapshots, and the schedule snapshot.
The previous in-process weekly context cache has been replaced by this boundary.
Request readers only deserialize/cache the published file and check source
stamps; they do not call the source builders or live inference.

## Preparation and publication

- API startup attempts to prepare the default week and each league season's
  resolved current week, in both injury variants, using the shared CPU worker.
  This completes before traffic is accepted. Missing upstream projections or a
  failed preparation remain explicitly unavailable rather than fabricated.
- Weekly/preseason refresh jobs publish both variants after their upstream
  artifacts are ready. The explicit weekly projection rebuild also publishes its
  requested variants before reporting success.
- The API's `fantasy_context_ticker` checks current, requested, published, and
  existing historical artifact contexts every 30 seconds. It prepares at most
  two changed contexts per pass so the shared worker can serve native scoring
  and other jobs. Unchanged contexts do not consume the preparation budget.
- A process-owned file lock coalesces preparation across API/cron workers. The
  lock is released on process exit. Publication uses a temporary file and atomic
  replacement. It keeps the previous complete file on source changes during a
  build, lost positional artifacts, builder errors, or publication errors.

A changed source serves the last complete snapshot for that same context and
coalesces a durable `.request` hint. A missing/corrupt snapshot returns unavailable
projections and queues preparation; it never computes them inside the request or
uses another week's/variant's data. Current contexts are prepared at startup;
previously unprepared historical contexts may be unavailable until their worker
pass. Existing roster and lineup data remain usable. Failures are logged and
retried by later passes. No UI timing guarantee is inferred from an unavailable
projection response.

Week response metadata adds `context_status` (`ready`, `refreshing`, `warming`)
and `context_built_at`. The existing `projections_built_at` continues to describe
the projection source. A stale snapshot retains its original timestamps.

For an explicit migration/preparation pass without retraining or inference:

```powershell
$env:PYTHONPATH="."
.venv\Scripts\python -m src.jobs.prewarm_fantasy_week_context
# Or prepare only one existing season/week, both injury variants:
.venv\Scripts\python -m src.jobs.prewarm_fantasy_week_context --season 2026 --week 4
```

## Verification

Tests exercise concurrent readers, isolated caller copies and alias identity,
missing/corrupt snapshots, coalesced hints, nonblocking stale reads during a
worker build, process lock coalescing, atomic publication failures, source
revision changes mid-build, positional regressions, week/variant isolation,
bounded worker batches, explicit projection rebuild sequencing, and ticker
cancellation. Existing weekly payload, scoring and refresh regressions are also
covered.

The final targeted suite passed 188 tests. A broad run passed 1,462 and skipped
two before stopping at ten failures: nine Windows shell-runner failures that
also reproduce on unchanged master, and a Home timing-budget failure that passed
both an isolated rerun and the final targeted suite. The remaining modules passed
420 tests. These runs overlap and are not a claim of a completely green full
suite. Details: `reviews/fantasy-week-context/verification.json`.

The September 30 comparison ran deployed code and candidate modules in a
separate process on the production machine, with a disposable database copy,
temporary snapshot directory, and external HTTP disabled. Source builders were
forbidden during candidate reads, and their source caches were cleared after
preparation. Report: `reviews/fantasy-week-context/comparison.json`.

| Backend read | Deployed | Prepared candidate |
| --- | ---: | ---: |
| First read | 5,996 ms | 129 ms |
| Warm reads | 152–211 ms | 114–117 ms |
| Source changed, last complete snapshot | — | 114 ms |

The compared roster, lineup, projections, recommendations and summary matched;
the candidate did not change the copied database. Preparation itself was 2,227
ms with source caches already warmed by the baseline, so it is not a cold
preparation benchmark. CPU load and samples varied. These timings exclude HTTP,
browser bootstrap and rendering, and are not production page-load p95. Deploy
and repeat the foreground browser audit before claiming subsecond page loads.
