"""This Week must display recorded Sleeper starters, never a guessed lineup."""
from copy import deepcopy

import pytest

from src.draft_hub import storage
from src.draft_hub.hub_scoring import resolve_week_lineup
from src.draft_hub.presets import load_preset


@pytest.fixture
def linked_lineup(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("lineup-viewer", season=2026)
    league = storage.create_league("lineup-viewer", "Recorded lineup", 2026, rules, workspace_id=ws["id"])
    team = storage.get_team_by_user(league["id"], "lineup-viewer")
    storage.update_league_sleeper_id(league["id"], "recorded-sleeper")
    storage.update_team_sleeper_link(team["id"], sleeper_roster_id="1")
    ctx = {"mode": "league", "league_id": league["id"], "team_id": team["id"],
           "sleeper_league_id": "recorded-sleeper"}
    players = [
        {"player_id": "qb-benched", "sleeper_player_id": "100", "player_name": "Expensive QB", "position": "QB", "salary": 50},
        {"player_id": "00-QB", "sleeper_player_id": "101", "player_name": "Actual QB", "position": "QB", "salary": 1, "p50": 18},
        {"player_id": "00-WR-BENCH", "sleeper_player_id": "102", "player_name": "Expensive WR", "position": "WR", "salary": 45},
        {"player_id": "sleeper-103", "sleeper_player_id": "103", "player_name": "Actual WR", "position": "WR", "salary": 1, "p50": 12},
        {"player_id": "00-RB", "sleeper_player_id": "104", "player_name": "Actual RB", "position": "RB", "salary": 1, "p50": 11},
        {"player_id": "wr-flex", "sleeper_player_id": "105", "player_name": "Actual Flex", "position": "WR", "salary": 1, "p50": 10},
    ]
    payload = {"available": True, "season": 2026, "week": 4, "current_week": 4,
               "starting_slots": ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
               "matchups": [{"teams": [
                   {"roster_id": "2", "is_viewer": True, "starters": [{"player_id": "someone-else"}]},
                   {"roster_id": "1", "starters": [
                       {"sleeper_player_id": sid, "player_id": f"sleeper-{sid}" if sid != "0" else ""}
                       for sid in ["101", "0", "104", "103", "0", "0", "105", "0", "0"]
                   ], "bench_players": [{"sleeper_player_id": "100", "player_id": "sleeper-100"},
                                        {"sleeper_player_id": "102", "player_id": "00-WR-BENCH"}]}]}]}

    def no_provider(*args, **kwargs):
        raise AssertionError("This Week must read the shared cache without provider requests")

    monkeypatch.setattr("src.draft_hub.league_live_scoring._fetch_json", no_provider)
    return ctx, players, rules, payload


def save(payload):
    storage.upsert_sleeper_live_scoring_cache("recorded-sleeper", 4, deepcopy(payload))


def resolve(fixture):
    ctx, players, rules, _ = fixture
    return resolve_week_lineup(ctx, players, rules, season=2026, week=4)


def test_recorded_starters_override_salary_and_preserve_slots_and_projection_cards(linked_lineup):
    ctx, players, _, payload = linked_lineup
    original = deepcopy(players)
    save(payload)
    starters, bench, meta = resolve(linked_lineup)
    assert {p["slot"]: p["player_id"] for p in starters} == {
        "QB": "00-QB", "RB2": "00-RB", "WR1": "sleeper-103", "FLEX": "wr-flex"}
    assert {p["player_id"] for p in bench} == {"qb-benched", "00-WR-BENCH"}
    assert next(p for p in starters if p["slot"] == "QB")["p50"] == 18
    assert meta["lineup_source"] == "sleeper"
    assert meta["lineup_available"] is True
    assert meta["lineup_synced_at"]
    assert storage.list_team_lineup(ctx["league_id"], ctx["team_id"], 2026, 4) == []
    assert players == original


@pytest.mark.parametrize("bad", [{"season": 2025}, {"week": 3}, {"placeholder": True},
                                  {"available": False}, {"matchups": []}])
def test_other_season_week_or_placeholder_is_never_presented_as_your_lineup(linked_lineup, bad):
    _, players, _, payload = linked_lineup
    save({**payload, **bad})
    starters, bench, meta = resolve(linked_lineup)
    assert starters == []
    assert len(bench) == len(players)
    assert meta["lineup_available"] is False


def test_missing_snapshot_or_team_mapping_never_falls_back_to_another_team(linked_lineup):
    ctx, players, _, payload = linked_lineup
    assert resolve(linked_lineup)[0] == []
    payload["matchups"][0]["teams"] = payload["matchups"][0]["teams"][:1]
    save(payload)
    assert resolve(linked_lineup)[0] == []
    assert resolve(linked_lineup)[2]["lineup_available"] is False


def test_updated_shared_snapshot_changes_the_starting_qb(linked_lineup):
    _, _, _, payload = linked_lineup
    save(payload)
    assert resolve(linked_lineup)[0][0]["player_id"] == "00-QB"
    mine = payload["matchups"][0]["teams"][1]
    mine["starters"][0] = {"sleeper_player_id": "100", "player_id": "sleeper-100"}
    mine["bench_players"][0] = {"sleeper_player_id": "101", "player_id": "sleeper-101"}
    save(payload)
    starters, bench, _ = resolve(linked_lineup)
    assert starters[0]["player_id"] == "qb-benched"
    assert "00-QB" in {p["player_id"] for p in bench}


def test_historical_starters_survive_current_roster_changes(linked_lineup):
    _, _, _, payload = linked_lineup
    payload["current_week"] = 5
    mine = payload["matchups"][0]["teams"][1]
    mine["starters"] = [{"player_id": "old-qb", "sleeper_player_id": "999", "name": "Prior QB", "position": "QB", "team": "KC", "proj": 17}]
    mine["bench_players"] = [{"player_id": "old-bench", "sleeper_player_id": "998", "name": "Prior bench", "position": "RB"}]
    save(payload)
    starters, bench, meta = resolve(linked_lineup)
    assert [(p["player_id"], p["player_name"], p["slot"]) for p in starters] == [("old-qb", "Prior QB", "QB")]
    assert [p["player_id"] for p in bench] == ["old-bench"]
    assert meta["lineup_available"] is True


def test_all_empty_recorded_slots_are_available_without_fabricating_starters(linked_lineup):
    _, _, _, payload = linked_lineup
    payload["matchups"][0]["teams"][1]["starters"] = [{"sleeper_player_id": "0", "player_id": ""}] * 9
    save(payload)
    starters, _, meta = resolve(linked_lineup)
    assert starters == []
    assert meta["lineup_available"] is True
