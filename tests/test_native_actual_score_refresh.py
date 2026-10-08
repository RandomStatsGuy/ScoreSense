"""Native provisional/final publication uses isolated databases and raw fixtures."""
from __future__ import annotations

import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from src.draft_hub import native_score_refresh as refresh, native_stats, storage
from src.draft_hub.hub_scoring import build_hub_standings, ensure_season_schedule
from src.draft_hub.presets import load_preset

FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2025, 9, 10, tzinfo=timezone.utc)


def snapshot(*, live=False):
    rows = json.loads((FIXTURES / "native_stats_sleeper_2025_w1.json").read_text(encoding="utf-8"))
    board = json.loads((FIXTURES / "native_scoreboard_espn_2025_w1.json").read_text(encoding="utf-8"))
    states = native_stats.parse_scoreboard(board, 2025, 1)
    if live:
        states["KC"].update(game_state="live", completed=False)
    return {**native_stats.parse_sleeper_week(rows, 2025, 1), "game_states": states,
            "complete": not live, "schedule_complete": True, "source": native_stats.SOURCE,
            "fetched_at": NOW.isoformat(), "fingerprint": "actual-final" if not live else "actual-live",
            "all_final_since": (NOW - timedelta(minutes=10)).isoformat() if not live else None}


def seed(hub_db, *, suffix="one"):
    rules = load_preset("snake_draft_v1")
    comm = f"native-{suffix}"
    league = storage.create_league(comm, "Native raw scores", 2025, rules, team_count=2)
    home = storage.get_team_by_user(league["id"], comm)
    away = storage.join_league(f"away-{suffix}", league["room_code"], "Away")
    with storage.get_conn() as conn:
        conn.execute("UPDATE league SET draft_completed=1 WHERE id=?", (league["id"],))
    league = storage.get_league(league["id"])
    ws = storage.roster_workspace_for_league(league)
    for team, players in [(home, [("4046", "Patrick Mahomes", "KC", "QB"),
                                 ("4227", "Harrison Butker", "KC", "K"),
                                 ("KC", "Kansas City Chiefs", "KC", "DEF")]),
                          (away, [("11533", "Brandon Aubrey", "DAL", "K"),
                                  ("PHI", "Philadelphia Eagles", "PHI", "DEF")])]:
        lineup = []
        for pid, name, club, position in players:
            storage.add_roster_slot(ws, {"player_id": pid, "player_name": name, "team": club,
                "position": position, "salary": 0, "contract_years": 1}, team_id=team["id"])
            lineup.append({"player_id": pid, "player_name": name, "nfl_team": club,
                "position": position, "slot": position, "lineup_role": "starter", "locked": False})
        storage.replace_team_lineup(league["id"], team["id"], 2025, 1, lineup)
    ensure_season_schedule(league["id"], season=2025)
    return league, home, away


def test_live_scores_never_publish_records_or_lock_unstarted_players(hub_db):
    league, home, away = seed(hub_db)
    result = refresh.refresh_league_week(league, 2025, 1, snapshot(live=True), now=NOW)
    assert result["status"] == "live"
    assert {r["team_id"]: r["points"] for r in result["teams"]} == {home["id"]: 39.02, away["id"]: 14}
    assert storage.list_team_week_scores(league["id"], 2025, 1) == []
    assert storage.get_week_scoring_run(league["id"], 2025, 1) is None
    assert all(not r["locked"] for r in storage.list_week_lineups(league["id"], 2025, 1))
    assert all(r["wins"] == 0 and r["points_for"] == 0 for r in build_hub_standings(league["id"], 2025))


