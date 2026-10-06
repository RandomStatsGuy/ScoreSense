"""Personal Sleeper links cannot change a dedicated league's scoring host."""
import pytest

from src.draft_hub import storage
from src.draft_hub.hub_context import resolve_hub_context_for_league
from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id
from src.draft_hub.schemas import LeagueRules


@pytest.fixture(autouse=True)
def local_calendar(monkeypatch):
    monkeypatch.setattr("src.draft_hub.acquisition_window.get_nfl_state",
                        lambda *a, **k: {"season": 2026, "season_type": "regular", "week": 1})


def personal_link(sub, provider="personal-other"):
    return storage.update_sleeper_link(sub, sleeper_league_id=provider,
        sleeper_roster_id="7", sleeper_team_name="Personal team", sleeper_player_ids=["4046"])


def native(sub="host-comm", *, workspace_id=None, test_mode=False):
    return storage.create_league(sub, "Host scope", 2026, LeagueRules(), team_count=2,
                                 workspace_id=workspace_id, test_mode=test_mode)


def test_new_dedicated_league_does_not_inherit_personal_host_or_roster(hub_db):
    workspace = personal_link("host-comm")
    league = native()
    assert league["workspace_id"] == league["id"] != workspace["id"]
    assert league["sleeper_league_id"] is None
    team = storage.get_team_by_user(league["id"], "host-comm")
    assert team["sleeper_roster_id"] is None
    assert team["sleeper_team_name"] is None
    assert team["sleeper_player_ids"] == []
    assert team["sleeper_synced_at"] is None
    assert resolve_sleeper_league_id(league["id"]) is None
    assert storage.get_league(league["id"])["sleeper_league_id"] is None
    assert resolve_hub_context_for_league("host-comm", league["id"])["sleeper_league_id"] is None


@pytest.mark.parametrize("linked_user", ["host-comm", "host-member"])
def test_existing_dedicated_native_league_ignores_later_personal_links(hub_db, linked_user):
    league = native()
    storage.join_league("host-member", league["room_code"], "Member")
    personal_link(linked_user)
    assert resolve_sleeper_league_id(league["id"]) is None
    assert storage.get_league(league["id"])["sleeper_league_id"] is None
    assert resolve_hub_context_for_league(linked_user, league["id"])["sleeper_league_id"] is None


def test_explicit_league_link_wins_over_unrelated_personal_links(hub_db):
    league = native()
    storage.join_league("host-member", league["room_code"], "Member")
    personal_link("host-comm", "commissioner-personal")
    personal_link("host-member", "member-personal")
    storage.update_league_sleeper_id(league["id"], "league-official")
    assert resolve_sleeper_league_id(league["id"]) == "league-official"
    assert resolve_hub_context_for_league("host-member", league["id"])["sleeper_league_id"] == "league-official"


def test_legacy_shared_commissioner_pool_preserves_and_migrates_its_own_link(hub_db):
    workspace = personal_link("host-comm", "legacy-official")
    league = native(workspace_id=workspace["id"])
    assert league["sleeper_league_id"] == "legacy-official"
    assert storage.get_team_by_user(league["id"], "host-comm")["sleeper_roster_id"] == "7"
    with storage.get_conn() as conn:
        conn.execute("UPDATE league SET sleeper_league_id=NULL WHERE id=?", (league["id"],))
    assert resolve_sleeper_league_id(league["id"]) == "legacy-official"
    assert storage.get_league(league["id"])["sleeper_league_id"] == "legacy-official"


def test_foreign_personal_pool_cannot_supply_a_league_host(hub_db):
    foreign = personal_link("different-manager")
    league = native(workspace_id=foreign["id"])
    assert league["sleeper_league_id"] is None
    assert resolve_sleeper_league_id(league["id"]) is None
    assert storage.get_league(league["id"])["sleeper_league_id"] is None


def test_legacy_shared_native_pool_ignores_member_personal_link(hub_db):
    workspace = storage.get_or_create_workspace("host-comm")
    league = native(workspace_id=workspace["id"])
    storage.join_league("host-member", league["room_code"], "Member")
    personal_link("host-member")
    assert resolve_sleeper_league_id(league["id"]) is None


