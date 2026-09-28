# DFS projection coverage and refresh

## Coverage is incomplete

QB/RB/WR model artifacts supply QB/RB/WR/TE rows (TE shares the receiver pipeline). The salary join retains unmodeled slate rows. Kickers have no built-in model; defenses currently use a labeled fixed 7/4/11 estimate. New players without a usable feature profile and unmatched identities can lack projections. Preseason depth selection can also omit newcomers. The earlier league-wide top-40 cutoff has already been removed for DFS.

`stats.projection_coverage` on salary load/import and `meta.projection_coverage` after optimizer overrides list every salary-backed player missing any finite floor/median/ceiling input. Modeled, fixed, and complete-input counts are distinct. Imported inputs do not count as modeled. The player-pool estimate count and Captain picker now require all three finite inputs; the solver also rejects infinity. A successful optimization only covers its eligible inputs, not a guarantee of optimality across every real player.

This PR does not invent kicker numbers, fit a defense model, or certify complete current live slate coverage. Those require validated input coverage and model evaluation. Existing projection CSV imports can supply missing estimates while retaining their Imported label.

## Five-minute lifecycle

The API starts a DFS refresh task 30 seconds after boot, then targets a 300-second cadence. Work runs through the existing shared CPU executor, not the event loop. It refreshes Sleeper player inputs, checks the regular-season NFL week, and forces both injury-adjusted and unadjusted QB/RB/WR weekly inference. No training or full historical ETL runs at this cadence. The same OS-owned lock as the full weekly pipeline prevents their overlap and coordinates multiple API workers. A persisted attempt timestamp rate-limits retries, including failures. A long refresh or queued full pipeline can delay the next run.

`DFS_REFRESH_ENABLED=false` disables the task; test environments disable it. Offseason checks update player input state but skip regular-season inference. This currently covers the active regular-season week, not historical/future selected weeks or postseason.

`cache/dfs_refresh.json` records attempts, partial-position results, errors and the last fully successful pass. Pool metadata exposes public refresh status and each position's artifact build time. No-success or over-ten-minute last success is marked stale. A failed feed does not advance projection success. A failed position does not prevent attempts for the others. Empty inference output preserves the previous artifact. Weekly parquet/JSON files are individually replaced atomically; the pair and all positions are not a transactional snapshot.

Salary cache hits expire at five minutes for both providers. Expired fetch failures propagate; an old salary file is not relabeled fresh. Uploaded salary catalogs stay frozen. The visible live DFS page checks its selected pool every five minutes, skips hidden tabs and in-progress builds/comparisons, serializes requests, and cancels on context changes/unmount. Successful background checks update the pool/catalog but retain lineups, saved builds, locks, settings and imported overrides. Comparisons invalidate when their inputs change. The UI distinguishes a failed pool request from overdue/failed server projection refresh. Existing builds are not automatically regenerated.

Fresh computation is not proof that upstream data is current: weekly feature ETL, nflverse roster/depth data, schedules and models keep their existing update pipelines. This cadence specifically refreshes the player feed, inference, requested salary catalog and live page. Official site scoring and exact live lock validation remain pending.

## Validation

Focused regression tests cover catalog TTL on both providers, coverage gaps, nonfinite solver inputs, success/failure/cross-worker throttling, full-pipeline lock contention and empty-inference preservation. Browser fixtures exercise five-minute callbacks, changed projections, failed checks/recovery, saved-input preservation and both viewport sizes using the real DFS components with mock API responses. This is not a production-provider or authenticated live DFS audit. Deployment is required to activate the ticker.