def test_postseason_worker_ignores_eliminated_missing_header_and_stats(hub_db):
    from src.draft_hub.schemas import LeagueRules
    league, home, away = seed(hub_db)
    eliminated = storage.add_unclaimed_team(league["id"], "Eliminated", 200)
    raw = league["rules"]
    raw["regular_season_games"] = 1
    raw["playoffs"] = {"enabled": True, "teams": 2}
    storage.update_league_rules(league["id"], LeagueRules.model_validate(raw))
    league = storage.get_league(league["id"])
    storage.save_native_week_scores(league["id"], 2025, 1, [],
        [{"team_id": team["id"], "points": points} for team, points in ((home, 50), (away, 40), (eliminated, 1))],
        LeagueRules.model_validate(raw).scoring.model_dump())
    for team in (home, away):
        storage.replace_team_lineup(league["id"], team["id"], 2025, 2,
                                   storage.list_team_lineup(league["id"], team["id"], 2025, 1))
    storage.add_roster_slot(storage.roster_workspace_for_league(league),
        {"player_id": "unknown-eliminated", "player_name": "Missing feed player", "team": "FA",
         "position": "QB", "salary": 0, "contract_years": 1}, team_id=eliminated["id"])
    assert not storage.has_team_lineup_snapshot(league["id"], eliminated["id"], 2025, 2)
    first = refresh.refresh_league_week(league, 2025, 2, snapshot(), current_week=False, now=NOW)
    assert first["status"] == "pending"
    final = refresh.refresh_league_week(league, 2025, 2, snapshot(), current_week=False, now=NOW + timedelta(minutes=1))
    assert final["status"] == "final"
    assert {row["team_id"] for row in storage.list_team_week_scores(league["id"], 2025, 2)} == {home["id"], away["id"]}
    assert all(row["team_id"] != eliminated["id"] for row in final["players"])


def test_unverified_schedule_coverage_stays_pending_with_visible_reason(hub_db):
    league, _home, _away = seed(hub_db)
    data = snapshot()
    data.update(complete=False, schedule_complete=False, scoring_pending_reason="NFL schedule coverage is unverified.")
    first = refresh.refresh_league_week(league, 2025, 1, data, now=NOW)
    final = refresh.refresh_league_week(league, 2025, 1, data, now=NOW + timedelta(minutes=10))
    assert first["status"] == final["status"] == "pending"
    assert final["errors"] == ["NFL schedule coverage is unverified."]
    assert storage.get_week_scoring_run(league["id"], 2025, 1) is None


def test_background_worker_warms_cold_schedule_once_for_shared_period(hub_db, monkeypatch):
    first, _home, _away = seed(hub_db)
    second, _home2, _away2 = seed(hub_db, suffix="second")
    warmed, fetched = [], []
    def provider(season, week, **kwargs):
        fetched.append((season, week))
        return snapshot()
    monkeypatch.setattr(refresh, "NATIVE_SCORING_TESTING", False)
    monkeypatch.setattr(refresh, "get_week_snapshot", provider)
    monkeypatch.setattr(refresh, "cached_scheduled_teams", lambda *_: None)
    monkeypatch.setattr(refresh, "_warm_schedule_cache", lambda season: warmed.append([season]))
    result = refresh.run_native_score_tick(leagues=[first, second], snapshot_loader=provider,
        nfl_state={"season": "2025", "season_type": "regular", "week": 1}, now=NOW)
    assert warmed == [[2025]] and fetched == [(2025, 1)]
    assert len(result) == 2


def test_worker_schedule_warm_preserves_other_cached_seasons(monkeypatch, tmp_path):
    import pandas as pd
    from src.core import schedule_utils
    cache = tmp_path / "schedule.parquet"
    monkeypatch.setattr(schedule_utils, "SCHEDULE_CACHE", cache)
    before = pd.DataFrame([{"season": 2025, "week": 1, "game_type": "REG", "home_team": "KC", "away_team": "LAC"}])
    refreshed = pd.DataFrame([{"season": 2026, "week": 1, "game_type": "REG", "home_team": "KC", "away_team": "BUF"}])
    before.to_parquet(cache, index=False)
    monkeypatch.setattr("src.etl.nflverse_etl.load_schedules", lambda seasons: refreshed.copy())
    refresh._warm_schedule_cache(2026)
    merged = pd.read_parquet(cache)
    assert set(merged["season"]) == {2025, 2026}
    assert merged[merged["season"] == 2025].reset_index(drop=True).equals(before)
    refresh._warm_schedule_cache(2026)
    assert len(pd.read_parquet(cache)) == 2


