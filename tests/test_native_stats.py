"""Actual provider-shaped fixtures, identities, sparse zeros and missing inputs."""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from src.draft_hub import native_stats
from src.draft_hub.hub_scoring import fantasy_points_from_stats, require_position_stats
from src.draft_hub.schemas import ScoringRules

FIXTURES = Path(__file__).parent / "fixtures"


def actual_snapshot():
    # Captured from the provider-owned weekly raw-stat endpoint; no fantasy
    # totals are copied into native recorded results.
    rows = json.loads((FIXTURES / "native_stats_sleeper_2025_w1.json").read_text(encoding="utf-8"))
    scoreboard = json.loads((FIXTURES / "native_scoreboard_espn_2025_w1.json").read_text(encoding="utf-8"))
    return {**native_stats.parse_sleeper_week(rows, 2025, 1, players={
        "4227": {"gsis_id": "00-0033303"}, "4046": {"gsis_id": "00-0033873"},
    }), "game_states": native_stats.parse_scoreboard(scoreboard, 2025, 1),
        "complete": True, "schedule_complete": True,
        "fetched_at": "2025-09-10T00:00:00+00:00", "fingerprint": "actual-w1",
        "all_final_since": "2025-09-09T23:50:00+00:00"}


@pytest.mark.parametrize("player_id,position,name,team,expected", [
    ("4227", "K", "Harrison Butker", "KC", 10),
    ("00-0033303", "K", "Harrison Butker", "KC", 10),
    ("sleeper-11533", "K", "Brandon Aubrey", "DAL", 11),
    ("KC", "DEF", "Kansas City Chiefs", "KC", 3),
    ("sleeper-PHI", "DEF", "Philadelphia Eagles", "PHI", 3),
    ("00-0033873", "QB", "Patrick Mahomes", "KC", 26.02),
])
def test_actual_feed_scores_native_ids_and_specialists(player_id, position, name, team, expected):
    stats = native_stats.resolve_lineup_stats({"player_id": player_id, "player_name": name,
                                             "position": position, "nfl_team": team}, actual_snapshot())
    require_position_stats(position, stats, ScoringRules())
    assert fantasy_points_from_stats(stats) == expected
    assert "pts_ppr" not in stats


def test_new_gsis_identity_uses_unique_historical_name_team_and_position():
    # Sleeper's embedded player metadata contains today's NYJ team, but the
    # 2025 event was IND. Historical event identity must win after player trades.
    stats = native_stats.resolve_lineup_stats({"player_id": "new-gsis-not-in-sleeper",
        "player_name": "Adonai Mitchell", "position": "WR", "team": "IND"}, actual_snapshot())
    assert fantasy_points_from_stats(stats) == 4.1
    with pytest.raises(native_stats.NativeStatsUnavailable, match="unavailable"):
        native_stats.resolve_lineup_stats({"player_id": "unmapped", "player_name": "Adonai Mitchell",
            "position": "WR", "team": "NYJ"}, actual_snapshot())


def test_custom_native_weights_apply_to_real_counts():
    snapshot = actual_snapshot()
    rules = ScoringRules(fg_made_50_59=6, def_sacks=2, passing_tds=6)
    assert fantasy_points_from_stats(snapshot["stats"]["4227"], rules) == 11
    assert fantasy_points_from_stats(snapshot["stats"]["KC"], rules) == 6
    assert fantasy_points_from_stats(snapshot["stats"]["4046"], rules) == 28.02


def test_sparse_existing_stat_record_differs_from_missing_player_record():
    snapshot = actual_snapshot()
    zero = native_stats.normalize_sleeper_stats({"gp": 1, "gms_active": 1}, "WR")
    assert fantasy_points_from_stats(zero) == 0
    with pytest.raises(native_stats.NativeStatsUnavailable, match="unavailable"):
        native_stats.resolve_lineup_stats({"player_id": "missing", "player_name": "Missing Player",
                                          "position": "WR", "team": "KC"}, snapshot)
    with pytest.raises(native_stats.NativeStatsUnavailable):
        native_stats.normalize_sleeper_stats({}, "WR")
    with pytest.raises(native_stats.NativeStatsUnavailable, match="points-allowed"):
        native_stats.normalize_sleeper_stats({"gp": 1, "sack": 3}, "DEF")


