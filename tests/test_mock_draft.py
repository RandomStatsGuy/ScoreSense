"""Mock draft launcher."""

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_pool import build_nomination_pool
from src.draft_hub.draft_recap import build_draft_recap
from src.draft_hub.draft_state import award_nominee, end_draft, nominate, place_bid
from src.draft_hub.mock_draft import start_mock_draft
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_quick_mock_creates_test_league_and_starts(hub_db):
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=3, auto_start=True)
    assert out["mock_mode"] == "quick_bots"
    assert out["auto_started"] is True
    assert out["state"]["session"]["status"] in ("nominating", "bidding")
    teams = out["state"]["teams"]
    assert sum(1 for t in teams if t.get("is_bot")) == 3


def test_mock_league_nomination_pool_without_workspace(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.value_sheet.build_draft_pool_payload",
        lambda *a, **k: {"rows": [{"player_id": "p1", "player": "Test QB", "position": "QB", "is_rookie": False}]},
    )
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=False)
    league = storage.get_league(out["league_id"])
    assert league.get("workspace_id") is None
    rules = LeagueRules.model_validate(league["rules"])
    pool = build_nomination_pool(
        league_id=league["id"],
        pool_mode="full",
        season=int(league["season"]),
        rules=rules,
        workspace_id=storage.roster_workspace_for_league(league),
    )
    assert pool["count"] == 1


def test_mock_league_recap_overview_after_end(hub_db):
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=True)
    league_id = out["league_id"]
    team = storage.list_league_teams(league_id)[0]
    ws = storage.roster_workspace_for_league(storage.get_league(league_id))
    storage.add_roster_slot(
        ws,
        {
            "player_id": "p9",
            "player_name": "Mock Pick",
            "team": "KC",
            "position": "WR",
            "salary": 15,
            "contract_years": 1,
        },
        team_id=team["id"],
    )
    storage.append_draft_event(
        league_id,
        "win",
        {
            "team_id": team["id"],
            "team_name": team["name"],
            "player_id": "p9",
            "player_name": "Mock Pick",
            "position": "WR",
            "amount": 15,
            "fair_value": 20,
            "value_grade": "steal",
        },
    )
    end_draft(league_id, "mock-user")
    overview = storage.league_roster_overview(league_id)
    assert overview["teams"]
    recap = build_draft_recap(league_id, overview=overview)
    assert recap is not None
    assert recap["pick_count"] == 1


def test_mock_award_lands_on_roster_and_blocks_renomination(hub_db):
    """Mock leagues have no workspace: the award must write to the same roster
    workspace the reads use, and a won player can't be nominated again."""
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=True)
    league_id = out["league_id"]
    player = {
        "player_id": "p1",
        "player_name": "Test WR",
        "team": "KC",
        "position": "WR",
        "fair_value": 30,
        "season_proj": 250,
        "per_game_proj": 15,
    }
    nominate(league_id, "mock-user", player)
    place_bid(league_id, "mock-user", 5)
    award_nominee(league_id, "mock-user")

    team = storage.get_team_by_user(league_id, "mock-user")
    roster = storage.list_team_roster(league_id, team["id"])
    assert any(str(r.get("player_id")) == "p1" for r in roster)

    with pytest.raises(ValueError, match="already drafted"):
        nominate(league_id, "mock-user", player)


def test_bot_bidding_stops_at_fair_value_ceiling(hub_db):
    """Bots value players at 0.75x–1.15x fair value — an auction must converge
    near fair price instead of climbing until budgets run out."""
    from src.draft_hub.test_draft import bot_max_price, maybe_bot_bid

    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=3, auto_start=True)
    league_id = out["league_id"]
    fair = 20
    nominate(
        league_id,
        "mock-user",
        {
            "player_id": "p1",
            "player_name": "Test WR",
            "team": "KC",
            "position": "WR",
            "fair_value": fair,
            "season_proj": 250,
            "per_game_proj": 15,
        },
    )
    for _ in range(80):
        if maybe_bot_bid(league_id) is None:
            break
    session = storage.get_draft_session(league_id)
    high = float(session.get("high_bid") or 0)
    assert 1 <= high <= fair * 1.15 + 1
    assert maybe_bot_bid(league_id) is None

    # Unvalued players are cheap fliers only.
    assert bot_max_price("bot-x", {"player_id": "p2"}, 1.0) == 3.0


def test_mock_league_empty_recap_after_end_without_picks(hub_db):
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=True)
    end_draft(out["league_id"], "mock-user")
    recap = build_draft_recap(out["league_id"])
    assert recap is None


def test_league_mirror_uses_manager_names(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("comm", 2025)
    source = storage.create_league("comm", "Real League", 2025, rules, workspace_id=ws["id"])
    storage.join_league("mgr-a", source["room_code"], "Alice")
    storage.join_league("mgr-b", source["room_code"], "Bob")

    out = start_mock_draft(
        "comm",
        mode="league_mirror",
        source_league_id=source["id"],
        auto_start=False,
    )
    bot_names = [t["name"] for t in out["state"]["teams"] if t.get("is_bot")]
    assert any("Alice" in n for n in bot_names)
    assert any("Bob" in n for n in bot_names)


def _fake_pool_rows(n=8):
    positions = ["QB", "RB", "WR", "TE", "RB", "WR", "WR", "QB"]
    return [
        {
            "player_id": f"sim-{i}",
            "player": f"Sim Player {i}",
            "team": "KC",
            "position": positions[i % len(positions)],
            "fair_value": 25 - i,
            "season_proj": 200 - i * 5,
            "per_game_proj": 12.0,
            "is_rookie": False,
        }
        for i in range(n)
    ]


def test_simulate_draft_and_owner_contracts(hub_db, monkeypatch):
    from src.draft_hub.draft_recap import build_owner_draft_report
    from src.draft_hub.test_draft import simulate_draft

    monkeypatch.setattr(
        "src.draft_hub.value_sheet.build_draft_pool_payload",
        lambda *a, **k: {"rows": _fake_pool_rows(12)},
    )
    out = start_mock_draft("mock-user", mode="quick_bots", bot_count=2, auto_start=True)
    league_id = out["league_id"]
    state = simulate_draft(league_id, "mock-user", max_picks=6)
    assert state["session"]["status"] == "completed"
    wins = [e for e in state["events"] if e.get("event_type") == "win"]
    assert len(wins) >= 1

    team = storage.get_team_by_user(league_id, "mock-user")
    roster = storage.list_team_roster(league_id, team["id"])
    report = build_owner_draft_report(
        league_id,
        team["id"],
        roster=roster,
        budget_remaining=float(team["budget_remaining"]),
    )
    assert report is not None
    assert report["pick_count"] == len(roster)

    if roster:
        pid = roster[0]["player_id"]
        league = storage.get_league(league_id)
        ws = storage.roster_workspace_for_league(league)
        storage.update_roster_slot(ws, pid, team_id=team["id"], contract_years=3)
        updated = storage.list_team_roster(league_id, team["id"])
        slot = next(r for r in updated if str(r["player_id"]) == str(pid))
        assert int(slot["contract_years"]) == 3
