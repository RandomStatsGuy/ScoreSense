"""Pausing Sleeper roster sync keeps a league's rosters exactly as they are.

Every Sleeper-driven write path either refuses (SleeperSyncPaused, a 400 at the
route) or skips on a paused league. The fingerprint covers roster rows, stored
team membership, and the league link, so any write shows up as a diff.
"""

from __future__ import annotations

import json

import pytest

from src.draft_hub import cap_sheet_import, league_sleeper_sync, sleeper_link, storage
from src.draft_hub.hub_context import list_roster_for_context, resolve_hub_context_for_league
from src.draft_hub.in_season_contract_projection import materialize_sleeper_moves
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.sleeper_sync_mode import (
    PAUSED_MESSAGE,
    SLEEPER_SYNC_LIVE,
    SLEEPER_SYNC_OFF,
    SleeperSyncPaused,
    set_sleeper_sync_mode,
    sleeper_sync_state,
)
from src.draft_hub.weekly_command_center import _sync_metadata

SLEEPER_LEAGUE = "1257419072740644612"


def _seed(sub: str = "pause-comm") -> dict:
    """Two linked teams; team A holds a $40 cap-sheet contract and a $1 Sleeper pickup."""
    rules = load_preset("salary_cap_auction_v1")
    league = storage.create_league(sub, "Pause League", 2026, rules, team_count=2)
    storage.update_league_sleeper_id(league["id"], SLEEPER_LEAGUE)
    team_a = storage.get_team_by_user(league["id"], sub)
    team_b = storage.get_or_create_league_team_by_name(league["id"], "Team B", 200.0)
    storage.update_team_sleeper_link(str(team_a["id"]), sleeper_roster_id="1", sleeper_team_name="Team A")
    storage.update_team_sleeper_link(str(team_b["id"]), sleeper_roster_id="2", sleeper_team_name="Team B")
    ws_id = str(league["workspace_id"])
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "00-0036389",
            "player_name": "Jalen Hurts",
            "team": "PHI",
            "position": "QB",
            "salary": 40,
            "contract_years": 2,
            "sleeper_player_id": "4017",
            "source": "cap_sheet",
        },
        team_id=str(team_a["id"]),
    )
    storage.add_roster_slot(
        ws_id,
        {
            "player_id": "sleeper-9001",
            "player_name": "Waiver Guy",
            "team": "NYJ",
            "position": "WR",
            "salary": 1,
            "contract_years": 1,
            "sleeper_player_id": "9001",
            "source": "sleeper",
        },
        team_id=str(team_a["id"]),
    )
    storage.update_team_sleeper_link(
        str(team_a["id"]),
        sleeper_player_ids=["00-0036389", "sleeper-9001"],
    )
    return {
        "sub": sub,
        "league": storage.get_league(league["id"]),
        "ws_id": ws_id,
        "team_a": str(team_a["id"]),
        "team_b": str(team_b["id"]),
    }


def _sleeper_snapshots() -> dict[str, dict]:
    """Sleeper now says: Hurts is on team B, Waiver Guy is gone, a new pickup is on team A."""
    team_a_players = [
        {
            "player_id": "sleeper-7777",
            "player_name": "New Pickup",
            "team": "DAL",
            "position": "RB",
            "sleeper_player_id": "7777",
            "years_exp": 3,
        }
    ]
    team_b_players = [
        {
            "player_id": "00-0036389",
            "player_name": "Jalen Hurts",
            "team": "PHI",
            "position": "QB",
            "sleeper_player_id": "4017",
            "years_exp": 6,
        }
    ]
    return {
        "1": {"team_name": "Team A", "players": team_a_players, "player_ids": ["sleeper-7777"]},
        "2": {"team_name": "Team B", "players": team_b_players, "player_ids": ["00-0036389"]},
    }


class _FakeSleeper:
    def __init__(self, monkeypatch):
        self.calls = 0
        snaps = _sleeper_snapshots()

        def all_rosters(_league_id):
            self.calls += 1
            return snaps

        def one_roster(_league_id, roster_id):
            self.calls += 1
            return snaps[str(roster_id)]

        def teams(_league_id):
            self.calls += 1
            return {
                "league_name": "Pause League",
                "teams": [
                    {"roster_id": "1", "team_name": "Team A"},
                    {"roster_id": "2", "team_name": "Team B"},
                ],
            }

        for mod in (league_sleeper_sync, sleeper_link):
            if hasattr(mod, "fetch_linked_roster"):
                monkeypatch.setattr(mod, "fetch_linked_roster", one_roster)
            if hasattr(mod, "list_league_teams"):
                monkeypatch.setattr(mod, "list_league_teams", teams)
        monkeypatch.setattr(league_sleeper_sync, "fetch_all_linked_rosters", all_rosters)


