---
name: refresh-draft-pool
description: Rebuild or re-fingerprint the draft-pool and weekly prediction artifacts. Use when Available players or Draft is cold, after a model or mlready change, or when hub routes start live predict_*.
---

# Refresh the draft pool

First visit to **Free agents** or **Draft** is slow when `artifacts/draft_pool/pool_{season}.parquet` is missing or the fingerprint is stale. That path falls back to live ML. Do not leave it that way after a model or mlready change.

## When

- You changed models, mlready columns, or draft-pool cache code.
- Available players / Draft / Strategy spins on first load.
- `HUB_TIMING=true` shows hub value/pool routes doing inference.

## What to run

From repo root, `PYTHONPATH=.`:

Fingerprint-only (after mlready / cache key drift, artifacts already built):

```bash
PYTHONPATH=. .venv/bin/python scripts/ops/fix_artifact_fingerprints.py
```

Full preseason rebuild (offseason or after retrain):

```bash
PYTHONPATH=. .venv/bin/python -m src.jobs.preseason_refresh --draft-season 2026
```

Windows: `.venv\Scripts\python`.

## Rules

- Hot hub reads use `build_draft_pool_payload()` then `build_value_overlay()` (`src/draft_hub/value_sheet.py`). Do not call `predict_*` from `app/hub_routes.py`.
- Weekly boards read `artifacts/weekly_predictions/`. Same fingerprint script covers weekly + ROS + pool.
- Do not commit huge new parquets unless the user asked to refresh artifacts in git.
- After refresh, hit `/hub/free-agents` or `/hub/strategy` once and confirm it is a cache read, not a multi-minute predict.