def test_finished_fantasy_season_does_not_refresh_unscheduled_nfl_weeks(hub_db):
    league, _, _ = seed(hub_db)
    assert not league["rules"]["playoffs"]["enabled"]
    def unexpected_provider_call(*args, **kwargs):
        raise AssertionError("The fantasy season has ended; no provider request is needed")
    results = refresh.run_native_score_tick(leagues=[league],
        nfl_state={"season": "2025", "season_type": "regular", "week": 18},
        snapshot_loader=unexpected_provider_call, now=NOW)
    assert results == []
    assert storage.get_native_live_week(league["id"], 2025, 18) is None


def test_confirmed_final_slate_automatically_publishes_after_stable_stats(hub_db):
    league, home, away = seed(hub_db)
    first = refresh.refresh_league_week(league, 2025, 1, snapshot(), now=NOW)
    assert first["status"] == "pending"
    assert storage.list_team_week_scores(league["id"], 2025, 1) == []
    second = refresh.refresh_league_week(league, 2025, 1, snapshot(), now=NOW + timedelta(minutes=1))
    assert second["status"] == "final"
    assert {r["team_id"]: r["points"] for r in storage.list_team_week_scores(league["id"], 2025, 1)} == {home["id"]: 39.02, away["id"]: 14}
    assert all(r["locked"] for r in storage.list_week_lineups(league["id"], 2025, 1))
    assert build_hub_standings(league["id"], 2025)[0]["wins"] == 1
    assert storage.get_week_scoring_run(league["id"], 2025, 1)["scoring"] == league["rules"]["scoring"]


def test_after_kickoff_acquisition_cannot_inherit_other_teams_starter_points(hub_db):
    league, home, away = seed(hub_db)
    workspace = storage.roster_workspace_for_league(league)
    storage.move_roster_player(workspace, "4046", away["id"])
    storage.replace_team_lineup(league["id"], away["id"], 2025, 1, [
        *storage.list_team_lineup(league["id"], away["id"], 2025, 1),
        {"player_id": "4046", "player_name": "Patrick Mahomes", "nfl_team": "KC",
         "position": "QB", "slot": "BN", "lineup_role": "bench", "locked": True}])
    first = refresh.refresh_league_week(league, 2025, 1, snapshot(), now=NOW)
    old_owner = next(row for row in first["players"] if row["player_id"] == "4046" and row["team_id"] == home["id"])
    new_owner = next(row for row in first["players"] if row["player_id"] == "4046" and row["team_id"] == away["id"])
    assert old_owner["points"] == 26.02 and new_owner["points"] is None
    assert first["warnings"]
    second = refresh.refresh_league_week(league, 2025, 1, snapshot(), now=NOW + timedelta(minutes=1))
    assert second["status"] == "final"
    scored = [row for row in storage.list_player_week_scores(league["id"], 2025, 1) if row["player_id"] == "4046"]
    assert len(scored) == 1 and scored[0]["team_id"] == home["id"] and scored[0]["points"] == 26.02