def test_before_kickoff_and_verified_bye_defense_are_zero_not_a_shutout():
    snapshot = actual_snapshot()
    snapshot["game_states"]["KC"] = {"game_state": "pregame", "completed": False}
    row = {"player_id": "KC", "position": "DEF", "team": "KC"}
    stats = native_stats.resolve_lineup_stats(row, snapshot)
    assert stats["_native_no_game"] == 1
    assert fantasy_points_from_stats(stats) == 0
    snapshot["game_states"].pop("KC")
    stats = native_stats.resolve_lineup_stats(row, snapshot)
    assert fantasy_points_from_stats(stats) == 0
    with pytest.raises(native_stats.NativeStatsUnavailable, match="NFL team"):
        native_stats.resolve_lineup_stats({**row, "player_id": "bad", "team": "UNK"}, snapshot)


def test_kicker_distance_bands_and_blocked_misses_are_complete():
    stats = native_stats.normalize_sleeper_stats({"gp": 1, "fgm": 2, "fga": 3,
        "fgm_50_59": 1, "fgm_60p": 1, "fg_blkd": 1, "xpa": 2, "xpm": 1}, "K")
    assert stats["fg_made_60_plus"] == 1
    assert stats["fg_missed"] == 1
    assert stats["pat_missed"] == 1
    assert fantasy_points_from_stats(stats, ScoringRules(fg_made_60_plus=7)) == 11
    with pytest.raises(native_stats.NativeStatsUnavailable, match="distance"):
        native_stats.normalize_sleeper_stats({"gp": 1, "fgm": 2, "fgm_50p": 2}, "K")
    assert native_stats.normalize_nflverse_stats({"fg_made_60_": 1})["fg_made_60_plus"] == 1


def test_only_explicit_completed_games_finalize_and_wrong_period_fails():
    board = json.loads((FIXTURES / "native_scoreboard_espn_2025_w1.json").read_text(encoding="utf-8"))
    states = native_stats.parse_scoreboard(board, 2025, 1)
    assert len(states) == 32
    assert all(s["completed"] for s in states.values())
    board["events"][0]["competitions"][0]["status"]["type"]["completed"] = False
    states = native_stats.parse_scoreboard(board, 2025, 1)
    assert states["PHI"]["game_state"] == "unknown"
    assert states["PHI"]["completed"] is False
    with pytest.raises(native_stats.NativeStatsUnavailable, match="different season or week"):
        native_stats.parse_scoreboard(board, 2025, 2)
    with pytest.raises(native_stats.NativeStatsUnavailable, match="scoring period"):
        rows = json.loads((FIXTURES / "native_stats_sleeper_2025_w1.json").read_text(encoding="utf-8"))
        native_stats.parse_sleeper_week(rows, 2025, 2)


def test_cache_is_shared_and_presentation_reads_never_fetch(monkeypatch, tmp_path):
    native_stats.clear_native_stats_cache()
    monkeypatch.setattr(native_stats, "NATIVE_STATS_DIR", tmp_path)
    rows = json.loads((FIXTURES / "native_stats_sleeper_2025_w1.json").read_text(encoding="utf-8"))
    board = json.loads((FIXTURES / "native_scoreboard_espn_2025_w1.json").read_text(encoding="utf-8"))
    calls = []
    def fetch(url):
        calls.append(url)
        return copy.deepcopy(board if "espn" in url else rows)
    monkeypatch.setattr(native_stats, "_fetch_json", fetch)
    monkeypatch.setattr("src.integrations.sleeper.load_sleeper_players", lambda: {})
    try:
        first = native_stats.get_week_snapshot(2025, 1)
        second = native_stats.get_week_snapshot(2025, 1)
        assert len(calls) == 2
        assert second["fingerprint"] == first["fingerprint"]
        native_stats.clear_native_stats_cache()
        assert native_stats.cached_week_snapshot(2025, 1)["stats"]["KC"]["def_sacks"] == 3
        assert len(calls) == 2
    finally:
        native_stats.clear_native_stats_cache()


def test_final_scoreboard_with_delayed_team_stats_does_not_publish_complete(monkeypatch, tmp_path):
    native_stats.clear_native_stats_cache()
    monkeypatch.setattr(native_stats, "NATIVE_STATS_DIR", tmp_path)
    rows = json.loads((FIXTURES / "native_stats_sleeper_2025_w1.json").read_text(encoding="utf-8"))
    rows = [r for r in rows if r["player_id"] != "KC"]
    board = json.loads((FIXTURES / "native_scoreboard_espn_2025_w1.json").read_text(encoding="utf-8"))
    monkeypatch.setattr(native_stats, "_fetch_json", lambda url: board if "espn" in url else rows)
    monkeypatch.setattr("src.integrations.sleeper.load_sleeper_players", lambda: {})
    try:
        with pytest.raises(native_stats.NativeStatsUnavailable, match="team statistics.*KC"):
            native_stats.get_week_snapshot(2025, 1)
        assert native_stats.cached_week_snapshot(2025, 1) is None
    finally:
        native_stats.clear_native_stats_cache()


