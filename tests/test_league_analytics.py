"""League spend analytics tests."""

import pytest

from src.draft_hub import storage
from src.draft_hub.league_analytics import build_league_analytics
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _overview(hub_db):
    comm = "analytics-comm"
    member = "analytics-member"
    ws = storage.get_or_create_workspace(comm)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(comm, "Analytics League", 2025, rules, workspace_id=ws["id"], team_count=10)
    team_a = storage.get_team_by_user(league["id"], comm)
    team_b = storage.join_league(member, league["room_code"], "Team B")
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "p-qb", "player_name": "QB1", "team": "KC", "position": "QB", "salary": 30, "contract_years": 1},
        team_id=team_a["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "p-wr", "player_name": "WR1", "team": "SEA", "position": "WR", "salary": 40, "contract_years": 1},
        team_id=team_a["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {"player_id": "p-rb", "player_name": "RB1", "team": "SF", "position": "RB", "salary": 35, "contract_years": 1},
        team_id=team_b["id"],
    )
    return storage.league_roster_overview(league["id"])


def test_spend_pct_sums_within_cap(hub_db):
    overview = _overview(hub_db)
    analytics = build_league_analytics(overview, draft_completed=True)
    cap = analytics["salary_cap"]
    for team in analytics["teams"]:
        pct_sum = sum(team["pct_by_position"].values()) + team["pct_unspent"]
        assert pct_sum <= 100.1
        assert team["committed"] <= cap + 0.01


def test_position_totals_match_roster(hub_db):
    overview = _overview(hub_db)
    analytics = build_league_analytics(overview, draft_completed=True)
    team_a = next(t for t in analytics["teams"] if t["team_name"] != "Team B")
    assert team_a["spend_by_position"]["QB"] == 30
    assert team_a["spend_by_position"]["WR"] == 40
    assert team_a["count_by_position"]["QB"] == 1
    assert team_a["count_by_position"]["WR"] == 1
