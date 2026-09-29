"""Tests for the Vegas lines board."""

import pandas as pd

from src.products import vegas_lines
from src.products.vegas_lines import (
    LINE_REFRESH_SECONDS,
    attach_line_history,
    build_vegas_board,
    refresh_lines_if_stale,
    refresh_schedule_season,
)


def _schedule_frame() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "game_id": "2026_01_NE_SEA",
                "season": 2026,
                "week": 1,
                "gameday": "2026-09-09",
                "weekday": "Wednesday",
                "gametime": "20:20",
                "away_team": "NE",
                "home_team": "SEA",
                "spread_line": 3.5,
                "total_line": 44.5,
                "away_moneyline": 150.0,
                "home_moneyline": -180.0,
                "roof": "outdoors",
                "stadium": "Lumen Field",
                "temp": 61,
                "wind": 8,
            },
            {
                "game_id": "2026_01_CHI_CAR",
                "season": 2026,
                "week": 1,
                "gameday": "2026-09-13",
                "weekday": "Sunday",
                "gametime": "13:00",
                "away_team": "CHI",
                "home_team": "CAR",
                "spread_line": -2.5,
                "total_line": 47.5,
                "away_moneyline": -142.0,
                "home_moneyline": 120.0,
            },
            {
                "game_id": "2026_01_GB_MIN",
                "season": 2026,
                "week": 1,
                "gameday": "2026-09-13",
                "weekday": "Sunday",
                "gametime": "16:25",
                "away_team": "GB",
                "home_team": "MIN",
                "spread_line": None,
                "total_line": None,
                "away_moneyline": None,
                "home_moneyline": None,
            },
            {
                "game_id": "2026_02_KC_DEN",
                "season": 2026,
                "week": 2,
                "gameday": "2026-09-20",
                "weekday": "Sunday",
                "gametime": "13:00",
                "away_team": "KC",
                "home_team": "DEN",
                "spread_line": -7.0,
                "total_line": 45.0,
                "away_moneyline": -320.0,
                "home_moneyline": 260.0,
            },
        ]
    )


def test_vegas_board_filters_to_week_and_sorts_by_kickoff():
    board = build_vegas_board(2026, 1, schedules=_schedule_frame())
    assert board["count"] == 3
    assert [g["game_id"] for g in board["games"]] == [
        "2026_01_NE_SEA",
        "2026_01_CHI_CAR",
        "2026_01_GB_MIN",
    ]
    assert board["with_lines"] == 2


def test_vegas_board_implied_totals_follow_home_spread_convention():
    board = build_vegas_board(2026, 1, schedules=_schedule_frame())
    sea_game = board["games"][0]
    # Positive spread_line = home favored: SEA -3.5 with a 44.5 total.
    assert sea_game["favorite"] == "SEA"
    assert sea_game["home_implied"] == 24.0
    assert sea_game["away_implied"] == 20.5

    car_game = board["games"][1]
    assert car_game["favorite"] == "CHI"
    assert car_game["away_implied"] == 25.0
    assert car_game["home_implied"] == 22.5


def test_vegas_board_team_context_is_team_relative():
    board = build_vegas_board(2026, 1, schedules=_schedule_frame())
    teams = board["teams"]
    assert teams["SEA"]["opponent"] == "NE"
    assert teams["SEA"]["is_home"] is True
    assert teams["SEA"]["spread"] == -3.5  # favored teams quote negative
    assert teams["NE"]["spread"] == 3.5
    assert teams["NE"]["implied_total"] == 20.5
    assert teams["GB"]["implied_total"] is None
    assert teams["GB"]["opponent"] == "MIN"
    assert teams["SEA"]["roof"] == "outdoors"
    assert teams["SEA"]["temp"] == 61
    assert teams["SEA"]["wind"] == 8


def test_vegas_board_handles_missing_lines():
    board = build_vegas_board(2026, 1, schedules=_schedule_frame())
    gb_game = board["games"][2]
    assert gb_game["spread_line"] is None
    assert gb_game["total_line"] is None
    assert gb_game["home_implied"] is None
    assert gb_game["favorite"] is None
    assert gb_game["kickoff_et"].startswith("2026-09-13T16:25")


def test_line_history_keeps_first_seen_consensus(tmp_path):
    history_path = tmp_path / "2026_w1.json"
    first = build_vegas_board(2026, 1, schedules=_schedule_frame())
    attach_line_history(first, history_path)

    moved_frame = _schedule_frame()
    moved_frame.loc[moved_frame["game_id"] == "2026_01_NE_SEA", "spread_line"] = 5.5
    moved_frame.loc[moved_frame["game_id"] == "2026_01_NE_SEA", "total_line"] = 46.0
    moved = build_vegas_board(2026, 1, schedules=moved_frame)
    attach_line_history(moved, history_path)

    sea_game = moved["games"][0]
    assert sea_game["first_seen_spread_line"] == 3.5
    assert sea_game["first_seen_total_line"] == 44.5
    assert sea_game["spread_line"] == 5.5
    assert sea_game["total_line"] == 46.0


def test_schedule_refresh_replaces_only_that_season(tmp_path):
    cache = tmp_path / "nfl_schedules.parquet"
    current = _schedule_frame()
    older = current.copy()
    older["season"] = 2025
    older["game_id"] = older["game_id"].str.replace("2026_", "2025_", regex=False)
    pd.concat([older, current], ignore_index=True).to_parquet(cache, index=False)

    moved = _schedule_frame()
    moved.loc[moved["game_id"] == "2026_01_NE_SEA", "total_line"] = 46.0
    assert refresh_schedule_season(2026, cache, loader=lambda seasons: moved)

    out = pd.read_parquet(cache)
    assert sorted(out["season"].unique().tolist()) == [2025, 2026]
    assert len(out) == len(current) * 2
    assert out.loc[out["game_id"] == "2026_01_NE_SEA", "total_line"].iloc[0] == 46.0
    assert out.loc[out["game_id"] == "2025_01_NE_SEA", "total_line"].iloc[0] == 44.5


def test_stale_lines_start_one_background_refresh(tmp_path):
    vegas_lines._line_refresh_attempts.pop(2031, None)
    cache = tmp_path / "nfl_schedules.parquet"
    _schedule_frame().to_parquet(cache, index=False)
    written_at = cache.stat().st_mtime
    started = []

    assert not refresh_lines_if_stale(2031, cache, now=written_at + 60, start=started.append)
    later = written_at + LINE_REFRESH_SECONDS + 1
    assert refresh_lines_if_stale(2031, cache, now=later, start=started.append)
    assert not refresh_lines_if_stale(2031, cache, now=later + 1, start=started.append)
    assert len(started) == 1
