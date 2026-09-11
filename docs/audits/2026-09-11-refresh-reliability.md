# Refresh reliability audit

## Findings and changes

- Weekly notes refresh enabled live prediction on a cache miss. It now reads artifacts only, returns a useful 503 when they are missing, and the browser bounds its request to 30 seconds.
- Season refresh performed six weekly inference runs twice and three season inference runs twice. Reuse the weekly artifacts already written and use the single season-pool build's counts.
- Input enrichment happened after weekly/ROS artifacts were fingerprinted. Move FantasyPros and full-refresh sentiment enrichment before artifact builds. Manual refresh skips target-quality reporting, model training, ETL, and transcript backfill; scheduled/full refresh retains them.
- Best ball's season pool only rebuilt during the offseason. Refresh it in-season too.
- The API's in-memory weekly, ROS, and draft-pool caches only checked model/feature fingerprints. Include artifact mtimes and sizes so another process's rebuild becomes visible without restarting the API.
- Refresh work now runs through the existing shared process executor. An OS-owned lock prevents overlapping workers and releases on process exit. Status writes are atomic, include the current stage and optional-step warnings, retain the last successful completion, and report abandoned jobs (queued jobs have a two-minute startup grace).
- Browser status checks continue independently of the initiating request: every three seconds while running, every minute otherwise, and on focus/visibility/connection recovery. Each status request has a ten-second timeout. This also detects jobs started by another user or server scheduler.
- New successful revisions reload active projection boards and Best ball, and invalidate Fantasy data without remounting the workspace. DFS exposes an explicit update action to preserve user control over builds and imports. Failed attempts never advertise a new data timestamp.

## Scheduling boundary

`.github/workflows/weekly-refresh.yml` runs Tuesday at 10:00 UTC on a GitHub runner. It uploads an Actions artifact containing CSVs/models/status; it does not deliver live weekly/ROS/draft-pool artifacts to the VPS. The checked-in workflow therefore does not establish an automatic production refresh schedule. Existing VPS cron/timers have not been inspected in this change.

Production scheduling should run the job on the VPS against its local runtime data and server environment (rather than copy runner artifacts over active data). The full command is `PYTHONPATH=. .venv/bin/python -m src.jobs.weekly_refresh`; `--no-retrain` is the lighter projection rebuild. Confirm the deployed checkout, environment, cadence, and existing timers before installing one. No VPS timer or deployment is included here.

## Validation

Isolated Python tests cover lock contention, abandoned workers, queue deduplication, submission failure, optional-step warnings, input/cache ordering, notes cache-only behavior, and cross-process artifact visibility. No production data, model inference, or external APIs are used in these checks.

Build: `npm run build --prefix frontend`.
Browser regression: `node scripts/dev/page_load_browser.mjs --refresh` (synthetic localhost APIs, external requests blocked). Checks progress, reload recovery, completion started elsewhere, Best ball refetch, and failure display; saves a phone screenshot. Existing page-load smoke remains available without arguments.

The frontend suite retains five baseline failures (availability source assertion, three contract formatting assertions, and null accuracy-miss copy).

## Limits

Individual model/network steps still take their actual compute time; progress is a stage label, not a fabricated percentage or ETA. Artifacts are written by their existing per-product writers rather than published as one atomic suite snapshot, so pages may observe different generations during a running rebuild. Successful completion is the browser's update signal. A separate preprocessing/preseason job that bypasses `weekly_refresh` does not publish that signal; use the weekly job entry point for coordinated refreshes.