def _fingerprint(seed: dict) -> str:
    with storage.get_conn() as conn:
        slots = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM roster_slot WHERE workspace_id = ? ORDER BY id",
                (seed["ws_id"],),
            ).fetchall()
        ]
        teams = [
            dict(r)
            for r in conn.execute(
                "SELECT id, sleeper_roster_id, sleeper_player_ids_json, sleeper_synced_at "
                "FROM team WHERE league_id = ? ORDER BY id",
                (seed["league"]["id"],),
            ).fetchall()
        ]
        league = dict(
            conn.execute(
                "SELECT sleeper_league_id, sleeper_hosting_disabled, live_roster_revision "
                "FROM league WHERE id = ?",
                (seed["league"]["id"],),
            ).fetchone()
        )
    return json.dumps({"slots": slots, "teams": teams, "league": league}, sort_keys=True, default=str)


def test_new_league_defaults_to_live(hub_db):
    seed = _seed("pause-default")
    assert seed["league"]["sleeper_sync_mode"] is None
    assert sleeper_sync_state(seed["league"]) == {"mode": SLEEPER_SYNC_LIVE, "paused": False}


def test_set_mode_round_trip_and_rejects_unknown(hub_db):
    seed = _seed("pause-roundtrip")
    lid = seed["league"]["id"]
    assert set_sleeper_sync_mode(lid, "off") == {"mode": SLEEPER_SYNC_OFF, "paused": True}
    assert storage.get_league(lid)["sleeper_sync_mode"] == SLEEPER_SYNC_OFF
    assert set_sleeper_sync_mode(lid, "live") == {"mode": SLEEPER_SYNC_LIVE, "paused": False}
    with pytest.raises(ValueError):
        set_sleeper_sync_mode(lid, "review")


def test_migration_pauses_only_existing_sleeper_contract_leagues(hub_db):
    auction = storage.create_league("mig-a", "Linked auction", 2026, load_preset("salary_cap_auction_v1"))
    snake = storage.create_league("mig-b", "Linked snake", 2026, LeagueRules(draft_type="snake"))
    unlinked = storage.create_league("mig-c", "Unlinked auction", 2026, load_preset("salary_cap_auction_v1"))
    storage.update_league_sleeper_id(auction["id"], SLEEPER_LEAGUE)
    storage.update_league_sleeper_id(snake["id"], SLEEPER_LEAGUE)

    # Rewind the database to before this change, then boot again.
    with storage.get_conn() as conn:
        conn.execute("ALTER TABLE league DROP COLUMN sleeper_sync_mode")
    storage._DB_INITIALIZED = False

    assert storage.get_league(auction["id"])["sleeper_sync_mode"] == SLEEPER_SYNC_OFF
    assert storage.get_league(snake["id"])["sleeper_sync_mode"] is None
    assert storage.get_league(unlinked["id"])["sleeper_sync_mode"] is None

    # A commissioner turns sync back on; a restart must not pause it again.
    set_sleeper_sync_mode(auction["id"], "live")
    storage._DB_INITIALIZED = False
    assert storage.get_league(auction["id"])["sleeper_sync_mode"] == SLEEPER_SYNC_LIVE


def test_live_league_sync_would_change_rosters(hub_db, monkeypatch):
    """Control: the same Sleeper data rewrites a live league, so the pause test is meaningful."""
    seed = _seed("pause-control")
    _FakeSleeper(monkeypatch)
    before = _fingerprint(seed)

    moves = league_sleeper_sync.detect_and_apply_sleeper_trades(
        seed["ws_id"],
        {seed["team_b"]: _sleeper_snapshots()["2"]["players"]},
    )

    assert [m["player_name"] for m in moves] == ["Jalen Hurts"]
    assert _fingerprint(seed) != before


