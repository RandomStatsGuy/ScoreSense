"""Sleeper sync must not create a second occupying row for the same person."""

from src.draft_hub import storage
from src.draft_hub.league_sleeper_sync import (
    collapse_duplicate_occupying_players,
    detect_and_apply_sleeper_trades,
    merge_sleeper_team_roster,
)
from src.draft_hub.presets import load_preset


def _seed_league(sub="id-comm"):
    ws = storage.get_or_create_workspace(sub)
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(sub, "Identity League", 2026, rules, workspace_id=ws["id"])
    team = storage.get_team_by_user(league["id"], sub)
    return ws, league, team


def test_merge_matches_sleeper_fallback_id_to_gsis_row(hub_db):
    ws, _league, team = _seed_league("merge-gsis")
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0036389",
            "player_name": "Jalen Hurts",
            "team": "PHI",
            "position": "QB",
            "salary": 17,
            "contract_years": 2,
            "source": "sheet",
        },
        team_id=team["id"],
    )
    stats = merge_sleeper_team_roster(
        ws["id"],
        team["id"],
        [
            {
                "player_id": "sleeper-4017",
                "player_name": "Jalen Hurts",
                "team": "PHI",
                "position": "QB",
                "sleeper_player_id": "4017",
            }
        ],
    )
    assert stats["added"] == 0
    assert stats["updated"] == 1
    roster = storage.list_roster(ws["id"], team["id"])
    occupying = [r for r in roster if storage.roster_row_occupies(r)]
    assert len(occupying) == 1
    assert occupying[0]["player_id"] == "00-0036389"
    assert occupying[0]["sleeper_player_id"] == "4017"
    assert float(occupying[0]["salary"]) == 17.0


def test_merge_matches_by_name_and_position(hub_db):
    ws, _league, team = _seed_league("merge-name")
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "kelce-sheet",
            "player_name": "Travis Kelce",
            "team": "KC",
            "position": "TE",
            "salary": 16,
            "contract_years": 2,
            "source": "sheet",
        },
        team_id=team["id"],
    )
    stats = merge_sleeper_team_roster(
        ws["id"],
        team["id"],
        [
            {
                "player_id": "00-0030506",
                "player_name": "Travis Kelce",
                "team": "KC",
                "position": "TE",
                "sleeper_player_id": "1476",
            }
        ],
    )
    assert stats["added"] == 0
    roster = [r for r in storage.list_roster(ws["id"], team["id"]) if storage.roster_row_occupies(r)]
    assert len(roster) == 1
    assert float(roster[0]["salary"]) == 16.0
    assert roster[0]["sleeper_player_id"] == "1476"


def test_collapse_keeps_live_staff_row(hub_db):
    ws, _league, team = _seed_league("collapse-dup")
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0036389",
            "player_name": "Jalen Hurts",
            "team": "PHI",
            "position": "QB",
            "salary": 17,
            "contract_years": 0,
            "source": "sheet",
            "contract": {"years_remaining": 0, "current_salary": 17},
        },
        team_id=team["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "sleeper-4017",
            "player_name": "Jalen Hurts",
            "team": "PHI",
            "position": "QB",
            "salary": 9,
            "contract_years": 2,
            "sleeper_player_id": "4017",
            "source": "sleeper",
        },
        team_id=team["id"],
    )
    result = collapse_duplicate_occupying_players(ws["id"])
    assert result["removed"] == 1
    roster = [r for r in storage.list_roster(ws["id"], team["id"]) if storage.roster_row_occupies(r)]
    assert len(roster) == 1
    assert roster[0]["player_id"] == "sleeper-4017"
    assert int(roster[0]["contract_years"]) == 2


def test_trade_moves_sheet_row_when_sleeper_id_differs(hub_db):
    ws, league, team_a = _seed_league("trade-id")
    member = "trade-id-member"
    team_b = storage.join_league(member, league["room_code"], "Other")
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0035640",
            "player_name": "DK Metcalf",
            "team": "SEA",
            "position": "WR",
            "salary": 45,
            "contract_years": 2,
            "source": "sheet",
        },
        team_id=team_a["id"],
    )
    moves = detect_and_apply_sleeper_trades(
        ws["id"],
        {
            str(team_a["id"]): [],
            str(team_b["id"]): [
                {
                    "player_id": "sleeper-5846",
                    "player_name": "DK Metcalf",
                    "team": "SEA",
                    "position": "WR",
                    "sleeper_player_id": "5846",
                }
            ],
        },
    )
    assert len(moves) == 1
    slot = storage.get_roster_slot(ws["id"], "00-0035640")
    assert slot["team_id"] == team_b["id"]
    assert float(slot["salary"]) == 45.0


def test_drop_expired_row_by_slot_id(hub_db):
    ws, _league, team = _seed_league("drop-expired")
    row = storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0030506",
            "player_name": "Travis Kelce",
            "team": "KC",
            "position": "TE",
            "salary": 16,
            "contract_years": 0,
            "roster_status": "expired",
            "source": "sheet",
            "contract": {"years_remaining": 0, "current_salary": 16},
        },
        team_id=team["id"],
    )
    ok = storage.remove_roster_slot(
        ws["id"],
        "00-0030506",
        slot_id=int(row["id"]),
        occupying_only=False,
    )
    assert ok is True
    assert storage.get_roster_slot_by_id(int(row["id"]), workspace_id=ws["id"]) is None