def test_mock_room_never_inherits_or_migrates_a_personal_link(hub_db):
    workspace = personal_link("host-comm")
    league = native(workspace_id=workspace["id"], test_mode=True)
    assert league["workspace_id"] is None
    assert league["sleeper_league_id"] is None
    assert storage.get_team_by_user(league["id"], "host-comm")["sleeper_roster_id"] is None
    # Even a legacy test room pointing at the pool must not migrate its link.
    storage.set_league_workspace_id(league["id"], workspace["id"])
    assert resolve_sleeper_league_id(league["id"]) is None


def test_native_worker_eligibility_resolves_legacy_host_before_scoring(hub_db):
    dedicated = native()
    personal_link("host-comm", "unrelated-personal")
    legacy_workspace = personal_link("legacy-comm", "legacy-official")
    legacy = native("legacy-comm", workspace_id=legacy_workspace["id"])
    with storage.get_conn() as conn:
        conn.execute("UPDATE league SET draft_completed=1 WHERE id IN (?,?)", (dedicated["id"], legacy["id"]))
        conn.execute("UPDATE league SET sleeper_league_id=NULL WHERE id=?", (legacy["id"],))
    assert [row["id"] for row in storage.list_native_scoring_leagues()] == [dedicated["id"]]
    assert storage.get_league(legacy["id"])["sleeper_league_id"] == "legacy-official"


def test_legacy_migration_cannot_overwrite_a_concurrent_explicit_league_link(hub_db, monkeypatch):
    workspace = personal_link("host-comm", "legacy-official")
    league = native(workspace_id=workspace["id"])
    with storage.get_conn() as conn:
        conn.execute("UPDATE league SET sleeper_league_id=NULL WHERE id=?", (league["id"],))
    read_workspace = storage.get_workspace_by_id
    def link_during_read(workspace_id):
        result = read_workspace(workspace_id)
        storage.update_league_sleeper_id(league["id"], "explicit-now")
        return result
    monkeypatch.setattr(storage, "get_workspace_by_id", link_during_read)
    assert resolve_sleeper_league_id(league["id"]) == "explicit-now"
    assert storage.get_league(league["id"])["sleeper_league_id"] == "explicit-now"


def test_legacy_shared_sleeper_host_cannot_accept_native_bids(hub_db):
    from src.draft_hub import fa_market
    workspace = personal_link("legacy-bid-owner", "official-sleeper")
    league = storage.create_league("legacy-bid-owner", "Shared", 2026, LeagueRules(),
                                  workspace_id=workspace["id"], team_count=1)
    with storage.get_conn() as conn:
        conn.execute("UPDATE league SET sleeper_league_id=NULL, sleeper_hosting_disabled=0 WHERE id=?", (league["id"],))
    team = storage.get_team_by_user(league["id"], "legacy-bid-owner")
    with pytest.raises(ValueError, match="Add players in Sleeper"):
        fa_market.place_fa_bid(league_id=league["id"],team_id=team["id"],player_id="4046",player_name="Mahomes",
                              position="QB",team="KC",bid_amount=1,window_id="2026-w1-waiver",user_sub="legacy-bid-owner")
    assert storage.list_fa_bids(league["id"],status=None) == []
    assert storage.get_league(league["id"])["sleeper_league_id"] == "official-sleeper"


def test_linked_market_keeps_stale_native_bids_private_and_unsettled(hub_db, monkeypatch):
    from app import hub_routes
    league = native()
    team = storage.get_team_by_user(league["id"], "host-comm")
    storage.upsert_fa_bid(league_id=league["id"], window_id="waivers-2026-w1",
        team_id=team["id"], player_id="stale-native", player_name="Stale native",
        nfl_team="KC", position="WR", bid_amount=5, user_sub="host-comm")
    storage.update_league_sleeper_id(league["id"], "external-host")
    context = resolve_hub_context_for_league("host-comm", league["id"])
    monkeypatch.setattr(hub_routes, "_ctx", lambda *_: context)
    def no_native_settlement(*args, **kwargs):
        raise AssertionError("Linked market must not settle native acquisitions")
    monkeypatch.setattr(hub_routes, "process_due_windows", no_native_settlement)
    monkeypatch.setattr(hub_routes, "process_due_claim_windows", no_native_settlement)
    response = hub_routes.hub_fa_market(_user={"sub": "host-comm"})
    assert response["market"]["external_host"] == "sleeper"
    assert response["market"]["players"] == []
    assert response["market"]["my_bids"] == []
    assert storage.list_fa_bids(league["id"], status="open")[0]["player_id"] == "stale-native"
    assert storage.list_league_roster(storage.roster_workspace_for_league(league)) == []
