#!/usr/bin/env python3
"""One-off VPS diagnostics (run inside api container)."""
from __future__ import annotations

import os
import traceback

print("=== env (non-secret flags) ===")
for k in sorted(os.environ):
    if any(x in k for x in ("KEY", "SECRET", "TOKEN", "PASSWORD", "JWT")):
        print(f"{k}=<redacted>")
    elif k.startswith(("AUTH_", "HUB_", "PATREON_", "FRONTEND_", "FANTASYPROS_", "ODDS_", "OPENAI_", "YOUTUBE_")):
        v = os.environ.get(k, "")
        print(f"{k}={v[:20] + '...' if len(v) > 20 else v}")

print("\n=== weekly cache files ===")
from pathlib import Path
from src.config import WEEKLY_PREDICTIONS_DIR, MODEL_DIR, PROCESSED_DATA_DIR

for p in sorted(WEEKLY_PREDICTIONS_DIR.glob("*.parquet")):
    print(p.name, p.stat().st_size)

print("\n=== projection meta ===")
try:
    from src.projections.projection_meta import get_projection_meta

    meta = get_projection_meta("qb")
    print("default_season", meta.get("default_season"))
    print("default_week", meta.get("default_week"))
    print("weeks_by_season keys", list((meta.get("weeks_by_season") or {}).keys())[:5])
except Exception:
    traceback.print_exc()

print("\n=== load weekly qb ===")
try:
    from src.projections.weekly_cache import load_weekly_prediction

    meta = get_projection_meta("qb")
    s, w = meta.get("default_season"), meta.get("default_week")
    df = load_weekly_prediction("qb", season=s, week=w)
    print(f"loaded season={s} week={w} rows={len(df)}")
except Exception:
    traceback.print_exc()

print("\n=== hub route check ===")
try:
    from app.api import app

    paths = [getattr(r, "path", "") for r in app.routes if "hub" in getattr(r, "path", "")]
    print("hub paths sample", paths[:5])
except Exception:
    traceback.print_exc()
