"""Historic dynasty insights from contract sheets."""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.historic_insights import (
    build_contract_analytics,
    build_contract_player_profiles,
    enrich_ownership_with_contracts,
    list_history_seasons,
)
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def league_with_contracts(hub_db):
    league = storage.create_league("hist", "Historic", 2025, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season(
        lid,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "hub_team_name": "Thanks noob noob",
                "player_name": "P. Mahomes",
                "position": "QB",
                "cap_hit": 17,
                "roster_status": "active",
            },
            {
                "owner_label": "Caleb K",
                "hub_team_name": "White Supremacists",
                "player_name": "B. Hall",
                "position": "RB",
                "cap_hit": 27,
                "roster_status": "active",
            },
        ],
    )
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Caleb K",
                "hub_team_name": "White Supremacists",
                "player_name": "B. Hall",
                "position": "RB",
                "cap_hit": 32,
                "roster_status": "active",
            },
            {
                "owner_label": "Aaron D",
                "hub_team_name": "Thanks noob noob",
                "player_name": "P. Mahomes",
                "position": "QB",
                "cap_hit": 20,
                "roster_status": "active",
            },
        ],
    )
    return lid


def test_list_history_seasons(league_with_contracts):
    seasons = list_history_seasons(league_with_contracts)
    assert seasons == [2025, 2024]


def test_build_contract_analytics_season(league_with_contracts):
    out = build_contract_analytics(league_with_contracts, season_year=2024)
    assert out is not None
    assert out["mode"] == "season"
    teams = {t["team_name"]: t for t in out["teams"]}
    assert teams["Thanks noob noob"]["committed"] == 17
    assert teams["White Supremacists"]["committed"] == 27


def test_build_contract_player_profiles_all_time(league_with_contracts):
    profiles = build_contract_player_profiles(league_with_contracts)
    hall = next(p for p in profiles if "Hall" in p["player_name"])
    assert hall["team_count"] == 1
    assert hall["season_count"] == 2
    assert hall["avg_cap"] == 29.5


def test_enrich_ownership_adds_contract_stats(league_with_contracts):
    ownership = {"players": [], "player_count": 0}
    out = enrich_ownership_with_contracts(ownership, league_with_contracts)
    assert out["has_contract_history"]
    assert out["player_count"] >= 2
    hall = next(p for p in out["players"] if "Hall" in p["player_name"])
    assert hall["contract_stats"]["avg_cap"] == 29.5
    assert any(ev.get("event_type") == "contract" for ev in hall["timeline"])


def test_build_contract_awards_season(league_with_contracts):
    from src.draft_hub.historic_insights import build_contract_awards

    awards = build_contract_awards(league_with_contracts, season_year=2024)
    ids = {a["id"] for a in awards}
    assert "highest_paid" in ids
    assert "most_overpaid" in ids
    highest = next(a for a in awards if a["id"] == "highest_paid")
    assert highest["amount"] == 27
