"""Contract type persistence on roster updates."""

from __future__ import annotations

from src.draft_hub import storage
from src.draft_hub.contracts import build_contract_from_roster_edit, build_veteran_contract
from src.draft_hub.schemas import LeagueRules


def test_set_roster_contract_type_persists():
    ws = storage.get_or_create_workspace("test-user-set-type")
    ws_id = ws["id"]
    contract = build_veteran_contract(10, 2)
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "00-set-type",
            "player_name": "Type Player",
            "team": "NE",
            "position": "RB",
            "salary": 10,
            "contract_years": 2,
            "source": "manual",
            "contract": contract,
        },
    )
    slot = storage.set_roster_contract_type(ws_id, "00-set-type", "rookie", manual=True)
    assert slot["contract"]["contract_type"] == "rookie"
    assert slot["contract"]["contract_type_manual"] is True
    assert [y["salary"] for y in slot["contract"]["schedule"]] == [10, 10]
    again = storage.get_roster_slot(ws_id, "00-set-type")
    assert again["contract"]["contract_type"] == "rookie"