def test_live_worker_reconciles_an_unstarted_trade_without_a_page_visit(hub_db, monkeypatch):
    league, home, away = seed(hub_db)
    storage.move_roster_player(storage.roster_workspace_for_league(league), "11533", home["id"])
    monkeypatch.setattr("src.draft_hub.hub_scoring._week_lineups_closed", lambda *a, **k: False)
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_game_started", lambda team, *a, **k: team != "DAL")
    feed = snapshot(live=True)
    feed["game_states"]["DAL"].update(game_state="pregame", completed=False)
    result = refresh.refresh_league_week(league, 2025, 1, feed, now=NOW)
    aubrey = [row for row in result["players"] if row["player_id"] == "11533"]
    assert len(aubrey) == 1 and aubrey[0]["team_id"] == home["id"]
    assert aubrey[0]["lineup_role"] == "bench" and aubrey[0]["points"] == 0
    assert next(row for row in result["teams"] if row["team_id"] == away["id"])["points"] == 3


def test_rescheduled_unfinished_game_prevents_finalization_even_after_monday(hub_db):
    league, _, _ = seed(hub_db)
    feed = snapshot(live=True)
    feed["game_states"]["KC"].update(game_state="pregame", kickoff_at="2025-09-12T00:00:00Z")
    refresh.refresh_league_week(league, 2025, 1, feed, now=NOW)
    result = refresh.refresh_league_week(league, 2025, 1, feed, now=NOW + timedelta(days=1))
    assert result["status"] == "live"
    assert storage.get_week_scoring_run(league["id"], 2025, 1) is None


def test_missing_actual_player_statistics_are_visible_and_retried(hub_db):
    league, _, _ = seed(hub_db)
    complete = snapshot()
    missing = copy.deepcopy(complete)
    missing["stats"].pop("4227")
    missing["stats"].pop("sleeper-4227")
    missing["identities"].pop("4227")
    missing["identities"].pop("sleeper-4227")
    missing["records"] = [r for r in missing["records"] if r["sleeper_player_id"] != "4227"]
    def loader(*args, **kwargs):
        return missing
    result = refresh.run_native_score_tick(leagues=[league], nfl_state={"season": "2025", "week": 1}, snapshot_loader=loader, now=NOW)
    assert result[0]["status"] == "error"
    assert "Harrison Butker" in result[0]["errors"][0]
    assert storage.get_week_scoring_run(league["id"], 2025, 1) is None
    assert storage.list_native_pending_weeks(league["id"], 2025) == [1]
    result = refresh.run_native_score_tick(leagues=[league], nfl_state={"season": "2025", "week": 1}, snapshot_loader=lambda *a, **k: complete, now=NOW + timedelta(minutes=1))
    assert result[0]["status"] == "pending"
    result = refresh.run_native_score_tick(leagues=[league], nfl_state={"season": "2025", "week": 1}, snapshot_loader=lambda *a, **k: complete, now=NOW + timedelta(minutes=2))
    assert result[0]["status"] == "final"


def test_refresh_fetches_once_for_multiple_native_leagues_and_excludes_sleeper(hub_db):
    league, _, _ = seed(hub_db)
    second, _, _ = seed(hub_db, suffix="two")
    linked, _, _ = seed(hub_db, suffix="linked")
    linked["sleeper_league_id"] = "external-host"
    calls = []
    def loader(*args, **kwargs):
        calls.append(args)
        return snapshot(live=True)
    result = refresh.run_native_score_tick(leagues=[league, second, linked],
        nfl_state={"season": "2025", "week": 1}, snapshot_loader=loader, now=NOW)
    assert len(calls) == 1
    assert len(result) == 2
    assert storage.get_native_live_week(linked["id"], 2025, 1) is None


def test_provider_failure_preserves_last_live_points_with_error_status(hub_db):
    league, _, _ = seed(hub_db)
    previous = refresh.refresh_league_week(league, 2025, 1, snapshot(live=True), now=NOW)
    def failed(*args, **kwargs):
        raise native_stats.NativeStatsUnavailable("Statistics provider is unavailable.")
    result = refresh.run_native_score_tick(leagues=[league], nfl_state={"season": "2025", "week": 1}, snapshot_loader=failed, now=NOW + timedelta(minutes=1))[0]
    assert result["status"] == "error"
    assert result["teams"] == previous["teams"]
    assert result["synced_at"] == previous["synced_at"]
    assert result["attempted_at"] != result["synced_at"]
    assert storage.get_week_scoring_run(league["id"], 2025, 1) is None


