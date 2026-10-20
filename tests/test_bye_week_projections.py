"""Confirmed byes override saved game forecasts, including specialist estimates."""
from __future__ import annotations

import pandas as pd
import pytest

from src.core import schedule_utils
from src.draft_hub.weekly_command_center import (
    _enrich_roster_players, _load_projection_index, apply_bye_week_projections,
)
from src.draft_hub.league_live_scoring import attach_matchup_analytics


def test_cache_only_byes_require_complete_team_schedule(monkeypatch):
    rows = [{"season": 2026, "week": w, "home_team": "JAX", "away_team": "BUF"}
            for w in range(1, 19) if w != 7]
    rows.append({"season": 2026, "week": 1, "home_team": "KC", "away_team": "DEN"})
    def cached(seasons, *, allow_fetch):
        assert seasons == [2026]
        assert allow_fetch is False
        return pd.DataFrame(rows)
    monkeypatch.setattr(schedule_utils, "_load_schedules", cached)
    assert schedule_utils.teams_on_bye(2026, 7, allow_fetch=False) == {"JAX", "BUF"}
    assert schedule_utils.teams_on_bye(2026, 6, allow_fetch=False) == set()
    rows.clear()
    assert schedule_utils.teams_on_bye(2026, 7, allow_fetch=False) == set()


def test_historical_week_outside_regular_season_is_not_a_bye(monkeypatch):
    rows = [{"season": 2020, "week": w, "home_team": "KC", "away_team": "DEN"}
            for w in range(1, 18) if w != 7]
    monkeypatch.setattr(schedule_utils, "_load_schedules", lambda *_a, **_k: pd.DataFrame(rows))
    assert schedule_utils.teams_on_bye(2020, 7, allow_fetch=False) == {"KC", "DEN"}
    assert schedule_utils.teams_on_bye(2020, 18, allow_fetch=False) == set()
    rows[:] = [r for r in rows if r["week"] != 6]
    rows.append({"season": 2020, "week": 18, "home_team": "KC", "away_team": "DEN"})
    assert schedule_utils.teams_on_bye(2020, 7, allow_fetch=False) == set()


@pytest.mark.parametrize("team,opponent", [("BUF", "BYE"), ("JAX", None)])
def test_roster_bye_removes_positive_forecast_and_range(team, opponent):
    roster = [{"player_id": "bye", "player_name": "Bye Player", "position": "QB", "team": team}]
    projection = {"p10": 8, "p50": 15.9, "p90": 27, "volatility": 1.2,
                  "spread": 19, "position_rank": 12, "opponent": opponent, "has_projection": True}
    card = _enrich_roster_players(roster, {"bye": projection}, bye_teams={"JAC"})[0]
    assert [card[k] for k in ("p10", "p50", "p90", "spread")] == [0, 0, 0, 0]
    assert card["on_bye"] and card["opponent"] == "BYE"
    assert card["volatility"] is None and card["position_rank"] is None
    assert card["has_projection"] and not card["projection_missing"]
    assert projection["p50"] == 15.9  # No shared artifact mutation.


def test_prepared_snapshot_read_suppresses_old_bye_forecasts(monkeypatch):
    index = {"lawrence": {"player_id": "lawrence", "team": "JAX", "p50": 15.9}}
    monkeypatch.setattr("src.draft_hub.prepared_week_context.load_week_context", lambda *_: (index, {}, {}))
    monkeypatch.setattr("src.draft_hub.weekly_command_center.cached_bye_teams", lambda *_: {"JAC"})
    result, _ = _load_projection_index(2026, 7, apply_injury_adjustments=True)
    assert result["lawrence"]["p50"] == 0
    assert result["lawrence"]["on_bye"]


def test_unknown_schedule_and_real_zero_remain_distinct_from_bye():
    cards = [{"team": "KC", "p50": None, "has_projection": False, "projection_missing": True},
             {"team": "DEN", "p50": 0, "has_projection": True}]
    apply_bye_week_projections(cards, set())
    assert cards[0]["p50"] is None and cards[0]["projection_missing"]
    assert cards[1]["p50"] == 0 and not cards[1].get("on_bye")


def test_bye_specialists_never_receive_rank_curve_estimates(monkeypatch):
    from src.draft_hub.k_def_pool_cache import overlay_k_def_week_projections
    def unexpected(**_):
        raise AssertionError("Bye-only cards must not load specialist estimates")
    monkeypatch.setattr("src.draft_hub.k_def_pool_cache.k_def_projection_index", unexpected)
    cards = [{"position": "K", "on_bye": True, "p50": 0},
             {"position": "DEF", "opponent": "BYE", "p50": None}]
    overlay_k_def_week_projections(cards)
    assert [c["p50"] for c in cards] == [0, None]


def test_vibes_specialists_share_weekly_bye_handling(monkeypatch):
    from src.draft_hub import vibe_rankings
    monkeypatch.setattr(vibe_rankings, "list_roster_for_context", lambda *_a, **_k: [
        {"player_id": "k", "player_name": "Cam Little", "position": "K", "team": "JAX"}])
    monkeypatch.setattr(vibe_rankings, "_load_projection_index", lambda *_a, **_k: ({}, {}))
    monkeypatch.setattr(vibe_rankings, "cached_bye_teams", lambda *_: {"JAC"})
    def unexpected(**_):
        raise AssertionError("Vibes must not refill a bye from a season rank curve")
    monkeypatch.setattr("src.draft_hub.k_def_pool_cache.k_def_projection_index", unexpected)
    cards, _, _ = vibe_rankings._load_week_players({"rules": {}}, season=2026, week=7)
    assert cards[0]["on_bye"] and cards[0]["p50"] == 0


def test_matchup_byes_include_bench_and_specialists_preserving_recorded_points(monkeypatch):
    def unexpected(_cards):
        assert not _cards
    monkeypatch.setattr("src.draft_hub.k_def_pool_cache.overlay_k_def_week_projections", unexpected)
    starters = [{"player_id": "qb", "name": "Trevor Lawrence", "position": "QB", "team": "JAX", "points": 4},
                {"player_id": "k", "name": "Cam Little", "position": "K", "team": "JAX", "points": 0},
                {"player_id": "def", "name": "JAX DEF", "position": "DEF", "team": "JAX", "points": 0}]
    bench = [{"player_id": "wr", "name": "DJ Moore", "position": "WR", "team": "BUF"}]
    team = {"roster_id": "one", "points": 4, "starters": starters, "bench_players": bench}
    attach_matchup_analytics([{"teams": [team]}], {"qb": {"p50": 15.9}, "wr": {"p50": 3.1}}, bye_teams={"JAC", "BUF"})
    assert all(p["proj"] == 0 and p["on_bye"] for p in starters + bench)
    assert team["proj_total"] == 0
    assert starters[0]["points"] == 4 and team["points"] == 4
