#!/usr/bin/env python3
"""Benchmark real HTTP handlers (FastAPI TestClient) + frontend waterfalls."""

from __future__ import annotations

import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi.testclient import TestClient

from app.api import app

client = TestClient(app)


def tget(path: str) -> tuple[float, int, int]:
    t0 = time.perf_counter()
    resp = client.get(path)
    body = resp.content
    return time.perf_counter() - t0, resp.status_code, len(body)


def main() -> None:
    meta = client.get("/api/meta/projections/qb").json()
    season, week = meta["default_season"], meta["default_week"]
    draft = client.get("/api/meta/draft/qb").json()
    draft_season = draft["default_season"]
    print(f"Context: season={season} week={week} draft_season={draft_season}\n")

    endpoints = [
        ("auth config", "/api/auth/config"),
        ("auth me", "/api/auth/me"),
        ("proj meta", "/api/meta/projections/qb"),
        ("draft meta", "/api/meta/draft/qb"),
        ("predict qb", f"/api/predict/qb?season={season}&week={week}&apply_injury_adjustments=true"),
        ("sentiment qb", f"/api/sentiment/qb?season={season}&week={week}"),
        ("ros qb", f"/api/ros/qb?season={season}&week={week}&apply_injury_adjustments=true"),
        ("draft qb", f"/api/draft/qb?season={draft_season}"),
        ("injuries", "/api/injuries"),
        ("lineup pool", f"/api/lineup/pool?season={season}&week={week}&site=seasonal&apply_injury_adjustments=true"),
    ]

    print("=== Single endpoints (1st call) ===")
    for label, path in endpoints:
        sec, status, nbytes = tget(path)
        print(f"  {label:14} {sec:6.3f}s  HTTP {status}  {nbytes:>8}B")

    print("\n=== Single endpoints (warm repeat 3x avg) ===")
    for label, path in endpoints[4:8]:
        times = [tget(path)[0] for _ in range(3)]
        print(
            f"  {label:14} min={min(times):.3f}s avg={statistics.mean(times):.3f}s max={max(times):.3f}s"
        )

    print("\n=== Frontend waterfalls (sequential) ===")
    waterfalls = {
        "Auth shell": ["/api/auth/config", "/api/auth/me"],
        "Weekly (old)": [
            "/api/meta/projections/qb",
            f"/api/predict/qb?season={season}&week={week}&apply_injury_adjustments=true",
            f"/api/sentiment/qb?season={season}&week={week}",
        ],
        "Weekly (new chained meta then parallel data)": [
            "/api/meta/projections/qb",
        ],
        "Season ROS": [
            "/api/meta/projections/qb",
            f"/api/ros/qb?season={season}&week={week}&apply_injury_adjustments=true",
        ],
        "Season preseason": [
            "/api/meta/draft/qb",
            f"/api/draft/qb?season={draft_season}",
        ],
        "DFS seasonal": [
            "/api/meta/projections/qb",
            "/api/lineup/formats",
            f"/api/lineup/pool?season={season}&week={week}&site=seasonal&apply_injury_adjustments=true",
        ],
    }
    for name, paths in waterfalls.items():
        wall = 0.0
        print(f"  {name}:")
        for path in paths:
            sec, _, _ = tget(path)
            wall += sec
            print(f"    {sec:.3f}s  {path}")
        if name.startswith("Weekly (new"):
            t0 = time.perf_counter()
            with ThreadPoolExecutor(max_workers=2) as pool:
                futs = [
                    pool.submit(tget, f"/api/predict/qb?season={season}&week={week}&apply_injury_adjustments=true"),
                    pool.submit(tget, f"/api/sentiment/qb?season={season}&week={week}"),
                ]
                par = max(f.result()[0] for f in as_completed(futs))
            wall += par
            print(f"    {par:.3f}s  predict+sentiment (parallel)")
        print(f"    TOTAL {wall:.3f}s")

    print("\n=== React StrictMode dev multiplier ===")
    print("  In Vite dev, effects run twice → roughly 2× API calls on first paint.")


if __name__ == "__main__":
    main()
