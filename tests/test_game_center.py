import copy
import pandas as pd

from src.draft_hub.game_center import cached_game_states, game_center_payload


def test_sleeper_missing_player_results_remain_missing():
    from src.draft_hub.league_live_scoring import _enrich_starter
    players = {"123": {"first_name": "Player", "team": "JAX"}}
    assert _enrich_starter("123", {}, players)["points"] is None
    assert _enrich_starter("123", {"123": 0}, players)["points"] == 0
    assert _enrich_starter("123", {"123": -2}, players)["points"] == -2


def test_cached_states_follow_individual_kickoffs_and_confirmed_scores(monkeypatch, tmp_path):
    from src.core import schedule_utils
    cache = tmp_path / "schedule.parquet"
    pd.DataFrame([
        dict(season=2026, week=4, game_type="REG", gameday="2026-10-01", gametime="20:15", home_team="JAX", away_team="KC", home_score=None, away_score=None),
        dict(season=2026, week=4, game_type="REG", gameday="2026-09-30", gametime="20:15", home_team="WAS", away_team="BAL", home_score=0, away_score=7),
    ]).to_parquet(cache)
    monkeypatch.setattr(schedule_utils, "SCHEDULE_CACHE", cache)
    states = cached_game_states(2026, 4, now="2026-10-02T00:14:00Z")
    assert states["JAX"]["game_state"] == "pregame"
    assert states["WAS"]["game_state"] == "final"
    states = cached_game_states(2026, 4, now="2026-10-02T00:16:00Z")
    assert states["JAX"]["game_state"] == "live"
    monkeypatch.setattr(schedule_utils, "SCHEDULE_CACHE", tmp_path / "missing")
    assert cached_game_states(2026, 4) == {}


def test_baselines_are_captured_before_kickoff_and_never_backfilled(hub_db):
    original = {"season": 2026, "week": 4, "current_week": 4, "matchups": [{"teams": [{"starters": [
        {"player_id": "one", "name": "One", "team": "JAC", "proj": 16, "points": 0},
        {"player_id": "two", "name": "Two", "team": "KC", "proj": 12, "points": None},
    ]}]}]}
    baseline = copy.deepcopy(original)
    payload = game_center_payload(original, "league", game_states={"JAX": {"game_state": "pregame"}, "KC": {"game_state": "live"}})
    players = payload["matchups"][0]["teams"][0]["starters"]
    assert players[0]["pregame_projection"] == 16
    assert players[1]["pregame_projection"] is None
    original["matchups"][0]["teams"][0]["starters"][0]["proj"] = 25
    final = game_center_payload(original, "league", game_states={"JAX": {"game_state": "final"}, "KC": {"game_state": "final"}})
    assert final["week_complete"] is True
    assert final["matchups"][0]["teams"][0]["starters"][0]["pregame_projection"] == 16
    assert final["matchups"][0]["teams"][0]["starters"][1]["pregame_projection"] is None
    assert "game_state" not in original["matchups"][0]["teams"][0]["starters"][0]
    assert baseline["matchups"][0]["teams"][0]["starters"][0]["proj"] == 16

def test_native_progress_does_not_become_final_from_a_scored_snapshot(hub_db):
    payload = {"season": 2026, "week": 4, "current_week": 5,
               "scoring_control": {"host": "native", "scored": True, "final": False},
               "matchups": [{"teams": [{"starters": [{"player_id": "p", "team": "JAX", "name": "Player", "proj": 10}]}]}]}
    result = game_center_payload(payload, "league", game_states={"JAX": {"game_state": "live"}})
    assert result["matchups"][0]["teams"][0]["starters"][0]["game_state"] == "live"
    assert result["scoring_control"]["final"] is False
    assert not result.get("week_complete")
