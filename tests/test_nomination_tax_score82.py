"""SCORE-82: private nomination_tax (Need vs Tax) on live room viewer."""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.draft_state import get_room_state, start_draft
from src.draft_hub.nomination_tax import (
    build_nomination_tax,
    invalidate_nomination_tax_hint_cache,
    suggested_bid_for_row,
)
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    invalidate_nomination_tax_hint_cache()
    return tmp_path


def _tax_rules() -> LeagueRules:
    return LeagueRules(
        salary_cap=200,
        roster={
            "qb": {"min": 1, "max": 3, "starter": 1},
            "rb": {"min": 2, "max": 8, "starter": 2},
            "wr": {"min": 2, "max": 8, "starter": 2},
            "te": {"min": 1, "max": 3, "starter": 1},
        },
        roster_size_max=10,
    )


def test_suggested_bid_prefers_raav_then_fair():
    assert suggested_bid_for_row(
        {"risk_adjusted_value": 22, "fair_value": 18, "model_bid_hint": 17}
    ) == 22.0
    assert suggested_bid_for_row({"fair_value": 18, "model_bid_hint": 17}) == 18.0
    assert suggested_bid_for_row({"model_bid_hint": 9}) == 9.0
    assert suggested_bid_for_row({}) is None


def test_build_nomination_tax_picks_largest_leftover_rival():
    rules = _tax_rules()
    teams = [
        {"id": "me", "name": "My Nick", "owner_name": "Alex", "budget_remaining": 80},
        {"id": "r1", "name": "Rival A", "owner_name": "Blake", "budget_remaining": 40},
        {"id": "r2", "name": "Rival B", "owner_name": "Casey", "budget_remaining": 95},
    ]
    # Both rivals still need TE; r2 has more leftover.
    rosters = {
        "me": [],
        "r1": [
            {
                "player_id": "qb1",
                "position": "QB",
                "salary": 10,
                "contract_years": 1,
                "source": "draft",
            },
            {
                "player_id": "rb1",
                "position": "RB",
                "salary": 10,
                "contract_years": 1,
                "source": "draft",
            },
            {
                "player_id": "rb2",
                "position": "RB",
                "salary": 10,
                "contract_years": 1,
                "source": "draft",
            },
            {
                "player_id": "wr1",
                "position": "WR",
                "salary": 10,
                "contract_years": 1,
                "source": "draft",
            },
            {
                "player_id": "wr2",
                "position": "WR",
                "salary": 10,
                "contract_years": 1,
                "source": "draft",
            },
        ],
        "r2": [
            {
                "player_id": "qb2",
                "position": "QB",
                "salary": 10,
                "contract_years": 1,
                "source": "draft",
            },
            {
                "player_id": "rb3",
                "position": "RB",
                "salary": 10,
                "contract_years": 1,
                "source": "draft",
            },
            {
                "player_id": "rb4",
                "position": "RB",
                "salary": 10,
                "contract_years": 1,
                "source": "draft",
            },
            {
                "player_id": "wr3",
                "position": "WR",
                "salary": 10,
                "contract_years": 1,
                "source": "draft",
            },
            {
                "player_id": "wr4",
                "position": "WR",
                "salary": 10,
                "contract_years": 1,
                "source": "draft",
            },
        ],
    }
    pool = [
        {
            "player_id": "te-star",
            "position": "TE",
            "fair_value": 12,
            "model_bid_hint": 12,
        },
        {
            "player_id": "wr-luxury",
            "position": "WR",
            "fair_value": 40,
            "model_bid_hint": 40,
        },
    ]
    tax = build_nomination_tax(
        viewer_team_id="me",
        teams=teams,
        rosters=rosters,
        rules=rules,
        pool_rows=pool,
    )
    assert "te-star" in tax
    assert tax["te-star"]["rival_team_id"] == "r2"
    assert tax["te-star"]["rival_owner_name"] == "Casey"
    assert tax["te-star"]["rival_budget_remaining"] == 95.0
    assert tax["te-star"]["rival_hole_position"] == "TE"
    assert tax["te-star"]["suggested_bid"] == 12.0
    # Both rivals already meet WR mins — no Tax for WR luxury.
    assert "wr-luxury" not in tax


def test_build_nomination_tax_tiebreaks_on_suggested_bid():
    rules = _tax_rules()
    teams = [
        {"id": "me", "owner_name": "Alex", "budget_remaining": 50},
        {"id": "r1", "owner_name": "Blake", "budget_remaining": 60},
        {"id": "r2", "owner_name": "Casey", "budget_remaining": 60},
    ]
    empty_skill = []  # all mins unmet including TE
    rosters = {"me": [], "r1": empty_skill, "r2": empty_skill}
    pool = [{"player_id": "te1", "position": "TE", "fair_value": 8}]
    tax = build_nomination_tax(
        viewer_team_id="me",
        teams=teams,
        rosters=rosters,
        rules=rules,
        pool_rows=pool,
    )
    # Equal leftover → suggested_bid (same) then stable team_id ("r2" > "r1").
    assert tax["te1"]["rival_team_id"] == "r2"
    assert tax["te1"]["rival_owner_name"] == "Casey"
    assert tax["te1"]["rival_budget_remaining"] == 60.0