def test_unrecoverable_historical_lineup_does_not_use_todays_roster(hub_db):
    league, _, away = seed(hub_db)
    with storage.get_conn() as conn:
        conn.execute("DELETE FROM league_week_lineup WHERE league_id=? AND team_id=?", (league["id"], away["id"]))
        conn.execute("DELETE FROM league_week_lineup_snapshot WHERE league_id=? AND team_id=?", (league["id"], away["id"]))
    result = refresh.run_native_score_tick(leagues=[league], nfl_state={"season": "2025", "week": 1}, snapshot_loader=lambda *a, **k: snapshot(), now=NOW)[0]
    assert result["status"] == "error"
    assert "Historical starting lineups" in result["errors"][0]
    assert storage.list_team_lineup(league["id"], away["id"], 2025, 1) == []
    assert storage.get_week_scoring_run(league["id"], 2025, 1) is None


def test_legitimate_empty_team_snapshot_scores_zero_and_does_not_infer_players(hub_db):
    league, home, away = seed(hub_db)
    with storage.get_conn() as conn:
        conn.execute("DELETE FROM roster_slot WHERE team_id=?", (away["id"],))
    storage.replace_team_lineup(league["id"], away["id"], 2025, 1, [])
    refresh.refresh_league_week(league, 2025, 1, snapshot(), now=NOW)
    final = refresh.refresh_league_week(league, 2025, 1, snapshot(), now=NOW + timedelta(minutes=1))
    assert final["status"] == "final"
    assert {r["team_id"]: r["points"] for r in storage.list_team_week_scores(league["id"], 2025, 1)} == {home["id"]: 39.02, away["id"]: 0}
    assert storage.list_team_lineup(league["id"], away["id"], 2025, 1) == []


def test_missing_optional_bench_stats_remain_unknown_without_blocking_results(hub_db):
    league, home, _ = seed(hub_db)
    ws = storage.roster_workspace_for_league(league)
    row = {"player_id": "missing-bench-qb", "player_name": "Backup QB",
           "position": "QB", "team": "KC", "nfl_team": "KC",
           "salary": 0, "contract_years": 1, "slot": "BN", "lineup_role": "bench"}
    storage.add_roster_slot(ws, row, team_id=home["id"])
    lineup = storage.list_team_lineup(league["id"], home["id"], 2025, 1)
    storage.replace_team_lineup(league["id"], home["id"], 2025, 1, [*lineup, row])
    first = refresh.refresh_league_week(league, 2025, 1, snapshot(), now=NOW)
    assert first["status"] == "pending"
    assert next(r for r in first["players"] if r["player_id"] == "missing-bench-qb")["points"] is None
    assert first["warnings"]
    second = refresh.refresh_league_week(league, 2025, 1, snapshot(), now=NOW + timedelta(minutes=1))
    assert second["status"] == "final"
    assert all(r["player_id"] != "missing-bench-qb" for r in storage.list_player_week_scores(league["id"], 2025, 1))


@pytest.mark.parametrize("nfl_state", [
    {"season": "2025", "week": 1, "season_type": "post"},
    {"season": "2026", "week": 1, "season_type": "pre"},
])
def test_delayed_pending_statistics_retry_after_postseason_and_season_rollover(hub_db, nfl_state):
    league, _, _ = seed(hub_db)
    refresh.refresh_league_week(league, 2025, 1, snapshot(), now=NOW)
    calls = []
    def loader(*args, **kwargs):
        calls.append(args)
        return snapshot()
    result = refresh.run_native_score_tick(leagues=[league], nfl_state=nfl_state,
        snapshot_loader=loader, now=NOW + timedelta(minutes=1))
    assert calls == [(2025, 1)]
    assert result[0]["status"] == "final"
