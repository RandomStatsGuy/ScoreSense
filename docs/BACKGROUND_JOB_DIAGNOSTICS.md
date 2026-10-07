# Background job diagnostics

Read existing observations before proposing performance changes. This recorder does
not profile production, run benchmarks, change scheduling, or trigger refresh work.
There is no HTTP endpoint. It uses the standard library and a separate local SQLite
file under `data/cache`, shared by API workers and local jobs on the same host.

## Agent read commands

From the repository, with its Python environment and `PYTHONPATH=.`:

```sh
python -m src.ops.job_report --hours 24 --limit 20
python -m src.ops.job_report --hours 24 --limit 50 --json
```

For an already-running, authorized production container:

```sh
docker compose exec -T api python -m src.ops.job_report --hours 24 --json
```

These commands only read the diagnostics database. They do not need an application
secret, invoke job code, or create a missing database. Use `--path` when the writer
uses a nondefault path. A missing/unreadable store means **unknown**, not zero work.

The bounded JSON has `schema`, window/retention context, advisory thresholds, `jobs`,
`unfinished`, `recent_problems`, and retained top-level overlap counts. Each job has
run/failure/skip/same-input counts, wall and queue averages/maxima, CPU scope and
samples/total/average/maximum, sampled p95s, retained statuses/error types/reasons,
latest safe metadata and artifact age. The compact table highlights the same costs.
Use recent run/error counts to spot repeated retries; do not infer their cause from
counts alone. Job names absent from older reports can indicate newly added work,
but retention means absence does not establish when a job was introduced.

Start with queue wait versus execution time, expensive phases, repeated revisions,
failures and freshness. Compare windows under comparable traffic/game conditions.
Validate the input gate and correctness before skipping work. An unchanged input
revision can still require work because time, external inputs, or an unregistered
dependency changed. A successful check does not prove that a fresh artifact exists.

## What the measurements mean

- **Queue**: monotonic time between submission and actual worker entry. It includes
  executor dispatch/startup. Direct/CLI calls have no measured queue (`null`).
- **Wall**: elapsed execution time, including I/O, locks and small recording overhead.
- **Process CPU**: `time.process_time()` delta in the dedicated CPU worker, including
  native computation and its threads. It excludes subprocess CPU. It can exceed wall
  time when native code uses multiple cores; it is not host CPU utilization.
- **Thread CPU**: `time.thread_time()` delta for direct/thread jobs. It excludes other
  threads, native helper threads and subprocesses, so it can understate total cost.
- **Async wall-only**: CPU is `null`; other coroutines interleave on the event loop.
- **Nested phases** overlap their parent and must not be added to parent totals.
- **Freshness** is recorded only when explicitly supplied or a known result reports
  `last_success_at`. Missing age is unknown. Report age advances from the observation.
- **Unfinished** means no retained terminal observation. Worker exit, dropped writes,
  cancellation and retention can leave incomplete evidence; it does not prove overlap
  or a live hung job. Cancelling an observer does not necessarily stop its worker.

Hourly counters survive recent-run eviction, within retention limits. Their first
hour is approximate at the requested boundary. Percentiles, reasons, error types and
overlap use only retained rows, with sample counts. There are no inferred metrics.

Advisories are context for investigation, not calibrated capacity limits or resource
actions. Defaults: one execution >=60s wall, one queue wait >=5s, one observed CPU
execution >=30s, or reported artifact age >=600s. Override them for the workload:

```sh
python -m src.ops.job_report --slow-seconds 120 --queue-seconds 10 --cpu-seconds 60 --freshness-seconds 900 --json
```

## Register new work

Every `app.process_pool.submit_cpu_job(fn, ...)` automatically gets basic timings,
outcome and worker-loss observations under a static callable name. Do not create a
separate process pool. `submit_live_job` is the same, on the one-process live
worker reserved for native scoring and Fantasy context so inference never delays
them; keep it to short jobs. Use `submit_thread_job` for ticker thread work; it preserves
the default `asyncio.to_thread` executor and cancellation semantics while measuring
queue wait. Direct entry points use the decorator, with queue reported unknown:

```python
from src.ops.job_diagnostics import observe_job, annotate_job, call_phase

@observe_job("new_refresh", cadence_s=300)
def new_refresh(season, week):
    revision = existing_input_revision()  # reuse existing work; do not add expensive scans
    annotate_job(season=season, week=week, input_revision=revision)
    if existing_source_is_current():
        return {"status": "current"}
    result = call_phase("compute", existing_compute, season, week)
    annotate_job(rows=len(result))
    return {"status": "completed"}
```