def test_build_nomination_tax_skips_broke_rivals_and_drafted():
    rules = _tax_rules()
    teams = [
        {"id": "me", "owner_name": "Alex", "budget_remaining": 50},
        {"id": "broke", "owner_name": "Dana", "budget_remaining": 0},
    ]
    rosters = {"me": [], "broke": []}
    pool = [
        {"player_id": "te1", "position": "TE", "fair_value": 5},
        {"player_id": "taken", "position": "TE", "fair_value": 20},
    ]
    tax = build_nomination_tax(
        viewer_team_id="me",
        teams=teams,
        rosters=rosters,
        rules=rules,
        pool_rows=pool,
        drafted_player_ids={"taken"},
    )
    assert tax == {}


def test_build_nomination_tax_uses_owner_name_not_only_nickname():
    rules = _tax_rules()
    teams = [
        {"id": "me", "name": "MyNick", "owner_name": "Alex", "budget_remaining": 50},
        {
            "id": "r1",
            "name": "AuraFarm",
            "owner_name": "Jordan",
            "budget_remaining": 70,
        },
    ]
    tax = build_nomination_tax(
        viewer_team_id="me",
        teams=teams,
        rosters={"me": [], "r1": []},
        rules=rules,
        pool_rows=[{"player_id": "qb1", "position": "QB", "fair_value": 15}],
    )
    assert tax["qb1"]["rival_owner_name"] == "Jordan"


def test_room_state_nomination_tax_is_private(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1")
    # Force TE min so Tax has a hole to hunt.
    rules = rules.model_copy(
        update={
            "roster": {
                **(rules.roster or {}),
                "te": {"min": 1, "max": 3, "starter": 1},
            }
        }
    )
    ws = storage.get_or_create_workspace("tax-comm")
    league = storage.create_league(
        "tax-comm", "Tax League", 2026, rules, workspace_id=ws["id"], team_count=2
    )
    storage.join_league("tax-member", league["room_code"], "Member Seat")
    # Seed owner labels via team names already set; attach may leave owner unset —
    # set budget leftovers explicitly.
    teams = storage.list_league_teams(league["id"])
    assert len(teams) == 2
    for team in teams:
        storage.update_team_budget(team["id"], 100.0)

    pool_rows = [
        {
            "player_id": "te-tax",
            "player": "Tax TE",
            "position": "TE",
            "fair_value": 11,
            "model_bid_hint": 11,
        }
    ]
    monkeypatch.setattr(
        "src.draft_hub.nomination_tax.load_nomination_tax_pool_rows",
        lambda *a, **k: pool_rows,
    )

    start_draft(league["id"], "tax-comm", allow_empty=True)

    member_state = get_room_state(league["id"], "tax-member")
    shared = get_room_state(league["id"])

    assert "viewer" in member_state
    tax = member_state["viewer"].get("nomination_tax") or {}
    assert "te-tax" in tax
    assert tax["te-tax"]["rival_hole_position"] == "TE"
    assert tax["te-tax"]["rival_budget_remaining"] >= 1
    assert tax["te-tax"]["rival_owner_name"]
    assert tax["te-tax"]["rival_team_id"] != member_state["viewer"]["team_id"]

    assert "viewer" not in shared
    assert all("nomination_tax" not in team for team in member_state["teams"])
    assert all("nomination_tax" not in team for team in shared["teams"])


def test_room_state_nomination_tax_empty_on_pick_draft(hub_db, monkeypatch):
    rules = load_preset("salary_cap_auction_v1").model_copy(update={"draft_type": "snake"})
    ws = storage.get_or_create_workspace("snake-comm")
    league = storage.create_league(
        "snake-comm", "Snake", 2026, rules, workspace_id=ws["id"]
    )
    monkeypatch.setattr(
        "src.draft_hub.nomination_tax.load_nomination_tax_pool_rows",
        lambda *a, **k: [{"player_id": "x", "position": "TE", "fair_value": 5}],
    )
    from src.draft_hub.pick_draft import is_pick_draft

    stored = LeagueRules.model_validate(storage.get_league(league["id"])["rules"])
    assert is_pick_draft(stored)
    state = get_room_state(league["id"], "snake-comm")
    assert state["viewer"].get("nomination_tax") == {}