def test_paused_league_refuses_every_sleeper_roster_write(hub_db, monkeypatch):
    seed = _seed("pause-writes")
    lid = seed["league"]["id"]
    set_sleeper_sync_mode(lid, "off")
    fake = _FakeSleeper(monkeypatch)
    before = _fingerprint(seed)
    players_b = _sleeper_snapshots()["2"]["players"]

    refusing = [
        lambda: league_sleeper_sync.ensure_sleeper_team_links(lid),
        lambda: league_sleeper_sync.sync_league_from_sleeper(lid),
        lambda: league_sleeper_sync.sync_team_sleeper_to_league(lid, seed["team_a"]),
        lambda: league_sleeper_sync.connect_sleeper_league(lid, SLEEPER_LEAGUE),
        lambda: league_sleeper_sync.merge_sleeper_team_roster(seed["ws_id"], seed["team_b"], players_b),
        lambda: league_sleeper_sync.detect_and_apply_sleeper_trades(seed["ws_id"], {seed["team_b"]: players_b}),
        lambda: league_sleeper_sync.collapse_duplicate_occupying_players(seed["ws_id"]),
        lambda: league_sleeper_sync.disconnect_sleeper_league(lid, clear_sleeper_roster=True),
        lambda: cap_sheet_import.sync_league_rosters_and_contracts(lid, None, None),
        lambda: materialize_sleeper_moves(lid, 2026),
    ]
    for call in refusing:
        with pytest.raises(SleeperSyncPaused):
            call()
    # Refusals happen before any Sleeper request.
    assert fake.calls == 0

    assert league_sleeper_sync.reattach_league_roster_slots(lid)["reattached"] == 0
    assert league_sleeper_sync.reconcile_league_roster_assignments(lid)["skipped"] == "sleeper_sync_paused"
    assert cap_sheet_import.mark_waived_not_on_sleeper(lid)["skipped"] == "sleeper_sync_paused"

    assert _fingerprint(seed) == before


def test_paused_league_keeps_stored_team_membership(hub_db, monkeypatch):
    seed = _seed("pause-membership")
    lid = seed["league"]["id"]
    set_sleeper_sync_mode(lid, "off")
    _FakeSleeper(monkeypatch)
    before = _fingerprint(seed)

    # A live read would otherwise overwrite who Sleeper says is on team A.
    league_sleeper_sync.fetch_team_snapshot_cached(lid, seed["team_a"])
    storage.update_team_sleeper_link(seed["team_a"], sleeper_player_ids=[])

    assert _fingerprint(seed) == before
    team_a = storage.get_team(seed["team_a"])
    assert team_a["sleeper_roster_id"] == "1"


def test_paused_league_roster_view_ignores_live_sleeper(hub_db, monkeypatch):
    seed = _seed("pause-view")
    lid = seed["league"]["id"]
    set_sleeper_sync_mode(lid, "off")
    fake = _FakeSleeper(monkeypatch)
    ctx = resolve_hub_context_for_league(seed["sub"], lid)
    assert ctx["sleeper_sync_paused"] is True
    assert ctx["sleeper_sync_mode"] == SLEEPER_SYNC_OFF

    live = list_roster_for_context(ctx, live_sleeper=True)
    stored = list_roster_for_context(ctx, live_sleeper=False)

    assert fake.calls == 0
    assert sorted(r["player_id"] for r in live) == sorted(r["player_id"] for r in stored)
    assert "sleeper-7777" not in {r["player_id"] for r in live}


def test_paused_link_skips_import(hub_db, monkeypatch):
    seed = _seed("pause-link")
    lid = seed["league"]["id"]
    set_sleeper_sync_mode(lid, "off")
    _FakeSleeper(monkeypatch)
    before = _fingerprint(seed)

    result = sleeper_link.link_sleeper_team(
        seed["sub"],
        sleeper_league_id=SLEEPER_LEAGUE,
        sleeper_roster_id="1",
        import_to_hub=True,
    )

    assert result["sleeper_sync_paused"] is True
    assert result["imported_to_hub"] == 0
    assert _fingerprint(seed) == before


def test_unlink_can_still_keep_rosters_while_paused(hub_db):
    seed = _seed("pause-unlink")
    lid = seed["league"]["id"]
    set_sleeper_sync_mode(lid, "off")
    rows_before = len(storage.list_league_roster(seed["ws_id"]))

    result = league_sleeper_sync.disconnect_sleeper_league(lid, clear_sleeper_roster=False)

    assert result["roster_rows_removed"] == 0
    assert len(storage.list_league_roster(seed["ws_id"])) == rows_before


def test_weekly_sync_metadata_hides_endpoint_when_paused(hub_db):
    seed = _seed("pause-weekly")
    lid = seed["league"]["id"]
    ctx = resolve_hub_context_for_league(seed["sub"], lid)
    assert _sync_metadata(ctx)["sync_endpoint"]

    set_sleeper_sync_mode(lid, "off")
    meta = _sync_metadata(resolve_hub_context_for_league(seed["sub"], lid))
    assert meta["paused"] is True
    assert meta["sync_endpoint"] is None


def test_paused_message_names_where_to_resume():
    assert "Access & imports" in PAUSED_MESSAGE


def test_sync_mode_route_registered():
    from app.hub_routes import router

    methods = {
        (getattr(route, "path", ""), method)
        for route in router.routes
        for method in (getattr(route, "methods", None) or set())
    }
    assert ("/api/hub/league/{league_id}/sleeper/sync-mode", "PUT") in methods
