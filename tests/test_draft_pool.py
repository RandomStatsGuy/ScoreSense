"""Draft pool and position cap tests."""

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_pool import filter_nomination_rows, normalize_pool_mode
from src.draft_hub.draft_state import nominate, place_bid
from src.draft_hub.presets import load_preset
from src.draft_hub.rules_engine import assert_can_acquire, roster_capacity
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def test_normalize_pool_mode():
    assert normalize_pool_mode("roster_plus_rookies") == "roster_plus_rookies"
    assert normalize_pool_mode("full") == "full"
    assert normalize_pool_mode(None) == "full"


def test_roster_capacity_at_max(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    roster = [
        {"player_id": f"w{i}", "position": "WR", "salary": 1}
        for i in range(rules.roster["wr"]["max"])
    ]
    cap = roster_capacity(rules, roster)
    assert cap["by_position"]["WR"]["at_max"] is True
    with pytest.raises(ValueError, match="WR maximum"):
        assert_can_acquire(rules, roster, "WR")


def test_roster_plus_rookies_pool_filters():
    rows = [
        {"player_id": "mine-qb", "player": "My QB", "position": "QB", "is_rookie": False},
        {"player_id": "other-rb", "player": "Other RB", "position": "RB", "is_rookie": False},
        {"player_id": "rookie-wr", "player": "Rookie WR", "position": "WR", "is_rookie": True},
    ]
    hub_ids = {"mine-qb"}

    full = filter_nomination_rows(rows, pool_mode="full", hub_player_ids=hub_ids, drafted_player_ids=set())
    assert len(full) == 3

    restricted = filter_nomination_rows(
        rows,
        pool_mode="roster_plus_rookies",
        hub_player_ids=hub_ids,
        drafted_player_ids=set(),
    )
    assert {r["player_id"] for r in restricted} == {"mine-qb", "rookie-wr"}


def test_nominate_blocked_at_position_max(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("cap-user")
    league = storage.create_league("cap-user", "Cap League", 2025, rules, workspace_id=ws["id"])
    teams = storage.list_league_teams(league["id"])
    team_id = teams[0]["id"]

    for i in range(rules.roster["wr"]["max"]):
        storage.add_roster_slot(
            ws["id"],
            {
                "player_id": f"wr-{i}",
                "player_name": f"WR {i}",
                "team": "NYG",
                "position": "WR",
                "salary": 5,
                "contract_years": 1,
            },
            team_id=team_id,
        )

    monkeypatch.setattr(
        "src.draft_hub.draft_state.assert_player_nomination_eligible",
        lambda **kwargs: None,
    )
    storage.update_draft_session(league["id"], status="nominating")

    with pytest.raises(ValueError, match="WR maximum"):
        nominate(
            league["id"],
            "cap-user",
            {
                "player_id": "new-wr",
                "player_name": "New WR",
                "team": "DAL",
                "position": "WR",
            },
        )


def test_bid_blocked_at_position_max(hub_db):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace("bid-cap-user")
    league = storage.create_league("bid-cap-user", "Bid Cap", 2025, rules, workspace_id=ws["id"])
    teams = storage.list_league_teams(league["id"])
    human = teams[0]
    bot_id = "bot-team-1"
    storage.add_bot_team(league["id"], bot_id, "Bot", rules.salary_cap)

    for i in range(rules.roster["wr"]["max"]):
        storage.add_roster_slot(
            ws["id"],
            {
                "player_id": f"wr-{i}",
                "player_name": f"WR {i}",
                "team": "NYG",
                "position": "WR",
                "salary": 5,
                "contract_years": 1,
            },
            team_id=human["id"],
        )

    storage.update_league_status(league["id"], "live")
    storage.update_draft_session(
        league["id"],
        status="bidding",
        current_nominee_json='{"player_id":"new-wr","player_name":"New WR","team":"DAL","position":"WR","nominating_team_id":"x"}',
        high_bid=1,
        high_bidder_team_id=bot_id,
    )

    with pytest.raises(ValueError, match="WR maximum"):
        place_bid(league["id"], "bid-cap-user", 2)
