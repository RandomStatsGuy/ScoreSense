#!/usr/bin/env python3
"""Align materialized artifact fingerprints after deploy (avoid stale-cache recompute failures)."""
from __future__ import annotations

import json
from pathlib import Path

from src.config import DRAFT_POOL_DIR, ROS_PREDICTIONS_DIR, WEEKLY_PREDICTIONS_DIR
from src.draft_hub.draft_pool_cache import pool_fingerprint
from src.projections.weekly_cache import weekly_fingerprint
from src.projections.ros_cache import ros_fingerprint


def _fix_dir(meta_glob: str, fingerprint: str, label: str) -> int:
    updated = 0
    for meta_path in sorted(Path(meta_glob).parent.glob(Path(meta_glob).name)):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        old = meta.get("fingerprint")
        if old == fingerprint:
            print(f"ok  {label}/{meta_path.name}")
            continue
        meta["fingerprint"] = fingerprint
        meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        print(f"fix {label}/{meta_path.name}: {old} -> {fingerprint}")
        updated += 1
    return updated


def main() -> int:
    weekly_fp = weekly_fingerprint()
    pool_fp = pool_fingerprint()
    ros_fp = ros_fingerprint()
    n = 0
    n += _fix_dir(str(WEEKLY_PREDICTIONS_DIR / "*.meta.json"), weekly_fp, "weekly")
    n += _fix_dir(str(DRAFT_POOL_DIR / "*.meta.json"), pool_fp, "draft_pool")
    n += _fix_dir(str(ROS_PREDICTIONS_DIR / "*.meta.json"), ros_fp, "ros")
    print(f"updated {n} meta files")

    # Verify hot paths
    from src.draft_hub.draft_pool_cache import load_draft_pool
    from src.projections.projection_meta import get_projection_meta
    from src.projections.weekly_cache import load_weekly_prediction
    from src.projections.ros_cache import load_ros_prediction

    m = get_projection_meta("qb")
    wk = load_weekly_prediction("qb", season=m["default_season"], week=m["default_week"])
    pool = load_draft_pool(m["default_season"])
    ros = load_ros_prediction("qb", season=m["default_season"], week=m["default_week"])
    print(
        f"verify weekly={len(wk)} pool={len(pool)} ros={len(ros)} "
        f"season={m['default_season']} week={m['default_week']}"
    )
    return 0 if len(wk) and len(pool) and len(ros) else 1


if __name__ == "__main__":
    raise SystemExit(main())