The CPU wrapper and same-name decorator produce one parent observation. Different
registered jobs/phases called inside another job produce linked child observations.
Use fixed code-defined job/phase names, never a user/league/player ID in a name.

Automatic outcomes accept a fixed set of statuses/reasons and numeric count keys;
unknown status text becomes `other`. Exceptions record type only. Arbitrary result
dicts, callable arguments, error messages, URLs, environment values and nested
payloads are never copied. `annotate_job` accepts season/week, booleans (`force`,
`apply_injury`, `material_change`, `retrain`, `cache_hit`, `computation_performed`), a hashed `input_revision`, numeric
`freshness_age_s`/`cadence_s`, and allowlisted numeric work counts. Unknown fields are
discarded. Revisions must describe shared operational inputs, not personal data.
Hashing is an identifier convenience, not permission to supply sensitive data.

Prediction phases report the latest load's `cache_hit` and set
`computation_performed=true` when any inference branch in that phase is entered.
A cached load still does read/identity work; it does not mark the whole phase as
skipped. Unreported flags are unknown, and these flags are not inferred counts.

Add a regression test with `diagnostics_enabled` (temporary database) that checks
the observed outcome and the original result/exception. Add explicit counts for
jobs that catch errors or return nested results; basic timing cannot infer those.

Pytest's default hub/auth database paths and diagnostics path are disposable too.
`SCORESENSE_TEST_DATABASE_ROOT` is honored only in test mode; pytest sets it per
test so Windows-spawned workers inherit it even through imported startup aliases.
This setting is ignored in normal production execution.

## Coverage and limits

| Work | Additional context |
|---|---|
| DFS refresh | Completion cadence, season/week, injury/raw weekly and ROS phases, reused pool phase; prediction revision/force/cache hit |
| Fantasy contexts/specialists | Per-context revisions/current skips; batch prepared/current/error counts; automatic CPU startup observation |
| Fantasy valuations | Prepared/unavailable counts; startup thread queue |
| Native scoring | Scheduler candidate count; batch attempts/skips/upcoming/failures; load-stat/apply-score phases |
| Draft clock / broadcast | Changed-room count and unchanged skip; thread queue; broadcast wall-only, room-read thread and recipient count |
| Sleeper sync | Eligible league count, aggregate added/updated/waived/trades and failures; thread queue |
| Automatic repair | Requested-kind count, failure count and projection/pool phases; shared CPU queue |
| Injury polling/overlay | Forced mode, feed phase, actual adaptive cadence; overlay revision/material changes/skip reason |
| Manual notes | Context/revision, weekly and notes phases; shared CPU queue |
| Weekly pipeline | Retrain flag, context, ETL/training/weekly/ROS phases; direct CLI or shared CPU wrapper |

This does not measure normal HTTP request latency, optimizer work outside the
shared executor, host CPU/RAM/disk, all external feed revisions, or artifact
freshness that a job does not report. Framework-owned injury background callbacks
have execution timing but no submission hook, hence queue unknown. Those gaps
remain explicit; use authorized existing telemetry before estimating capacity.

## Retention, concurrency and failure behavior

Configuration lives in `src/config.py`:

| Variable | Default / bounds |
|---|---|
| `JOB_DIAGNOSTICS_ENABLED` | true; false in tests unless explicitly enabled |
| `JOB_DIAGNOSTICS_PATH` | `data/cache/job_diagnostics.sqlite3` |
| `JOB_DIAGNOSTICS_MAX_RUNS` | 2000; clamped 128–10000 |
| `JOB_DIAGNOSTICS_RETENTION_DAYS` | 7; clamped 1–30 |
| `JOB_DIAGNOSTICS_MAX_BYTES` | 32 MiB combined database/WAL guard; clamped 4–64 MiB |

Each write enforces run age/count caps, at most 4096 hourly buckets and 1024 latest
context revisions. Small fixed-schema records and bounded fields prevent raw
payload growth. SQLite reuses deleted pages; files can retain their bounded
high-water size. WAL provides transaction-safe concurrent writes. Writer lock wait
is limited to 5ms, with no retry. A combined file-size guard stops further writes
when a long-lived reader pins WAL growth (a bounded transaction can cross the
guard). The store then remains readable; operator rotation is an explicit action.
Lock contention and disk/config/clock failures drop evidence and leave the original
job result/exception intact. The fixed warning is limited
to once per minute per process and includes only process-local dropped counts.
Normal completions emit no extra console line.

Keep this local file under existing operator filesystem access. Do not publish it
or expose it through unauthenticated routes. Collection is advisory and imperfect;
no automatic restart, reschedule, cache rebuild, retraining, scaling or spending is
connected to these observations.