def test_drop_player_id_path_removes_leftover_when_no_occupying(hub_db):
    ws, _league, team = _seed_league("drop-leftover")
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "ghost-hurts",
            "player_name": "Jalen Hurts",
            "team": "PHI",
            "position": "QB",
            "salary": 17,
            "contract_years": 0,
            "roster_status": "expired",
            "source": "sheet",
        },
        team_id=team["id"],
    )
    assert storage.remove_roster_slot(ws["id"], "ghost-hurts", occupying_only=True) is True
    assert storage.get_roster_slot(ws["id"], "ghost-hurts") is None


def test_hub_delete_expired_duplicate_by_slot(hub_db):
    from fastapi.testclient import TestClient

    from app.api import app
    from app.auth import require_hub_user

    ws, _league, team = _seed_league("api-drop")
    ghost = storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "ghost-kelce",
            "player_name": "Travis Kelce",
            "team": "KC",
            "position": "TE",
            "salary": 16,
            "contract_years": 0,
            "roster_status": "expired",
            "source": "sheet",
        },
        team_id=team["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0030506",
            "player_name": "Travis Kelce",
            "team": "KC",
            "position": "TE",
            "salary": 3,
            "contract_years": 2,
            "sleeper_player_id": "1476",
            "source": "sleeper",
        },
        team_id=team["id"],
    )
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "api-drop", "auth_type": "dev"}
    client = TestClient(app)
    try:
        res = client.request(
            "DELETE",
            "/api/hub/roster",
            json={"player_id": "ghost-kelce", "roster_slot_id": int(ghost["id"])},
        )
        assert res.status_code == 200, res.text
        assert storage.get_roster_slot(ws["id"], "ghost-kelce") is None
        live = storage.get_roster_slot(ws["id"], "00-0030506")
        assert live is not None
        assert float(live["salary"]) == 3.0
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_missing_slot_id_does_not_fall_back_to_player_id(hub_db):
    from fastapi.testclient import TestClient

    from app.api import app
    from app.auth import require_hub_user

    ws, _league, team = _seed_league("no-slot-fallback")
    sheet = storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0036389",
            "player_name": "Jalen Hurts",
            "team": "PHI",
            "position": "QB",
            "salary": 17,
            "contract_years": 0,
            "source": "sheet",
        },
        team_id=team["id"],
    )
    storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "sleeper-4017",
            "player_name": "Jalen Hurts",
            "team": "PHI",
            "position": "QB",
            "salary": 9,
            "contract_years": 2,
            "source": "sleeper",
        },
        team_id=team["id"],
    )
    missing_id = int(sheet["id"]) + 999
    app.dependency_overrides[require_hub_user] = lambda: {
        "sub": "no-slot-fallback",
        "auth_type": "dev",
    }
    client = TestClient(app)
    try:
        dropped = client.request(
            "DELETE",
            "/api/hub/roster",
            json={"player_id": "00-0036389", "roster_slot_id": missing_id},
        )
        assert dropped.status_code == 404, dropped.text
        patched = client.patch(
            "/api/hub/roster",
            json={"player_id": "00-0036389", "roster_slot_id": missing_id, "salary": 1},
        )
        assert patched.status_code == 404, patched.text
        assert storage.get_roster_slot(ws["id"], "00-0036389") is not None
        assert storage.get_roster_slot(ws["id"], "sleeper-4017") is not None
        assert float(storage.get_roster_slot(ws["id"], "00-0036389")["salary"]) == 17.0
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_remove_roster_slot_refuses_mismatched_player_or_team(hub_db):
    ws, _league, team = _seed_league("slot-mismatch")
    row = storage.add_roster_slot(
        ws["id"],
        {
            "player_id": "00-0036389",
            "player_name": "Jalen Hurts",
            "team": "PHI",
            "position": "QB",
            "salary": 9,
            "contract_years": 2,
            "source": "sheet",
        },
        team_id=team["id"],
    )
    slot_id = int(row["id"])
    assert storage.remove_roster_slot(ws["id"], "sleeper-4017", slot_id=slot_id) is False
    assert storage.remove_roster_slot(
        ws["id"],
        "00-0036389",
        slot_id=slot_id,
        team_id="other-team",
    ) is False
    assert storage.get_roster_slot_by_id(slot_id, workspace_id=ws["id"]) is not None
    assert storage.remove_roster_slot(
        ws["id"],
        "00-0036389",
        slot_id=slot_id,
        team_id=team["id"],
    ) is True
    assert storage.get_roster_slot_by_id(slot_id, workspace_id=ws["id"]) is None


def test_group_duplicate_occupying_keeps_rows_without_ids():
    from src.draft_hub.roster_identity_match import group_duplicate_occupying

    groups = group_duplicate_occupying(
        [
            {
                "id": None,
                "player_id": "00-0036389",
                "player_name": "Jalen Hurts",
                "position": "QB",
                "team_id": "t1",
                "contract_years": 2,
                "roster_status": "active",
            },
            {
                "id": None,
                "player_id": "sleeper-4017",
                "player_name": "Jalen Hurts",
                "position": "QB",
                "team_id": "t1",
                "contract_years": 0,
                "roster_status": "active",
            },
            {
                "id": 7,
                "player_id": "00-0030506",
                "player_name": "Travis Kelce",
                "position": "TE",
                "team_id": "t1",
                "contract_years": 2,
                "roster_status": "active",
            },
        ]
    )
    assert len(groups) == 1
    assert {row["player_id"] for row in groups[0]} == {"00-0036389", "sleeper-4017"}
