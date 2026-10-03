# DFS refresh reuse

Automatic DFS refresh previously forced six weekly inference passes on every
five-minute check, even when their inputs had not changed. DFS now reuses saved
injury/raw QB, RB and WR/TE forecasts, plus its ROS warmup, only when a successful
prior DFS pass proves both the inputs and saved files are unchanged. Other forecast
readers, manual full refresh and repair entry points keep their existing behavior.

## What triggers forecast work

- No successful receipt, an unknown receipt version, or an interrupted/failed pass.
- A different season/week, active model bundle, processed parquet or CSV source,
  Sleeper player/injury/depth data, current-season NFL roster, schedule/market
  snapshot, rookie override, or sentiment feature snapshot used by rookie roles.
- Changed exact-week FantasyPros projection or `ecr_ALL` data, or the existing
  consensus revision marker. Inference remains cache-only for consensus.
- Changed prior raw weekly artifacts used by ROS's rolling window.
- Changed source code, numerical dependency requirements, Python version or
  installed numerical library versions across deployment.
- A missing, changed or corrupt weekly/ROS artifact or metadata sidecar.
- Fifteen minutes since the previous forecast computation **began**. Successful
  reuse checks preserve this original age; they never extend it.
- An explicit `run_dfs_refresh(force=True)` call, which bypasses cadence/reuse
  gates while still obeying the shared refresh lock.

Content digests use the existing stat-keyed revision mechanism with a bounded
digest cache. Same-content player-feed rewrites alone do not force inference.
The registry is conservative: updates can rebuild all variants together even
when only one position would have changed. No `.env` or secret value enters it.

## Work and freshness which continue

Every due pass still polls players/NFL state, resolves schedule/roster inputs under
their existing feed-cache contracts, refreshes specialist history, forecasts K/DST,
assembles both DFS pools, and validates required outputs. Kicker/defense bundle and
feed changes reach the pool even when skill forecasts are reused. Specialist feed
failure or missing current history still prevents fresh success. Unavailable-player
rows and raw/injury output semantics are preserved.

Reuse eligibility is capped at 900 seconds by `DFS_FORECAST_MAX_AGE_SECONDS`.
It is not a 15-minute end-to-end freshness guarantee: checks retain the existing
five-minute completion gap; shared-worker queueing, computation and source outages
can delay publication. Feed-specific TTLs are unchanged. Source changes trigger
work at the next due check after they are locally observed.

`last_success_at` means the last successful source check and DFS assembly. On reuse,
skill forecast `built_at` values remain their actual prior computation timestamps;
`forecasts_reused` reports the reuse decision. Status also reports the reuse age
limit. Old inference timestamps are never rewritten to look newly computed.

## Failure and concurrency

The existing OS-owned refresh lock coalesces workers and coordinates with manual
pipelines. Strict cache reads do not silently infer or substitute stale forecasts
on a reuse pass. Inputs are checked after weekly assembly, before either DFS
variant is published, and before storing a new receipt. Reuse also checks for
saved-artifact replacement during the pass. A race detected before pool publication
preserves the previous DFS pool; a later change prevents a new reuse receipt.
Updates after validation are picked up on a subsequent check. Independent feed
writers are not a transactional snapshot of every source.

A running status intentionally contains no receipt. A crash, error, corrupt proof,
invalid/future age or artifact loss fails closed. Receipts store only digests and a
computation epoch. Previous success is retained on failure rather than advanced.

## Verification and rollout observation

Tests exercise real saved-reader reuse with zero mocked model-head calls, both
variants, live specialist updates, each source class, addition/removal, context
boundaries, expiry, explicit force, artifact damage, races and lock ownership.
These checks do not imply a production benchmark or a measured speedup.

After an authorized deployment, compare ordinary-traffic windows using:

```sh
docker compose -f deploy/docker-compose.prod.yml exec -T api python -m src.ops.job_report --hours 24 --limit 30 --json
```

Look for weekly phases changing from computation to cache hits, reduced DFS
wall/CPU and scoring/Fantasy queue tails, while checking freshness and failures.
Parent spans include nested phases; do not add their CPU again.
