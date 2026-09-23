"""Server-side hourly Sleeper roster reconciliation."""

from __future__ import annotations

import asyncio

from app import sleeper_sync_ticker
from src.draft_hub import cap_sheet_import, league_sleeper_sync, storage
from src.draft_hub.league_sleeper_sync import merge_sleeper_team_roster
from src.draft_hub.presets import load_preset
from src.draft_hub.sleeper_sync_mode import set_sleeper_sync_mode


def _linked_league(sub: str, sleeper_id: str, *, test_mode: bool = False) -> dict:
    league = storage.create_league(
        sub,
        f"League {sub}",
        2026,
        load_preset("salary_cap_auction_v1"),
        test_mode=test_mode,
    )
    storage.update_league_sleeper_id(league["id"], sleeper_id)
    return league


def test_live_sleeper_league_query_skips_paused_unlinked_and_test(hub_db):
    live = _linked_league("hourly-live", "sl-live")
    paused = _linked_league("hourly-paused", "sl-paused")
    _linked_league("hourly-test", "sl-test", test_mode=True)
    storage.create_league(
        "hourly-unlinked",
        "Unlinked",
        2026,
        load_preset("salary_cap_auction_v1"),
    )
    set_sleeper_sync_mode(paused["id"], "off")

    assert storage.list_live_sleeper_league_ids() == [live["id"]]


def test_hourly_runner_isolates_failures_and_clears_successful_cache(hub_db, monkeypatch):
    first = _linked_league("hourly-first", "sl-first")
    second = _linked_league("hourly-second", "sl-second")
    cleared: list[str] = []

    def fake_sync(league_id, _parsed, _manager_map):
        if league_id == first["id"]:
            raise RuntimeError("Sleeper unavailable")
        return {
            "sleeper": {
                "teams_synced": 10,
                "trade_count": 1,
                "merge": {"added": 2, "updated": 17},
            },
            "waived": {"waived": 3},
        }

    monkeypatch.setattr(
        "src.draft_hub.cap_sheet_import.sync_league_rosters_and_contracts", fake_sync
    )
    monkeypatch.setattr("app.hub_routes._clear_league_rosters_cache", cleared.append)
    monkeypatch.setattr("app.hub_routes._clear_insights_response_cache", cleared.append)

    result = sleeper_sync_ticker.sync_all_live_sleeper_leagues()

    assert result["synced"] == 1
    assert result["failed"] == 1
    assert result["leagues"] == [
        {
            "league_id": second["id"],
            "teams_synced": 10,
            "trades_applied": 1,
            "added": 2,
            "updated": 17,
            "waived": 3,
        }
    ]
    assert cleared == [second["id"], second["id"]]


def test_ticker_disabled_in_tests(monkeypatch):
    monkeypatch.setenv("TESTING", "1")
    asyncio.run(sleeper_sync_ticker.sleeper_sync_ticker_loop())


def test_readded_waived_player_gets_fresh_active_contract(hub_db):
    league = _linked_league("hourly-readd", "sl-readd")
    team = storage.get_team_by_user(league["id"], "hourly-readd")
    ws_id = str(league["workspace_id"])
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "sleeper-42",
            "player_name": "Claimed Again",
            "team": "SEA",
            "position": "WR",
            "salary": 19,
            "contract_years": 3,
            "sleeper_player_id": "42",
            "source": "cap_sheet",
            "roster_status": "waived",
        },
        team_id=team["id"],
    )

    result = merge_sleeper_team_roster(
        ws_id,
        team["id"],
        [
            {
                "player_id": "sleeper-42",
                "player_name": "Claimed Again",
                "team": "SEA",
                "position": "WR",
                "sleeper_player_id": "42",
                "years_exp": 4,
            }
        ],
        season=2026,
        draft_completed=True,
    )

    assert result == {"added": 1, "updated": 0}
    rows = storage.list_roster_slots_for_player(ws_id, "sleeper-42")
    active = next(row for row in rows if row["roster_status"] == "active")
    waived = next(row for row in rows if row["roster_status"] == "waived")
    assert active["salary"] == 1
    assert active["contract_years"] == 1
    assert waived["salary"] == 19
    assert waived["contract_years"] == 3


def test_missing_sleeper_player_becomes_waived_history(hub_db, monkeypatch):
    league = _linked_league("hourly-drop", "sl-drop")
    team = storage.get_team_by_user(league["id"], "hourly-drop")
    ws_id = str(league["workspace_id"])
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "sleeper-1",
            "player_name": "Dropped Player",
            "team": "BUF",
            "position": "RB",
            "salary": 12,
            "contract_years": 2,
            "sleeper_player_id": "1",
            "source": "cap_sheet",
        },
        team_id=team["id"],
    )
    monkeypatch.setattr(
        league_sleeper_sync,
        "fetch_all_linked_rosters",
        lambda _league_id: {
            "1": {
                "players": [
                    {
                        "player_id": "sleeper-2",
                        "player_name": "Still Rostered",
                        "team": "KC",
                        "position": "WR",
                    }
                ]
            }
        },
    )

    result = cap_sheet_import.mark_waived_not_on_sleeper(league["id"])

    assert result == {"waived": 1, "live_sleeper_players": 1}
    dropped = storage.get_roster_slot(ws_id, "sleeper-1", prefer_occupying=False)
    assert dropped["roster_status"] == "waived"
    assert dropped["salary"] == 12
    assert dropped["contract_years"] == 2


def test_empty_sleeper_response_never_mass_waives(hub_db, monkeypatch):
    league = _linked_league("hourly-empty", "sl-empty")
    team = storage.get_team_by_user(league["id"], "hourly-empty")
    ws_id = str(league["workspace_id"])
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "sleeper-3",
            "player_name": "Keep Player",
            "team": "DET",
            "position": "WR",
            "salary": 8,
            "contract_years": 2,
            "sleeper_player_id": "3",
            "source": "cap_sheet",
        },
        team_id=team["id"],
    )
    monkeypatch.setattr(
        league_sleeper_sync,
        "fetch_all_linked_rosters",
        lambda _league_id: {"1": {"players": []}},
    )

    result = cap_sheet_import.mark_waived_not_on_sleeper(league["id"])

    assert result == {"waived": 0, "skipped": "empty_sleeper_rosters"}
    active = storage.get_roster_slot(ws_id, "sleeper-3")
    assert active["roster_status"] == "active"
