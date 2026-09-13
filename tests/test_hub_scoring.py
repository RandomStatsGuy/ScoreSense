"""Hub-native lineup, schedule, PPR scoring, and Game Center payload."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.hub_scoring import (
    LineupError,
    apply_week_scores,
    build_hub_live_week,
    build_hub_standings,
    ensure_season_schedule,
    ensure_team_lineup,
    fantasy_points_from_stats,
    nfl_game_started,
    resolve_week_lineup,
    set_team_starters,
    slot_accepts_position,
    swap_lineup_players,
)
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules, ScoringRules


def _client(sub: str) -> TestClient:
    app.dependency_overrides[require_hub_user] = lambda: {"sub": sub, "auth_type": "dev"}
    return TestClient(app)


def _seed_two_team_league(hub_db):
    raw = load_preset("salary_cap_auction_v1").model_dump()
    raw["roster"]["k"]["starter"] = 0
    raw["roster"]["def"]["starter"] = 0
    rules = LeagueRules.model_validate(raw)
    comm = "hub-score-comm"
    ws = storage.get_or_create_workspace(comm, season=2026)
    league = storage.create_league(comm, "Hub Score", 2026, rules, workspace_id=ws["id"])
    home = storage.get_team_by_user(league["id"], comm)
    away = storage.join_league("hub-score-opp", league["room_code"], "Away Club")
    roster_ws = storage.roster_workspace_for_league(league)
    home_players = [
        ("qb-a", "QB Alpha", "KC", "QB", 20),
        ("rb-a1", "RB Ace", "SF", "RB", 30),
        ("rb-a2", "RB Two", "DET", "RB", 18),
        ("wr-a1", "WR Ace", "MIA", "WR", 28),
        ("wr-a2", "WR Co", "PHI", "WR", 16),
        ("wr-a3", "WR Bench", "NYJ", "WR", 8),
        ("wr-a4", "WR Deep", "CLE", "WR", 12),
        ("rb-a3", "RB Flex", "HOU", "RB", 9),
        ("te-a", "TE Ace", "BAL", "TE", 10),
    ]
    away_players = [
        ("qb-b", "QB Beta", "BUF", "QB", 22),
        ("rb-b1", "RB Beta", "CHI", "RB", 24),
        ("wr-b1", "WR Beta", "DAL", "WR", 20),
        ("te-b", "TE Beta", "LV", "TE", 9),
    ]
    for pid, name, team, pos, salary in home_players:
        storage.add_roster_slot(
            roster_ws,
            {
                "player_id": pid,
                "player_name": name,
                "team": team,
                "position": pos,
                "salary": salary,
                "contract_years": 1,
            },
            team_id=home["id"],
        )
    for pid, name, team, pos, salary in away_players:
        storage.add_roster_slot(
            roster_ws,
            {
                "player_id": pid,
                "player_name": name,
                "team": team,
                "position": pos,
                "salary": salary,
                "contract_years": 1,
            },
            team_id=away["id"],
        )
    return league, home, away, comm


def test_fantasy_points_from_stats_is_standard_ppr():
    pts = fantasy_points_from_stats(
        {
            "receptions": 5,
            "receiving_yards": 80,
            "receiving_tds": 1,
        }
    )
    assert pts == 19.0


def test_flex_slot_rejects_qb():
    rules = LeagueRules.model_validate(load_preset("salary_cap_auction_v1"))
    assert slot_accepts_position("FLEX", "WR", rules) is True
    assert slot_accepts_position("FLEX", "QB", rules) is False
    assert slot_accepts_position("RB2", "RB", rules) is True
    assert slot_accepts_position("RB2", "WR", rules) is False


def test_schedule_is_stable_across_ensure(hub_db):
    league, home, away, _ = _seed_two_team_league(hub_db)
    first = ensure_season_schedule(league["id"], season=2026)
    second = ensure_season_schedule(league["id"], season=2026)
    assert first["weeks"] == 14
    assert first["weeks_written"] == 14
    assert second["weeks_written"] == 0
    week1 = [m for m in first["matchups"] if int(m["week"]) == 1]
    assert len(week1) == 1
    ids = {week1[0]["home_team_id"], week1[0]["away_team_id"]}
    assert ids == {home["id"], away["id"]}


def test_ensure_lineup_salary_fill_then_swap(hub_db):
    league, home, _away, _ = _seed_two_team_league(hub_db)
    rows = ensure_team_lineup(league["id"], home["id"], 2026, 1)
    starters = {row["player_id"] for row in rows if row["lineup_role"] == "starter"}
    bench = {row["player_id"] for row in rows if row["lineup_role"] == "bench"}
    assert "wr-a1" in starters
    assert "wr-a3" in bench
    wr2 = next(row for row in rows if row["player_id"] == "wr-a2")
    swapped = swap_lineup_players(
        league["id"],
        home["id"],
        2026,
        1,
        starter_player_id=wr2["player_id"],
        bench_player_id="wr-a3",
        game_started=lambda _team: False,
    )
    by_id = {row["player_id"]: row for row in swapped}
    assert by_id["wr-a3"]["lineup_role"] == "starter"
    assert by_id["wr-a3"]["slot"] == wr2["slot"]
    assert by_id["wr-a2"]["lineup_role"] == "bench"


def test_swap_rejects_illegal_flex_and_locks(hub_db):
    league, home, _away, _ = _seed_two_team_league(hub_db)
    ensure_team_lineup(league["id"], home["id"], 2026, 1)
    rows = storage.list_team_lineup(league["id"], home["id"], 2026, 1)
    flex = next(row for row in rows if str(row["slot"]).startswith("FLEX"))
    # Put the QB on the bench conceptually: swapping a QB onto FLEX is illegal.
    qb = next(row for row in rows if row["player_id"] == "qb-a")
    storage.replace_team_lineup(
        league["id"],
        home["id"],
        2026,
        1,
        [
            {**row, "lineup_role": "bench", "slot": "BN"}
            if row["player_id"] == "qb-a"
            else row
            for row in rows
        ],
    )
    try:
        swap_lineup_players(
            league["id"],
            home["id"],
            2026,
            1,
            starter_player_id=flex["player_id"],
            bench_player_id="qb-a",
            game_started=lambda _team: False,
        )
        raise AssertionError("QB onto FLEX should fail")
    except LineupError as exc:
        assert "cannot start" in str(exc)

    storage.replace_team_lineup(league["id"], home["id"], 2026, 1, rows)
    wr2 = next(row for row in rows if row["player_id"] == "wr-a2")
    try:
        swap_lineup_players(
            league["id"],
            home["id"],
            2026,
            1,
            starter_player_id=wr2["player_id"],
            bench_player_id="wr-a3",
            game_started=lambda _team: True,
        )
        raise AssertionError("lock should block swap")
    except LineupError as exc:
        assert "started" in str(exc)


def test_apply_week_scores_and_standings(hub_db, monkeypatch):
    league, home, away, _ = _seed_two_team_league(hub_db)
    monkeypatch.setattr(
        "src.draft_hub.hub_scoring.nfl_game_started",
        lambda *_a, **_k: False,
    )
    ensure_team_lineup(league["id"], home["id"], 2026, 1)
    ensure_team_lineup(league["id"], away["id"], 2026, 1)
    stats = {
        "qb-a": {"passing_yards": 300, "passing_tds": 2, "fantasy_points": 24.0},
        "rb-a1": {"rushing_yards": 80, "rushing_tds": 1, "fantasy_points": 14.0},
        "wr-a1": {"receptions": 6, "receiving_yards": 90, "fantasy_points": 15.0},
        "qb-b": {"passing_yards": 180, "passing_tds": 1, "fantasy_points": 13.2},
        "rb-b1": {"rushing_yards": 40, "fantasy_points": 4.0},
        "wr-b1": {"receptions": 3, "receiving_yards": 30, "fantasy_points": 6.0},
    }
    result = apply_week_scores(league["id"], 2026, 1, stat_index=stats, slate_complete=True)
    assert result["scored"] is True
    assert result["players_with_stats"] >= 6
    team_scores = {row["team_id"]: row["points"] for row in storage.list_team_week_scores(league["id"], 2026, 1)}
    assert team_scores[home["id"]] > team_scores[away["id"]]
    standings = build_hub_standings(league["id"], 2026)
    assert standings[0]["hub_team_id"] == home["id"]
    assert standings[0]["wins"] == 1
    assert standings[1]["losses"] == 1

    empty = apply_week_scores(league["id"], 2026, 2, stat_index={})
    assert empty["scored"] is False
    assert empty["reason"] == "no_stats"

    midweek = apply_week_scores(league["id"], 2026, 2, stat_index=stats, slate_complete=False)
    assert midweek["scored"] is False
    assert midweek["reason"] == "week_in_progress"
    assert storage.list_team_week_scores(league["id"], 2026, 2) == []
    assert not any(row.get("locked") for row in storage.list_team_lineup(league["id"], home["id"], 2026, 2))

    payload = build_hub_live_week(
        league["id"],
        week=1,
        viewer_team_id=home["id"],
        nfl_state={"week": 1, "season": "2026", "season_type": "regular"},
    )
    assert payload["source"] == "hub"
    assert payload["placeholder"] is False
    viewer = next(
        team
        for matchup in payload["matchups"]
        for team in matchup["teams"]
        if team.get("is_viewer")
    )
    assert viewer["points"] == team_scores[home["id"]]
    assert any(starter["player_id"] == "wr-a1" for starter in viewer["starters"])
    assert payload["preseason"] is False
    assert payload["placeholder"] is False


def test_lineup_swap_and_score_week_routes(hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    monkeypatch.setattr(
        "src.draft_hub.hub_scoring.nfl_game_started",
        lambda *_a, **_k: False,
    )
    league, home, _away, comm = _seed_two_team_league(hub_db)
    client = _client(comm)

    got = client.get(f"/api/hub/league/{league['id']}/lineup?week=1")
    assert got.status_code == 200
    body = got.json()
    assert body["team_id"] == home["id"]
    wr2 = next(row for row in body["lineup"] if row["player_id"] == "wr-a2")
    swapped = client.post(
        f"/api/hub/league/{league['id']}/lineup/swap",
        json={
            "starter_player_id": wr2["player_id"],
            "bench_player_id": "wr-a3",
            "week": 1,
        },
    )
    assert swapped.status_code == 200
    by_id = {row["player_id"]: row for row in swapped.json()["lineup"]}
    assert by_id["wr-a3"]["lineup_role"] == "starter"

    illegal = client.post(
        f"/api/hub/league/{league['id']}/lineup/swap",
        json={"starter_player_id": "rb-a1", "bench_player_id": "wr-a2", "week": 1},
    )
    assert illegal.status_code == 400

    monkeypatch.setattr(
        "src.draft_hub.hub_scoring.nfl_week_slate_complete",
        lambda *_a, **_k: True,
    )
    monkeypatch.setattr(
        "src.draft_hub.hub_scoring.load_week_stat_index",
        lambda season, week: {
            "qb-a": {"fantasy_points": 20.0},
            "rb-a1": {"fantasy_points": 12.0},
            "wr-a1": {"fantasy_points": 11.0},
            "wr-a3": {"fantasy_points": 9.0},
            "te-a": {"fantasy_points": 7.0},
            "rb-a2": {"fantasy_points": 8.0},
            "qb-b": {"fantasy_points": 10.0},
            "rb-b1": {"fantasy_points": 6.0},
            "wr-b1": {"fantasy_points": 5.0},
            "te-b": {"fantasy_points": 4.0},
        },
    )
    scored = client.post(
        f"/api/hub/league/{league['id']}/score-week",
        json={"week": 1, "season": 2026},
    )
    assert scored.status_code == 200
    assert scored.json()["scored"] is True

    live = client.get(f"/api/hub/league/{league['id']}/live-scoring?week=1")
    assert live.status_code == 200
    live_body = live.json()
    assert live_body["source"] == "hub"
    assert live_body["placeholder"] is False
    assert live_body["preseason"] is False
    assert live_body["standings"][0]["wins"] == 1


def test_sleeper_linked_league_stays_inferred_and_rejects_hub_score(hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    league, home, _away, comm = _seed_two_team_league(hub_db)
    storage.update_league_sleeper_id(league["id"], "sleeper-hosted-1")
    rules = LeagueRules.model_validate(league["rules"])
    players = [
        {
            "player_id": "wr-a1",
            "position": "WR",
            "salary": 28,
            "player_name": "WR Ace",
        },
        {
            "player_id": "wr-a3",
            "position": "WR",
            "salary": 8,
            "player_name": "WR Bench",
        },
    ]
    starters, bench, meta = resolve_week_lineup(
        {
            "mode": "league",
            "league_id": league["id"],
            "team_id": home["id"],
            "sleeper_league_id": "sleeper-hosted-1",
        },
        players,
        rules,
        season=2026,
        week=1,
    )
    assert meta["lineup_source"] == "inferred"
    assert not storage.list_team_lineup(league["id"], home["id"], 2026, 1)
    assert starters or bench

    try:
        apply_week_scores(league["id"], 2026, 1, stat_index={"wr-a1": {"fantasy_points": 10}})
        raise AssertionError("Sleeper-hosted scoring should fail")
    except LineupError as exc:
        assert "Sleeper" in str(exc)

    client = _client(comm)
    blocked = client.post(
        f"/api/hub/league/{league['id']}/score-week",
        json={"week": 1, "season": 2026},
    )
    assert blocked.status_code == 409
    lineup = client.get(f"/api/hub/league/{league['id']}/lineup?week=1")
    assert lineup.status_code == 409


def test_score_week_route_rejects_non_commissioner(hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    league, _home, away, _comm = _seed_two_team_league(hub_db)
    client = _client(away["user_sub"])
    blocked = client.post(
        f"/api/hub/league/{league['id']}/score-week",
        json={"week": 1, "season": 2026},
    )
    assert blocked.status_code == 403


def test_set_team_starters_rejects_two_quarterbacks(hub_db):
    league, home, _away, _ = _seed_two_team_league(hub_db)
    roster_ws = storage.roster_workspace_for_league(storage.get_league(league["id"]))
    storage.add_roster_slot(
        roster_ws,
        {
            "player_id": "qb-a2",
            "player_name": "QB Two",
            "team": "LAC",
            "position": "QB",
            "salary": 8,
            "contract_years": 1,
        },
        team_id=home["id"],
    )
    rows = ensure_team_lineup(league["id"], home["id"], 2026, 1)
    starters = [
        {"player_id": row["player_id"], "slot": row["slot"]}
        for row in rows
        if row["lineup_role"] == "starter"
    ]
    qb_slot = next(item for item in starters if item["player_id"] == "qb-a")
    try:
        set_team_starters(
            league["id"],
            home["id"],
            2026,
            1,
            [*starters, {"player_id": "qb-a2", "slot": "QB2"}],
            game_started=lambda _team: False,
        )
        raise AssertionError("two QB starters should fail")
    except LineupError as exc:
        assert "QB" in str(exc)
    try:
        set_team_starters(
            league["id"],
            home["id"],
            2026,
            1,
            [*starters, {"player_id": "qb-a2", "slot": qb_slot["slot"]}],
            game_started=lambda _team: False,
        )
        raise AssertionError("duplicate QB slot should fail")
    except LineupError as exc:
        assert "slot" in str(exc).lower()
    still = {row["player_id"]: row for row in storage.list_team_lineup(league["id"], home["id"], 2026, 1)}
    assert still["qb-a"]["lineup_role"] == "starter"
    assert still.get("qb-a2", {}).get("lineup_role") != "starter"


def test_set_team_starters_cannot_bench_locked_starter(hub_db):
    league, home, _away, _ = _seed_two_team_league(hub_db)
    rows = ensure_team_lineup(league["id"], home["id"], 2026, 1)
    locked_starter = next(row for row in rows if row["player_id"] == "wr-a1")
    assert locked_starter["lineup_role"] == "starter"
    starter_slots = [
        {"player_id": row["player_id"], "slot": row["slot"]}
        for row in rows
        if row["lineup_role"] == "starter"
    ]
    storage.replace_team_lineup(
        league["id"],
        home["id"],
        2026,
        1,
        [{**row, "locked": True} if row["player_id"] == "wr-a1" else row for row in rows],
    )
    kept = [item for item in starter_slots if item["player_id"] != "wr-a1"]
    try:
        set_team_starters(
            league["id"],
            home["id"],
            2026,
            1,
            kept,
            game_started=lambda _team: False,
        )
        raise AssertionError("omitting a locked starter should fail")
    except LineupError as exc:
        assert "started" in str(exc)
    still = {row["player_id"]: row for row in storage.list_team_lineup(league["id"], home["id"], 2026, 1)}
    assert still["wr-a1"]["lineup_role"] == "starter"
    assert still["wr-a1"]["slot"] == locked_starter["slot"]
    replayed = set_team_starters(
        league["id"],
        home["id"],
        2026,
        1,
        starter_slots,
        game_started=lambda _team: False,
    )
    by_id = {row["player_id"]: row for row in replayed}
    assert by_id["wr-a1"]["lineup_role"] == "starter"
    assert by_id["wr-a1"]["slot"] == locked_starter["slot"]


def test_ensure_team_lineup_does_not_drop_locked_players(hub_db):
    league, home, _away, _ = _seed_two_team_league(hub_db)
    rows = ensure_team_lineup(league["id"], home["id"], 2026, 1)
    assert any(row["player_id"] == "wr-a1" for row in rows)
    storage.lock_week_lineups(league["id"], 2026, 1)
    ws = storage.roster_workspace_for_league(league)
    storage.remove_roster_slot(ws, "wr-a1")
    kept = ensure_team_lineup(league["id"], home["id"], 2026, 1)
    assert any(row["player_id"] == "wr-a1" for row in kept)
    for row in storage.list_roster(ws, home["id"]):
        storage.remove_roster_slot(ws, row["player_id"])
    frozen = ensure_team_lineup(league["id"], home["id"], 2026, 1)
    assert frozen
    assert any(row["player_id"] == "wr-a1" for row in frozen)


def test_nfl_game_started_uses_et_kickoff_not_gameday_midnight(monkeypatch):
    import pandas as pd

    from src.core.schedule_utils import schedule_kickoff_utc

    kick = schedule_kickoff_utc("2026-09-13", "13:00")
    assert kick == pd.Timestamp("2026-09-13 17:00:00", tz="UTC")

    games = pd.DataFrame(
        [
            {
                "season": 2026,
                "week": 1,
                "team": "MIA",
                "gameday": pd.Timestamp("2026-09-13", tz="UTC"),
                "kickoff": kick,
            }
        ]
    )
    monkeypatch.setattr(
        "src.core.schedule_utils.team_game_kickoffs",
        lambda season, team: games,
    )
    before = datetime(2026, 9, 13, 0, 30, tzinfo=timezone.utc)
    after = datetime(2026, 9, 13, 17, 30, tzinfo=timezone.utc)
    assert nfl_game_started("MIA", 2026, 1, now=before) is False
    assert nfl_game_started("MIA", 2026, 1, now=after) is True


@pytest.mark.parametrize("points", [0, 0.5, 1, 1.5])
def test_custom_receptions_and_touchdowns(points):
    scoring = ScoringRules(receptions=points, passing_tds=6, interceptions=-3)
    assert fantasy_points_from_stats({"receptions": 4, "passing_tds": 2, "interceptions": 1}, scoring) == 9 + 4 * points
    assert fantasy_points_from_stats({"passing_tds": 2}, ScoringRules(passing_tds=0)) == 0


@pytest.mark.parametrize("value", [float("nan"), float("inf"), -101, 101])
def test_invalid_scoring_weights_rejected(value):
    with pytest.raises(ValidationError):
        ScoringRules(receptions=value)


def test_scoring_settings_reject_unsupported_keys():
    with pytest.raises(ValidationError):
        ScoringRules(kicker_points=3)


def test_custom_scoring_uses_raw_stats_and_explicit_recalculation(hub_db, monkeypatch):
    league, home, _away, comm = _seed_two_team_league(hub_db)
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_game_started", lambda *_a, **_k: False)
    stats = {"wr-a1": {"receptions": 6, "receiving_yards": 90, "fantasy_points": 999}}
    apply_week_scores(league["id"], 2026, 1, stat_index=stats, slate_complete=True)
    prior = {r["player_id"]: r for r in storage.list_player_week_scores(league["id"], 2026, 1)}
    assert prior["wr-a1"]["points"] == 15
    raw = storage.get_league(league["id"])["rules"]
    raw["scoring"]["receptions"] = 0.5
    result = _client(comm).put("/api/hub/workspace", json={"league_id": league["id"], "rules": raw})
    assert result.status_code == 200
    assert storage.get_week_scoring_run(league["id"], 2026, 1)["scoring"]["receptions"] == 1
    assert build_hub_live_week(league["id"], week=1, rules=raw, nfl_state={"season": "2026", "week": 1, "season_type": "regular"})["scoring_control"]["settings_changed"] is True
    assert storage.list_player_week_scores(league["id"], 2026, 1) == list(prior.values())
    apply_week_scores(league["id"], 2026, 1, stat_index=stats, slate_complete=True)
    after = {r["player_id"]: r for r in storage.list_player_week_scores(league["id"], 2026, 1)}
    assert after["wr-a1"]["points"] == 12
    assert storage.get_week_scoring_run(league["id"], 2026, 1)["scoring"]["receptions"] == 0.5
    assert all(r["locked"] for r in storage.list_week_lineups(league["id"], 2026, 1))


def test_sleeper_settings_rejected_without_other_side_effects(hub_db):
    league, _home, _away, comm = _seed_two_team_league(hub_db)
    storage.update_league_sleeper_id(league["id"], "123456")
    before = storage.get_league(league["id"])
    raw = dict(before["rules"])
    raw["scoring"] = {**raw["scoring"], "receptions": 0.5}
    result = _client(comm).put("/api/hub/workspace", json={"league_id": league["id"], "name": "Changed", "rules": raw})
    assert result.status_code == 409
    assert "Sleeper" in result.json()["detail"]
    after = storage.get_league(league["id"])
    assert after["rules"] == before["rules"]
    assert after["name"] == before["name"]


def test_older_rules_clients_preserve_custom_weights(hub_db):
    league, _home, _away, comm = _seed_two_team_league(hub_db)
    raw = storage.get_league(league["id"])["rules"]
    raw["scoring"]["receptions"] = 0.5
    storage.update_league_rules(league["id"], LeagueRules.model_validate(raw))
    raw.pop("scoring")
    raw["salary_cap"] = 250
    response = _client(comm).put("/api/hub/workspace", json={"league_id": league["id"], "rules": raw})
    assert response.status_code == 200
    saved = storage.get_league(league["id"])["rules"]
    assert saved["scoring"]["receptions"] == 0.5
    assert saved["salary_cap"] == 250


def test_atomic_score_write_keeps_previous_results_on_failure(hub_db):
    import sqlite3
    league, home, _away, _comm = _seed_two_team_league(hub_db)
    scoring = ScoringRules().model_dump()
    player = {"player_id": "wr-a1", "team_id": home["id"], "points": 10}
    team = {"team_id": home["id"], "points": 10}
    storage.save_native_week_scores(league["id"], 2026, 1, [player], [team], scoring)
    before = storage.list_team_week_scores(league["id"], 2026, 1)
    with pytest.raises(sqlite3.IntegrityError):
        storage.save_native_week_scores(league["id"], 2026, 1, [player, player], [{**team, "points": 99}], scoring)
    assert storage.list_team_week_scores(league["id"], 2026, 1) == before


def test_settings_change_during_calculation_aborts_publish(hub_db):
    league, _home, _away, _comm = _seed_two_team_league(hub_db)
    def load_stats(*_args):
        raw = storage.get_league(league["id"])["rules"]
        raw["scoring"]["receptions"] = 0.5
        storage.update_league_rules(league["id"], LeagueRules.model_validate(raw))
        return {"wr-a1": {"receptions": 2}}
    with pytest.raises(LineupError, match="changed during"):
        apply_week_scores(league["id"], 2026, 1, load_stats=load_stats, slate_complete=True)
    assert storage.list_team_week_scores(league["id"], 2026, 1) == []


def test_native_scoring_rejects_unsupported_starters(hub_db, monkeypatch):
    league, home, _away, _comm = _seed_two_team_league(hub_db)
    original = storage.list_week_lineups
    monkeypatch.setattr(storage, "list_week_lineups", lambda *args: [*original(*args),
        {"player_id": "kicker", "team_id": home["id"], "position": "K", "lineup_role": "starter"}])
    with pytest.raises(LineupError, match="Kicker and defense"):
        apply_week_scores(league["id"], 2026, 1, stat_index={"wr-a1": {"receptions": 1}}, slate_complete=True)
    assert storage.list_team_week_scores(league["id"], 2026, 1) == []


def test_week_stats_normalize_nflverse_turnovers(monkeypatch):
    import pandas as pd
    from src.draft_hub.hub_scoring import load_week_stat_index
    frame = pd.DataFrame([{"week": 1, "player_id": "qb", "passing_interceptions": 2,
                           "sack_fumbles_lost": 1, "rushing_fumbles_lost": 1,
                           "receiving_fumbles_lost": float("nan")}])
    monkeypatch.setattr("src.etl.nflverse_etl.load_weekly_player_stats", lambda *_: frame)
    stats = load_week_stat_index(2026, 1)["qb"]
    assert stats["interceptions"] == 2
    assert stats["fumbles_lost"] == 2
    assert fantasy_points_from_stats(stats) == -8
