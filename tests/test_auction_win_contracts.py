"""Auction awards lock 2-year terms; owner report lists drafted players only."""

from __future__ import annotations

import pytest

from src.draft_hub import storage
from src.draft_hub.contracts import build_rookie_contract
from src.draft_hub.draft_recap import build_owner_draft_report
from src.draft_hub.draft_state import award_nominee, nominate, place_bid, set_draft_contracts, start_draft
from src.draft_hub.presets import load_preset


@pytest.fixture()
def hub_db(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    return tmp_path


def _seed_league(comm_sub: str = "comm-award"):
    rules = load_preset("salary_cap_auction_v1")
    ws = storage.get_or_create_workspace(comm_sub, 2026)
    league = storage.create_league(
        comm_sub,
        "Award League",
        2026,
        rules,
        team_count=2,
        workspace_id=ws["id"],
        commissioner_team_name="Comm Team",
        test_mode=False,
    )
    comm = next(t for t in storage.list_league_teams(league["id"]) if t.get("is_commissioner"))
    return {"league": league, "comm_sub": comm_sub, "comm_team": comm, "ws_id": ws["id"], "rules": rules}


def _award(monkeypatch, seeded, player):
    start_draft(seeded["league"]["id"], seeded["comm_sub"], allow_empty=True)
    monkeypatch.setattr(
        "src.draft_hub.draft_state.resolve_nomination_player",
        lambda **kwargs: player,
    )
    nominate(seeded["league"]["id"], seeded["comm_sub"], player)
    place_bid(seeded["league"]["id"], seeded["comm_sub"], float(player.get("bid") or 12))
    return award_nominee(seeded["league"]["id"], seeded["comm_sub"])


def test_award_rookie_is_flat_two_years(hub_db, monkeypatch):
    seeded = _seed_league()
    _award(
        monkeypatch,
        seeded,
        {
            "player_id": "rook-1",
            "player_name": "Rookie WR",
            "team": "LA",
            "position": "WR",
            "is_rookie": True,
            "bid": 39,
        },
    )
    rows = storage.list_team_roster(seeded["league"]["id"], seeded["comm_team"]["id"])
    slot = next(r for r in rows if r["player_id"] == "rook-1")
    assert int(slot["contract_years"]) == 2
    contract = slot["contract"]
    assert contract["contract_type"] == "rookie"
    assert [y["salary"] for y in contract["schedule"]] == [39, 39]


def test_award_veteran_is_two_years_with_step(hub_db, monkeypatch):
    seeded = _seed_league("comm-vet")
    _award(
        monkeypatch,
        seeded,
        {
            "player_id": "vet-1",
            "player_name": "Vet RB",
            "team": "SF",
            "position": "RB",
            "is_rookie": False,
            "years_exp": 5,
            "bid": 20,
        },
    )
    rows = storage.list_team_roster(seeded["league"]["id"], seeded["comm_team"]["id"])
    slot = next(r for r in rows if r["player_id"] == "vet-1")
    assert int(slot["contract_years"]) == 2
    contract = slot["contract"]
    assert contract["contract_type"] == "veteran"
    assert [y["salary"] for y in contract["schedule"]] == [20, 25]


def test_owner_report_excludes_keepers(hub_db, monkeypatch):
    seeded = _seed_league("comm-keep")
    storage.add_roster_slot(
        seeded["ws_id"],
        {
            "player_id": "keep-1",
            "player_name": "Keeper QB",
            "team": "KC",
            "position": "QB",
            "salary": 16,
            "contract_years": 2,
            "contract": build_rookie_contract(16, 2),
            "source": "sheet",
        },
        team_id=seeded["comm_team"]["id"],
    )
    _award(
        monkeypatch,
        seeded,
        {
            "player_id": "draft-1",
            "player_name": "Drafted WR",
            "team": "DAL",
            "position": "WR",
            "is_rookie": True,
            "bid": 11,
        },
    )
    roster = storage.list_team_roster(seeded["league"]["id"], seeded["comm_team"]["id"])
    assert {r["player_id"] for r in roster} >= {"keep-1", "draft-1"}
    report = build_owner_draft_report(
        seeded["league"]["id"],
        seeded["comm_team"]["id"],
        roster=roster,
        budget_remaining=0,
    )
    assert report is not None
    assert [p["player_id"] for p in report["picks"]] == ["draft-1"]
    assert report["pick_count"] == 1
    assert report["picks"][0]["contract_type"] == "rookie"
    assert report["picks"][0]["contract_years"] == 2


def test_set_draft_contracts_rejected(hub_db):
    seeded = _seed_league("comm-lock")
    with pytest.raises(ValueError, match="automatically"):
        set_draft_contracts(
            seeded["league"]["id"],
            seeded["comm_sub"],
            [{"player_id": "x", "years": 3}],
        )
