"""Hub-native lineup, schedule, PPR scoring, and Game Center payload."""

from __future__ import annotations

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
    pair_season_teams,
    resolve_week_lineup,
    set_team_starters,
    slot_accepts_position,
    swap_lineup_players,
)
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


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


def test_pair_season_teams_even_count_is_round_robin():
    teams = [{"id": f"t{i}", "name": f"Team {i:02d}"} for i in range(10)]
    opponents: dict[str, set[str]] = {row["id"]: set() for row in teams}
    for week in range(1, 10):
        pairs = pair_season_teams(teams, week)
        assert len(pairs) == 5
        seen: set[str] = set()
        for home, away in pairs:
            assert away is not None
            hid, aid = home["id"], away["id"]
            assert hid not in seen and aid not in seen
            seen.update((hid, aid))
            opponents[hid].add(aid)
            opponents[aid].add(hid)
        assert seen == set(opponents)
    assert all(len(opps) == 9 for opps in opponents.values())


def test_schedule_rebuilds_when_teams_join(hub_db):
    league, home, away, _ = _seed_two_team_league(hub_db)
    first = ensure_season_schedule(league["id"], season=2026)
    assert first["weeks_written"] == 14
    third = storage.join_league("hub-score-third", league["room_code"], "Third Club")
    rebuilt = ensure_season_schedule(league["id"], season=2026)
    assert rebuilt["weeks_written"] == 14
    week1_ids = set()
    for row in rebuilt["matchups"]:
        if int(row["week"]) != 1:
            continue
        week1_ids.add(row["home_team_id"])
        if row.get("away_team_id"):
            week1_ids.add(row["away_team_id"])
    assert week1_ids == {home["id"], away["id"], third["id"]}


def test_nfl_game_started_uses_kickoff_not_midnight(monkeypatch):
    from datetime import datetime
    from zoneinfo import ZoneInfo

    et = ZoneInfo("America/New_York")
    kick = datetime(2026, 9, 13, 13, 0, tzinfo=et)
    monkeypatch.setattr(
        "src.core.schedule_utils.team_week_kickoff_et",
        lambda *_a, **_k: kick,
    )
    morning = datetime(2026, 9, 13, 10, 0, tzinfo=et)
    first_snap = datetime(2026, 9, 13, 13, 0, tzinfo=et)
    assert nfl_game_started("KC", 2026, 1, now=morning) is False
    assert nfl_game_started("KC", 2026, 1, now=first_snap) is True


def test_put_lineup_rejects_benching_locked_starter(hub_db):
    league, home, _away, _ = _seed_two_team_league(hub_db)
    rows = ensure_team_lineup(league["id"], home["id"], 2026, 1)
    starters = [row for row in rows if row["lineup_role"] == "starter"]
    kept = [
        {"player_id": row["player_id"], "slot": row["slot"]}
        for row in starters
        if row["player_id"] != "wr-a1"
    ]
    try:
        set_team_starters(
            league["id"],
            home["id"],
            2026,
            1,
            kept,
            game_started=lambda team: team == "MIA",
        )
        raise AssertionError("omitting a locked starter should fail")
    except LineupError as exc:
        assert "started" in str(exc)
    after = storage.list_team_lineup(league["id"], home["id"], 2026, 1)
    wr = next(row for row in after if row["player_id"] == "wr-a1")
    assert wr["lineup_role"] == "starter"


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
    result = apply_week_scores(league["id"], 2026, 1, stat_index=stats)
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

    monkeypatch.setattr(
        "src.draft_hub.hub_scoring.week_ready_to_score",
        lambda *_a, **_k: False,
    )
    monkeypatch.setattr(
        "src.draft_hub.hub_scoring.load_week_stat_index",
        lambda *_a, **_k: {"qb-a": {"fantasy_points": 20.0}},
    )
    partial = apply_week_scores(league["id"], 2026, 2)
    assert partial["scored"] is False
    assert partial["reason"] == "week_in_progress"
    assert storage.list_team_week_scores(league["id"], 2026, 2) == []

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
    monkeypatch.setattr(
        "src.draft_hub.hub_scoring.week_ready_to_score",
        lambda *_a, **_k: True,
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


def test_workspace_sleeper_link_does_not_host_hub_scoring(hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    monkeypatch.setattr(
        "src.draft_hub.hub_scoring.nfl_game_started",
        lambda *_a, **_k: False,
    )
    league, _home, _away, comm = _seed_two_team_league(hub_db)
    storage.update_sleeper_link(
        comm,
        sleeper_league_id="solo-sleeper-9",
        sleeper_roster_id="1",
        sleeper_team_name="Solo Club",
    )
    assert not storage.get_league(league["id"]).get("sleeper_league_id")
    client = _client(comm)
    lineup = client.get(f"/api/hub/league/{league['id']}/lineup?week=1")
    assert lineup.status_code == 200
    live = client.get(f"/api/hub/league/{league['id']}/live-scoring?week=1")
    assert live.status_code == 200
    assert live.json()["source"] == "hub"
    assert not storage.get_league(league["id"]).get("sleeper_league_id")
    lineup = client.get(f"/api/hub/league/{league['id']}/lineup?week=1")
    assert lineup.status_code == 200
