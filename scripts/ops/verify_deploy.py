#!/usr/bin/env python3
"""Quick deploy verification for VPS/local."""
from __future__ import annotations

from app.api import app


def main() -> int:
    paths = sorted({getattr(r, "path", "") for r in app.routes})
    hub = [p for p in paths if "/hub" in p]
    print("hub_routes", len(hub))
    for p in hub[:15]:
        print(" ", p)
    checks = {
        "draft": "/api/draft/{position}",
        "ros": "/api/ros/{position}",
        "hub_workspace": "/api/hub/workspace",
        "hub_values": "/api/hub/value-sheet",
    }
    for name, path in checks.items():
        print(f"{name}:", path in paths)
    from src.draft_hub.schemas import LeagueRules
    from src.draft_hub.value_sheet import build_draft_pool_payload
    from src.projections.projection_meta import get_projection_meta
    from src.projections.ros_projections import predict_rest_of_season
    from src.draft_hub.draft_pool_cache import load_draft_pool

    m = get_projection_meta("qb")
    season, week = m["default_season"], m["default_week"]
    pool = load_draft_pool(season)
    ros = predict_rest_of_season("qb", season=season, week=week)
    payload = build_draft_pool_payload(season, LeagueRules(), [], team_count=12)
    print(f"pool={len(pool)} ros={len(ros)} values={payload.get('count', len(payload.get('rows', [])))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
