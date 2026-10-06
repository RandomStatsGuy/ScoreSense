"""Trusted player identity, alias ownership, and acquisition metadata regressions."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import fa_market, player_identity, storage
from src.draft_hub.schemas import LeagueRules

MAHOMES = "00-0033873"
WINDOW = "2026-w1-waiver"


@pytest.fixture(autouse=True)
def pregame(monkeypatch):
    monkeypatch.setattr("src.core.schedule_utils.current_projection_week", lambda *a, **k: 1)
    monkeypatch.setattr("src.draft_hub.hub_scoring._utcnow", lambda: datetime(2026, 9, 1, tzinfo=timezone.utc))
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_game_started", lambda *a, **k: False)
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_week_slate_complete", lambda *a, **k: False)
    monkeypatch.setattr("src.draft_hub.acquisition_window.get_nfl_state",
                        lambda *a, **k: {"season": 2026, "season_type": "regular", "week": 1})
    monkeypatch.setattr("src.draft_hub.league_live_scoring.get_nfl_state",
                        lambda *a, **k: {"season": 2026, "season_type": "regular", "week": 1})
    monkeypatch.setattr("src.draft_hub.acquisition_window._now_et",
                        lambda now=None: datetime(2026, 9, 10, 10, tzinfo=ZoneInfo("America/New_York")))


@pytest.fixture()
def catalog(trusted_native_catalog):
    trusted_native_catalog("4046", name="Patrick Mahomes", team="KC", position="QB", gsis_id=MAHOMES)
    trusted_native_catalog("11533", name="Brandon Aubrey", team="DAL", position="K")
    return trusted_native_catalog


def league_pair():
    rules = LeagueRules(draft_type="auction",
                        roster={"qb": {"max": 2, "starter": 1}, "wr": {"max": 2, "starter": 1},
                                "k": {"max": 1, "starter": 1}, "def": {"max": 1, "starter": 1}})
    league = storage.create_league("identity-home", "Identity", 2026, rules, team_count=2)
    storage.update_league_settings(league["id"], draft_completed=True)
    home = storage.get_team_by_user(league["id"], "identity-home")
    away = storage.join_league("identity-away", league["room_code"], "Away")
    return league, home, away, rules


def mahomes(pid=MAHOMES, **overrides):
    return {"player_id": pid, "player_name": "Patrick Mahomes", "team": "KC", "position": "QB",
            "salary": 0, "contract_years": 1, **overrides}


@pytest.mark.parametrize("pid", [MAHOMES, "4046", "sleeper-4046"])
def test_known_aliases_resolve_to_one_canonical_identity(catalog, pid):
    identity = player_identity.cached_player_identity(pid, season=2026)
    assert identity["player_id"] == MAHOMES
    assert identity["position"] == "QB" and identity["team"] == "KC"
    assert identity["sleeper_player_id"] == "4046"
    assert {MAHOMES, "4046", "sleeper-4046"} <= set(identity["aliases"])


@pytest.mark.parametrize("pid", ["LA", "LAR", "sleeper-LAR", "def-LA"])
def test_defense_aliases_share_the_team_identity(trusted_native_catalog, pid):
    identity = player_identity.cached_player_identity(pid, season=2026)
    assert (identity["player_id"], identity["team"], identity["position"]) == ("LA", "LA", "DEF")


@pytest.mark.parametrize("change", [{"position": "WR"}, {"sleeper_player_id": "11533"},
                                   {"player_id": "invented", "sleeper_player_id": "4046"}])
def test_forged_position_or_conflicting_ids_are_rejected(catalog, change):
    with pytest.raises(player_identity.PlayerIdentityError):
        player_identity.resolve_acquisition_identity(mahomes(**change), season=2026)


def test_stale_client_team_and_name_use_authoritative_cache(catalog):
    row = player_identity.resolve_acquisition_identity(mahomes("sleeper-4046", team="DET", player_name="Fake"), season=2026)
    assert row["team"] == "KC" and row["player_name"] == "Patrick Mahomes"
    assert row["player_id"] == MAHOMES


def test_pool_fallback_joins_a_missing_gsis_crosswalk_without_network(trusted_native_catalog, tmp_path, monkeypatch):
    trusted_native_catalog("4046", name="Patrick Mahomes", team="KC", position="QB")
    pool = player_identity.DRAFT_POOL_DIR
    pool.mkdir()
    pd.DataFrame([{"player_id": MAHOMES, "Player": "Patrick Mahomes", "Team": "DET", "Position": "QB"},
                  {"player_id": "11533", "Player": "Brandon Aubrey", "Team": "DAL", "Position": "K"}]).to_parquet(pool / "pool_2026.parquet")
    def forbidden(*a, **k):
        raise AssertionError("Identity resolution must not call a provider or model")
    monkeypatch.setattr("src.integrations.sleeper.load_sleeper_players", forbidden)
    monkeypatch.setattr("src.projections.draft_projections.predict_draft_season", forbidden)
    assert player_identity.cached_player_identity(MAHOMES, season=2026)["team"] == "KC"
    assert player_identity.cached_player_identity("4046", season=2026)["player_id"] == MAHOMES
    assert player_identity.cached_player_identity("sleeper-11533", season=2026)["position"] == "K"


def test_unknown_identity_stays_unavailable_and_known_free_agent_is_trusted(trusted_native_catalog):
    assert player_identity.cached_player_identity("not-real", season=2026) is None
    trusted_native_catalog("99999", name="Known Free Agent", team=None, position="WR")
    identity = player_identity.cached_player_identity("99999", season=2026)
    assert identity["team"] == "FA" and identity["position"] == "WR"


def test_frozen_pool_cannot_override_current_identity_or_free_agent_team(catalog):
    pool = player_identity.DRAFT_POOL_DIR
    pool.mkdir()
    catalog("99999", name="Known Free Agent", team=None, position="WR", gsis_id="00-0099999")
    pd.DataFrame([{"player_id": MAHOMES, "Player": "Patrick Mahomes", "Team": "DET", "Position": "WR"},
                  {"player_id": "00-0000001", "Player": "Patrick Mahomes", "Team": "DET", "Position": "QB"},
                  {"player_id": "00-0099999", "Player": "Known Free Agent", "Team": "KC", "Position": "WR"}]).to_parquet(pool / "pool_2026.parquet")
    identity = player_identity.cached_player_identity(MAHOMES, season=2026)
    assert identity["position"] == "QB" and identity["team"] == "KC"
    assert player_identity.cached_player_identity("00-0000001", season=2026) is None
    assert player_identity.cached_player_identity("00-0099999", season=2026)["team"] == "FA"


@pytest.mark.parametrize("alias", [MAHOMES, "4046", "sleeper-4046"])
def test_atomic_add_cannot_duplicate_a_legacy_alias(hub_db, catalog, alias):
    league, home, away, rules = league_pair()
    workspace = storage.roster_workspace_for_league(league)
    existing = "4046" if alias != "4046" else MAHOMES
    storage.add_roster_slot(workspace, mahomes(existing), team_id=home["id"])
    revisions = storage.league_cache_revisions(league["id"])
    with pytest.raises(ValueError, match="already on a roster"):
        storage.add_roster_slot(workspace, mahomes(alias), team_id=away["id"], validate_rules=rules)
    assert len(storage.list_workspace_roster_slots(workspace)) == 1
    assert storage.league_cache_revisions(league["id"]) == revisions


def test_undo_and_trade_cannot_restore_or_move_a_duplicate_alias(hub_db, catalog):
    league, home, away, rules = league_pair()
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace, mahomes(roster_status="cut_before_draft"), team_id=home["id"])
    storage.add_roster_slot(workspace, mahomes("4046"), team_id=away["id"])
    with pytest.raises(ValueError, match="already on a roster"):
        storage.update_roster_slot(workspace, MAHOMES, team_id=home["id"], roster_status="active", validate_rules=rules)
    assert storage.get_roster_slot(workspace, MAHOMES)["roster_status"] == "cut_before_draft"
    # Seed an existing legacy duplicate without rewriting historical data.
    storage.add_roster_slot(workspace, mahomes(), team_id=home["id"])
    before = storage.list_workspace_roster_slots(workspace)
    with pytest.raises(ValueError, match="another id"):
        storage.apply_trade_plan(workspace, [{"player_id": MAHOMES, "from_team_id": home["id"], "team_id": away["id"]}], dead_cap_rules=rules)
    assert storage.list_workspace_roster_slots(workspace) == before


def test_claims_reject_wrong_position_and_an_already_owned_alias(hub_db, catalog):
    league, home, away, _ = league_pair()
    kwargs = dict(league_id=league["id"], team_id=away["id"], player_id="4046", player_name="Mahomes",
                  team="DET", position="WR", bid_amount=4, window_id=WINDOW, user_sub="identity-away")
    with pytest.raises(ValueError, match="position does not match"):
        fa_market.place_fa_bid(**kwargs)
    assert not storage.list_fa_bids(league["id"], status=None)
    storage.add_roster_slot(storage.roster_workspace_for_league(league), mahomes(), team_id=home["id"])
    kwargs.update(player_id="sleeper-4046", position="QB")
    with pytest.raises(ValueError, match="already on a roster"):
        fa_market.place_fa_bid(**kwargs)


def test_legacy_claim_aliases_compete_once_and_award_verified_metadata(hub_db, catalog):
    league, home, away, _ = league_pair()
    for team, pid, amount in [(home, "4046", 4), (away, "sleeper-4046", 7)]:
        storage.upsert_fa_bid(league_id=league["id"], team_id=team["id"], player_id=pid,
            player_name="Mahomes", nfl_team="DET", position="QB", bid_amount=amount,
            window_id=WINDOW, user_sub=team["user_sub"])
    result = fa_market.process_window(league["id"], WINDOW)
    assert result["awarded_count"] == 1 and result["awarded"][0]["team_id"] == away["id"]
    assert result["awarded"][0]["salary"] == 7 and result["awarded"][0]["bid_amount"] == 7
    row = storage.get_roster_slot(storage.roster_workspace_for_league(league), MAHOMES)
    assert row["team"] == "KC" and row["position"] == "QB" and row["salary"] == 7
    assert {b["team_id"]: b["status"] for b in storage.list_fa_bids(league["id"], status=None)} == {home["id"]: "lost", away["id"]: "won"}


def test_invalid_legacy_high_claim_falls_back_to_valid_alias(hub_db, catalog):
    league, home, away, _ = league_pair()
    for team, pid, amount, position in [(home, "4046", 10, "WR"), (away, MAHOMES, 3, "QB")]:
        storage.upsert_fa_bid(league_id=league["id"], team_id=team["id"], player_id=pid,
            player_name="Mahomes", nfl_team="DET", position=position, bid_amount=amount,
            window_id=WINDOW, user_sub=team["user_sub"])
    result = fa_market.process_window(league["id"], WINDOW)
    assert result["awarded_count"] == 1 and result["awarded"][0]["team_id"] == away["id"]
    assert result["awarded"][0]["bid_amount"] == 3 and result["awarded"][0]["salary"] == 3
    assert {b["team_id"]: b["status"] for b in storage.list_fa_bids(league["id"], status=None)} == {home["id"]: "lost", away["id"]: "won"}


def test_cut_and_reclaim_cannot_overwrite_a_previous_bid_award(hub_db, catalog):
    league, home, _, rules = league_pair()
    window = "2026-post-draft-fa"
    kwargs = dict(league_id=league["id"], team_id=home["id"], player_id="4046", player_name="Mahomes",
                  team="KC", position="QB", bid_amount=7, window_id=window, user_sub="identity-home")
    original = fa_market.place_fa_bid(**kwargs)["bid"]
    fa_market.process_window(league["id"], window)
    storage.update_roster_slot(storage.roster_workspace_for_league(league), MAHOMES,
                              team_id=home["id"], roster_status="cut_before_draft")
    kwargs.update(player_id="sleeper-4046", bid_amount=1)
    with pytest.raises(ValueError, match="previous award is retained"):
        fa_market.place_fa_bid(**kwargs)
    storage.cancel_open_fa_bids_for_team(league["id"], home["id"])
    storage.close_fa_bids_for_player(league["id"], window, MAHOMES, winner_id=None)
    saved = storage.list_fa_bids(league["id"], status="won")
    assert len(saved) == 1 and saved[0]["id"] == original["id"] and saved[0]["bid_amount"] == 7
    kwargs["window_id"] = "2026-w2-waiver"
    fa_market.place_fa_bid(**kwargs)
    assert fa_market.process_window(league["id"], kwargs["window_id"])["awarded_count"] == 1


@pytest.mark.parametrize("kind", ["wrong_position", "stale_team", "unknown", "staff"])
def test_native_add_api_requires_trusted_identity_and_keeps_staff_escape(hub_db, catalog, kind):
    league, _, _, _ = league_pair()
    body = {"player_id": "4046", "player_name": "Mahomes", "team": "DET", "position": "QB", "salary": 0}
    if kind == "wrong_position":
        body["position"] = "WR"
    if kind in {"unknown", "staff"}:
        body.update(player_id="manual-unknown", player_name="Manual", position="WR")
    if kind == "staff":
        body["staff_edit"] = True
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "identity-home", "auth_type": "dev"}
    try:
        response = TestClient(app).post("/api/hub/roster", json=body)
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
    assert response.status_code == (200 if kind in {"stale_team", "staff"} else 400), response.text
    rows = storage.list_workspace_roster_slots(storage.roster_workspace_for_league(league))
    if kind == "stale_team":
        assert rows[0]["player_id"] == MAHOMES and rows[0]["team"] == "KC" and rows[0]["position"] == "QB"
    elif kind != "staff":
        assert not rows


@pytest.mark.parametrize("operation", ["add", "bid", "restore", "force", "trade"])
def test_legacy_wrong_position_counts_as_its_actual_position(hub_db, catalog, operation):
    catalog("4984", name="Josh Allen", team="BUF", position="QB", gsis_id="00-0034857")
    league, home, away, rules = league_pair()
    rules.roster["qb"]["max"] = 1
    storage.update_league_rules(league["id"], rules)
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace, mahomes(position="WR"), team_id=away["id"])
    incoming = {"player_id": "00-0034857", "player_name": "Josh Allen", "team": "BUF",
                "position": "QB", "salary": 0, "contract_years": 1}
    if operation == "add":
        with pytest.raises(ValueError, match="too many QB"):
            storage.add_roster_slot(workspace, incoming, team_id=away["id"], validate_rules=rules)
    elif operation == "bid":
        kwargs = dict(league_id=league["id"], team_id=away["id"], player_id="4984", player_name="Josh Allen",
                      team="BUF", position="QB", bid_amount=1, window_id=WINDOW, user_sub="identity-away")
        with pytest.raises(ValueError, match="too many QB"):
            fa_market.place_fa_bid(**kwargs)
        storage.upsert_fa_bid(league_id=league["id"], team_id=away["id"], player_id="4984",
            player_name="Josh Allen", nfl_team="BUF", position="QB", bid_amount=1,
            window_id=WINDOW, user_sub="identity-away")
        assert fa_market.process_window(league["id"], WINDOW)["awarded_count"] == 0
    elif operation == "restore":
        storage.add_roster_slot(workspace, {**incoming, "roster_status": "cut_before_draft"}, team_id=away["id"])
        with pytest.raises(ValueError, match="too many QB"):
            storage.update_roster_slot(workspace, incoming["player_id"], team_id=away["id"],
                                       roster_status="active", validate_rules=rules)
    else:
        storage.add_roster_slot(workspace, incoming, team_id=home["id"])
        if operation == "force":
            with pytest.raises(ValueError, match="too many QB"):
                storage.move_roster_player(workspace, incoming["player_id"], away["id"], validate_rules=rules)
        else:
            from src.draft_hub.trade_proposals import validate_trade_package
            parties = [{"team_id": home["id"], "sends": [incoming["player_id"]]}, {"team_id": away["id"], "sends": []}]
            assert not validate_trade_package(league["id"], parties)["ok"]
            with pytest.raises(ValueError, match="too many QB"):
                storage.apply_trade_plan(workspace, [{"player_id": incoming["player_id"], "from_team_id": home["id"], "team_id": away["id"]}], dead_cap_rules=rules)
    # Validation corrects its inputs without rewriting legacy stored metadata.
    assert storage.get_roster_slot(workspace, MAHOMES)["position"] == "WR"


@pytest.mark.parametrize("failure", ["total", "position", "cap", "budget", "alias", "foreign"])
def test_auction_award_failure_rolls_back_every_side_effect(hub_db, catalog, failure):
    import json

    league, home, away, rules = league_pair()
    rules.draft_type = "auction"
    rules.salary_cap = 20
    if failure == "total":
        rules.roster_size_max = 0
    if failure == "position":
        rules.roster["qb"]["max"] = 0
    storage.update_league_rules(league["id"], rules)
    storage.update_league_settings(league["id"], draft_completed=False)
    storage.update_team_budget(home["id"], 0 if failure == "budget" else 200)
    workspace = storage.roster_workspace_for_league(league)
    winner = home["id"]
    if failure == "alias":
        storage.add_roster_slot(workspace, mahomes("4046"), team_id=away["id"])
    if failure == "foreign":
        foreign = storage.create_league("foreign-auction", "Foreign", 2026, rules, team_count=2)
        winner = storage.get_team_by_user(foreign["id"], "foreign-auction")["id"]
    amount = 21 if failure == "cap" else 1
    storage.update_draft_session(league["id"], status="bidding", high_bid=amount,
        high_bidder_team_id=winner, current_nominee_json=json.dumps({"player_id": MAHOMES}))
    before_session = storage.get_draft_session(league["id"])
    before_budget = storage.get_team(winner)["budget_remaining"]
    before_roster = storage.list_workspace_roster_slots(workspace)
    before_events = storage.list_draft_events(league["id"])
    with pytest.raises(ValueError):
        storage.finalize_auction_win(league["id"], player_id=MAHOMES, winner_id=winner,
            amount=amount, workspace_id=workspace, roster_row=mahomes(salary=amount),
            event_payload={"player_id": MAHOMES, "team_id": winner, "amount": amount},
            session_fields={"status": "nominating", "high_bid": 0, "current_nominee_json": None})
    assert storage.get_draft_session(league["id"]) == before_session
    assert storage.get_team(winner)["budget_remaining"] == before_budget
    assert storage.list_workspace_roster_slots(workspace) == before_roster
    assert storage.list_draft_events(league["id"]) == before_events
    with storage.get_conn() as conn:
        assert conn.execute("SELECT COUNT(*) FROM auction_award_claim WHERE league_id=?", (league["id"],)).fetchone()[0] == 0


def test_successful_auction_award_remains_idempotent(hub_db, catalog):
    league, home, _, rules = league_pair()
    rules.draft_type = "auction"
    storage.update_league_rules(league["id"], rules)
    storage.update_league_settings(league["id"], draft_completed=False)
    workspace = storage.roster_workspace_for_league(league)
    kwargs = dict(player_id=MAHOMES, winner_id=home["id"], amount=3, workspace_id=workspace,
        roster_row={**mahomes(salary=3), "source": "draft"},
        event_payload={"player_id": MAHOMES, "team_id": home["id"], "amount": 3},
        session_fields={"status": "nominating", "high_bid": 0})
    assert storage.finalize_auction_win(league["id"], **kwargs)
    budget = storage.get_team(home["id"])["budget_remaining"]
    assert not storage.finalize_auction_win(league["id"], **kwargs)
    assert storage.get_team(home["id"])["budget_remaining"] == budget
    assert len(storage.list_draft_events(league["id"])) == 1
    assert storage.get_roster_slot(workspace, MAHOMES)["source"] == "draft"
