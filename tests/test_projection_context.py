"""Tests for projection week/season resolution."""

from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pandas as pd

from src.core.projection_context import (
    build_projection_roster,
    is_nfl_offseason,
    last_full_slate_week,
    resolve_projection_context,
    upcoming_season,
)
from src.core.schedule_utils import current_projection_week, week_rollover_at_et

ET = ZoneInfo("America/New_York")


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
    with patch(
        "src.core.projection_context.get_nfl_state",
        return_value={"season": 2025, "league_season": 2025, "week": 1, "season_type": "off"},
    ):
        season, week = resolve_projection_context(df)
        assert season == 2025
        assert week == 1


def test_resolve_projection_context_preseason_week_one():
    rows = [{"player_id": f"p{i}", "team": f"T{i}", "week": 18, "season": 2025} for i in range(32)]
    df = pd.DataFrame(rows)
    with patch(
        "src.core.projection_context.get_nfl_state",
        return_value={"season": 2026, "league_season": 2026, "week": 2, "season_type": "pre"},
    ):
        season, week = resolve_projection_context(df)
    assert season == 2026
    assert week == 1


def test_week_rollover_is_tuesday_midnight_after_mnf():
    rollover = week_rollover_at_et(2025, 1)
    assert rollover is not None
    local = rollover.astimezone(ET)
    assert local.weekday() == 1  # Tuesday
    assert local.hour == 0 and local.minute == 0


def test_current_projection_week_holds_through_monday_night():
    # 2025 week 1 MNF ends Mon Sep 8 ~20:15 ET; rolls Tue Sep 9 00:00 ET
    assert current_projection_week(2025, now=datetime(2025, 9, 8, 23, 30, tzinfo=ET)) == 1
    assert current_projection_week(2025, now=datetime(2025, 9, 9, 0, 0, tzinfo=ET)) == 2


def test_resolve_uses_schedule_week_during_regular_season():
    rows = [{"player_id": f"p{i}", "team": f"T{i}", "week": 1, "season": 2025} for i in range(32)]
    df = pd.DataFrame(rows)
    state = {"season": 2025, "league_season": 2025, "week": 1, "season_type": "regular"}
    with patch("src.core.projection_context.get_nfl_state", return_value=state):
        season, week = resolve_projection_context(
            df,
            now=datetime(2025, 9, 7, 12, 0, tzinfo=ET),
        )
    assert season == 2025
    assert week == 1
    with patch("src.core.projection_context.get_nfl_state", return_value=state):
        season2, week2 = resolve_projection_context(
            df,
            now=datetime(2025, 9, 9, 0, 0, tzinfo=ET),
        )
    assert season2 == 2025
    assert week2 == 2