def test_partial_scoreboard_cannot_turn_real_games_into_byes(monkeypatch, tmp_path):
    native_stats.clear_native_stats_cache()
    monkeypatch.setattr(native_stats, "NATIVE_STATS_DIR", tmp_path)
    rows = json.loads((FIXTURES / "native_stats_sleeper_2025_w1.json").read_text(encoding="utf-8"))
    board = json.loads((FIXTURES / "native_scoreboard_espn_2025_w1.json").read_text(encoding="utf-8"))
    board["events"] = [event for event in board["events"] if not any(
        competitor["team"]["abbreviation"] == "KC"
        for competition in event["competitions"] for competitor in competition["competitors"])]
    monkeypatch.setattr(native_stats, "_fetch_json", lambda url: board if "espn" in url else rows)
    monkeypatch.setattr("src.integrations.sleeper.load_sleeper_players", lambda: {})
    try:
        with pytest.raises(native_stats.NativeStatsUnavailable, match="statuses.*KC"):
            native_stats.get_week_snapshot(2025, 1)
        assert native_stats.cached_week_snapshot(2025, 1) is None
    finally:
        native_stats.clear_native_stats_cache()


def test_final_scoreboard_with_unplayed_defense_counts_is_still_pending(monkeypatch, tmp_path):
    native_stats.clear_native_stats_cache()
    monkeypatch.setattr(native_stats, "NATIVE_STATS_DIR", tmp_path)
    rows = json.loads((FIXTURES / "native_stats_sleeper_2025_w1.json").read_text(encoding="utf-8"))
    next(row for row in rows if row["player_id"] == "KC")["stats"] = {"gp": 0, "pts_allow": 0}
    board = json.loads((FIXTURES / "native_scoreboard_espn_2025_w1.json").read_text(encoding="utf-8"))
    monkeypatch.setattr(native_stats, "_fetch_json", lambda url: board if "espn" in url else rows)
    monkeypatch.setattr("src.integrations.sleeper.load_sleeper_players", lambda: {})
    try:
        with pytest.raises(native_stats.NativeStatsUnavailable, match="team statistics.*KC"):
            native_stats.get_week_snapshot(2025, 1)
        assert native_stats.cached_week_snapshot(2025, 1) is None
    finally:
        native_stats.clear_native_stats_cache()


def omitted_game_feed():
    rows = json.loads((FIXTURES / "native_stats_sleeper_2025_w1.json").read_text(encoding="utf-8"))
    full = json.loads((FIXTURES / "native_scoreboard_espn_2025_w1.json").read_text(encoding="utf-8"))
    board = copy.deepcopy(full)
    event = next(event for event in board["events"] if any(
        c["team"]["abbreviation"] == "KC" for match in event["competitions"] for c in match["competitors"]))
    missing = {native_stats._team(c["team"]["abbreviation"]) for match in event["competitions"] for c in match["competitors"]}
    board["events"].remove(event)
    rows = [row for row in rows if native_stats._team(row.get("team")) not in missing]
    rows.extend({"category": "stat", "season": 2025, "week": 1, "season_type": "regular",
                 "player_id": team, "team": team, "player": {"position": "DEF"},
                 "stats": {"gp": 0}, "game_id": None} for team in missing)
    return rows, board, full, missing


def mock_feed(monkeypatch, tmp_path, rows, board):
    native_stats.clear_native_stats_cache()
    monkeypatch.setattr(native_stats, "NATIVE_STATS_DIR", tmp_path)
    monkeypatch.setattr(native_stats, "_fetch_json", lambda url: board if "espn" in url else rows)
    monkeypatch.setattr("src.integrations.sleeper.load_sleeper_players", lambda: {})


def scoreboard_games(board):
    return {tuple(sorted(native_stats._team(c["team"]["abbreviation"]) for c in match["competitors"]))
            for event in board["events"] for match in event["competitions"]}


def test_omitted_unplayed_game_without_schedule_cannot_be_a_bye_or_finalize(monkeypatch, tmp_path):
    import pandas as pd
    from src.draft_hub.hub_scoring import nfl_game_started, lineup_edit_metadata
    rows, board, _full, _missing = omitted_game_feed()
    mock_feed(monkeypatch, tmp_path, rows, board)
    monkeypatch.setattr(native_stats, "cached_scheduled_games", lambda *_: None)
    monkeypatch.setattr("src.core.schedule_utils.team_game_kickoffs", lambda *_: pd.DataFrame())
    try:
        result = native_stats.get_week_snapshot(2025, 1)
        assert not result["complete"] and not result["schedule_complete"]
        assert "unverified" in result["scoring_pending_reason"]
        with pytest.raises(native_stats.NativeStatsUnavailable, match="game status"):
            native_stats.resolve_lineup_stats({"player_id": "KC", "position": "DEF", "team": "KC"}, result)
        assert nfl_game_started("KC", 2025, 1) is None
        assert lineup_edit_metadata({"player_id": "KC", "position": "DEF", "nfl_team": "KC"}, 2025, 1)["locked"]
    finally:
        native_stats.clear_native_stats_cache()


