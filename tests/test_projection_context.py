"""Tests for projection week/season resolution."""

import pandas as pd

from src.core.projection_context import (
    build_projection_roster,
    is_nfl_offseason,
    last_full_slate_week,
    resolve_projection_context,
    upcoming_season,
)


def test_last_full_slate_week_skips_super_bowl():
    rows = []
    for i in range(32):
        rows.append({"player_id": f"p{i}", "team": f"T{i}", "week": 18, "season": 2024})
    for team in ["KC", "PHI"]:
        rows.append({"player_id": f"{team}-sb", "team": team, "week": 22, "season": 2024})
    df = pd.DataFrame(rows)
    assert last_full_slate_week(df) == 18


def test_build_projection_roster_includes_all_teams():
    rows = []
    for week in [17, 18]:
        for i in range(32):
            rows.append(
                {
                    "player_id": f"p{i}",
                    "team": f"T{i % 32}",
                    "week": week,
                    "season": 2024,
                }
            )
    rows.append({"player_id": "sb1", "team": "KC", "week": 22, "season": 2024})
    rows.append({"player_id": "sb2", "team": "PHI", "week": 22, "season": 2024})
    df = pd.DataFrame(rows)

    roster = build_projection_roster(df, season=2024, target_week=19)
    assert roster["team"].nunique() == 32
    assert len(roster) == 32


def test_resolve_projection_context_offseason():
    rows = [{"player_id": f"p{i}", "team": f"T{i}", "week": 18, "season": 2024} for i in range(32)]
    rows.append({"player_id": "sb", "team": "KC", "week": 22, "season": 2024})
    df = pd.DataFrame(rows)
    season, week = resolve_projection_context(df)
    if is_nfl_offseason():
        assert season == upcoming_season(2024)
        assert week == 1
    else:
        assert season == 2024
        assert week == 19
