#!/usr/bin/env python3
"""Benchmark hot-path data load times (warm vs cold parquet)."""

from __future__ import annotations

import time

from src.draft_hub.draft_pool_cache import invalidate_pool_cache, load_draft_pool
from src.products.lineup_optimizer import build_lineup_pool
from src.projections.draft_meta import get_draft_meta
from src.projections.projection_meta import get_projection_meta
from src.projections.ros_cache import invalidate_ros_cache, load_ros_prediction
from src.projections.weekly_cache import invalidate_weekly_cache, load_weekly_prediction
from src.sentiment.readout import build_sentiment_response


def bench(label: str, fn, repeats: int = 3) -> None:
    times: list[float] = []
    result = None
    for _ in range(repeats):
        t0 = time.perf_counter()
        result = fn()
        times.append(time.perf_counter() - t0)
    n = len(result) if hasattr(result, "__len__") else "?"
    print(
        f"{label:30}  min={min(times):.3f}s  avg={sum(times) / len(times):.3f}s  "
        f"max={max(times):.3f}s  rows={n}"
    )


def main() -> None:
    m = get_projection_meta("qb")
    season, week = int(m["default_season"]), int(m["default_week"])
    draft_season = int(get_draft_meta("qb")["default_season"])
    print(f"Context: season={season} week={week} draft_season={draft_season}\n")

    print("=== WARM (in-process cache hit) ===")
    bench("weekly QB", lambda: load_weekly_prediction("qb", season=season, week=week))
    bench("weekly RB", lambda: load_weekly_prediction("rb", season=season, week=week))
    bench("weekly WR", lambda: load_weekly_prediction("wr", season=season, week=week))
    bench("ROS QB", lambda: load_ros_prediction("qb", season=season, week=week))
    bench("ROS RB", lambda: load_ros_prediction("rb", season=season, week=week))
    bench("ROS WR", lambda: load_ros_prediction("wr", season=season, week=week))
    bench("draft pool", lambda: load_draft_pool(draft_season))
    bench("DFS lineup pool", lambda: build_lineup_pool(season=season, week=week)[0])
    resp = build_sentiment_response("qb", season, week)
    print(f"{'sentiment QB':30}  rows={resp['count']} (see cold timing below)")

    print("\n=== COLD (clear in-process cache; parquet artifacts on disk) ===")
    invalidate_weekly_cache()
    invalidate_ros_cache()
    invalidate_pool_cache()
    bench("weekly QB (parquet)", lambda: load_weekly_prediction("qb", season=season, week=week))
    bench("ROS QB (parquet)", lambda: load_ros_prediction("qb", season=season, week=week))
    bench("draft pool (parquet)", lambda: load_draft_pool(draft_season))
    bench("DFS lineup pool (parquet)", lambda: build_lineup_pool(season=season, week=week)[0])
    bench("sentiment QB", lambda: build_sentiment_response("qb", season, week)["players"])

    print("\n=== TRUE COLD (no artifact — allow_compute=False) ===")
    invalidate_weekly_cache()
    missing = load_weekly_prediction("qb", season=9999, week=1, allow_compute=False)
    print(f"{'weekly (no artifact)':30}  rows={len(missing)} (instant empty)")


if __name__ == "__main__":
    main()