def test_cached_schedule_detects_omitted_unplayed_game(monkeypatch, tmp_path):
    rows, board, full, _missing = omitted_game_feed()
    mock_feed(monkeypatch, tmp_path, rows, board)
    monkeypatch.setattr(native_stats, "cached_scheduled_games", lambda *_: scoreboard_games(full))
    try:
        with pytest.raises(native_stats.NativeStatsUnavailable, match="cached schedule.*KC"):
            native_stats.get_week_snapshot(2025, 1)
        assert native_stats.cached_week_snapshot(2025, 1) is None
    finally:
        native_stats.clear_native_stats_cache()


def test_verified_true_bye_defense_is_zero_and_unlocked(monkeypatch, tmp_path):
    from src.draft_hub.hub_scoring import nfl_game_started, lineup_edit_metadata
    rows, board, _full, _missing = omitted_game_feed()
    mock_feed(monkeypatch, tmp_path, rows, board)
    monkeypatch.setattr(native_stats, "cached_scheduled_games", lambda *_: scoreboard_games(board))
    try:
        result = native_stats.get_week_snapshot(2025, 1)
        assert result["complete"] and result["schedule_complete"]
        row = {"player_id": "KC", "position": "DEF", "team": "KC"}
        zero = native_stats.resolve_lineup_stats(row, result)
        assert zero["_native_no_game"] == 1 and fantasy_points_from_stats(zero) == 0
        assert nfl_game_started("KC", 2025, 1) is False
        assert not lineup_edit_metadata(row, 2025, 1)["locked"]
    finally:
        native_stats.clear_native_stats_cache()


def test_full_season_cache_is_required_for_bye_coverage(monkeypatch, tmp_path):
    import pandas as pd
    from src.core import schedule_utils
    board = json.loads((FIXTURES / "native_scoreboard_espn_2025_w1.json").read_text(encoding="utf-8"))
    games = scoreboard_games(board)
    cache = tmp_path / "schedule.parquet"
    monkeypatch.setattr(schedule_utils, "SCHEDULE_CACHE", cache)
    season = [{"season": 2025, "week": week, "game_type": "REG", "home_team": home, "away_team": away}
              for week in range(1, 18) for home, away in games]
    pd.DataFrame(season).to_parquet(cache, index=False)
    assert native_stats.cached_scheduled_games(2025, 1) == games
    pd.DataFrame(season[:-1]).to_parquet(cache, index=False)
    assert native_stats.cached_scheduled_games(2025, 1) is None


def test_legacy_cache_cannot_retain_unverified_bye_claim(monkeypatch, tmp_path):
    native_stats.clear_native_stats_cache()
    monkeypatch.setattr(native_stats, "NATIVE_STATS_DIR", tmp_path)
    legacy = actual_snapshot()
    legacy.update(season=2025, week=1)
    legacy["game_states"].pop("KC")
    (tmp_path / "2025_w1.json").write_text(json.dumps(legacy), encoding="utf-8")
    result = native_stats.cached_week_snapshot(2025, 1)
    assert not result["complete"] and not result["schedule_complete"]
    assert result["all_final_since"] is None
    with pytest.raises(native_stats.NativeStatsUnavailable, match="game status"):
        native_stats.resolve_lineup_stats({"player_id": "KC", "position": "DEF", "team": "KC"}, result)


def test_scoreboard_pairings_must_match_cached_games(monkeypatch, tmp_path):
    rows = json.loads((FIXTURES / "native_stats_sleeper_2025_w1.json").read_text(encoding="utf-8"))
    board = json.loads((FIXTURES / "native_scoreboard_espn_2025_w1.json").read_text(encoding="utf-8"))
    expected = scoreboard_games(board)
    first = board["events"][0]["competitions"][0]["competitors"][0]
    second = board["events"][1]["competitions"][0]["competitors"][0]
    first["team"], second["team"] = second["team"], first["team"]
    mock_feed(monkeypatch, tmp_path, rows, board)
    monkeypatch.setattr(native_stats, "cached_scheduled_games", lambda *_: expected)
    try:
        with pytest.raises(native_stats.NativeStatsUnavailable, match="matchups"):
            native_stats.get_week_snapshot(2025, 1)
    finally:
        native_stats.clear_native_stats_cache()
