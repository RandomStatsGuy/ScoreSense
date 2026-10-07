"""Award-time and host-authority checks against isolated league storage."""
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import fa_market, storage
from src.draft_hub.schemas import LeagueRules

WINDOW = "2026-w1-waiver"
_register_player = None


@pytest.fixture(autouse=True)
def acquisition_catalog(trusted_native_catalog, monkeypatch):
    import sys
    monkeypatch.setattr(sys.modules[__name__], "_register_player", trusted_native_catalog)


@pytest.fixture(autouse=True)
def pregame_2026(monkeypatch):
    monkeypatch.setattr("src.core.schedule_utils.current_projection_week", lambda *a, **k: 1)
    monkeypatch.setattr("src.draft_hub.hub_scoring._utcnow", lambda: datetime(2026, 9, 1, tzinfo=timezone.utc))
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_game_started", lambda *a, **k: False)
    monkeypatch.setattr("src.draft_hub.hub_scoring.nfl_week_slate_complete", lambda *a, **k: False)
    monkeypatch.setattr("src.draft_hub.acquisition_window.get_nfl_state",
                        lambda *a, **k: {"season": 2026, "season_type": "regular", "week": 1})
    monkeypatch.setattr("src.draft_hub.league_live_scoring.get_nfl_state",
                        lambda *a, **k: {"season": 2026, "season_type": "regular", "week": 1})


def league_pair(*, suffix="one", **overrides):
    rules = LeagueRules(roster={"wr": {"max": 10, "starter": 1},
                              "qb": {"max": 3, "starter": 1},
                              "k": {"max": 1, "starter": 1}}, **overrides)
    sub = f"integrity-{suffix}"
    league = storage.create_league(sub, "Acquisition integrity", 2026, rules, team_count=2)
    storage.update_league_settings(league["id"], draft_completed=True)
    first = storage.get_team_by_user(league["id"], sub)
    second = storage.join_league(f"second-{suffix}", league["room_code"], "Second")
    return storage.get_league(league["id"]), first, second, rules


def player(pid, *, salary=1, position="WR"):
    if _register_player:
        _register_player(pid, name=f"Player {pid}", team="KC", position=position)
    return {"player_id": pid, "player_name": f"Player {pid}", "team": "KC",
            "position": position, "salary": salary, "contract_years": 1}


def bid(league, team, pid, amount, *, window=WINDOW):
    if _register_player:
        _register_player(pid, name=f"Player {pid}", team="KC", position="WR")
    return fa_market.place_fa_bid(league_id=league["id"], team_id=team["id"],
        player_id=pid, player_name=f"Player {pid}", team="KC", position="WR",
        bid_amount=amount, window_id=window, user_sub=str(team.get("user_sub") or "claimant"))


@pytest.mark.parametrize("kind", ["total", "position_zero", "cap"])
def test_transaction_revalidates_saved_rules_and_current_roster(hub_db, kind):
    league, home, _, stale = league_pair()
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace, player("owned", salary=10), team_id=home["id"])
    saved = stale.model_copy(deep=True)
    expected = {"total": "maximum size", "position_zero": "too many K", "cap": "Over cap"}[kind]
    if kind == "total":
        saved.roster_size_max = 1
        incoming = player("incoming", salary=2)
    elif kind == "position_zero":
        saved.roster["k"]["max"] = 0
        incoming = player("incoming", position="K")
    else:
        saved.salary_cap = 11
        incoming = player("incoming", salary=2)
    storage.update_league_rules(league["id"], saved)
    with pytest.raises(ValueError, match=expected):
        storage.add_roster_slot(workspace, incoming, team_id=home["id"], validate_rules=stale)
    assert [r["player_id"] for r in storage.list_team_roster(league["id"], home["id"])] == ["owned"]


def test_explicit_zero_total_roster_limit_rejects_award(hub_db):
    league, home, _, rules = league_pair(roster_size_max=0)
    with pytest.raises(ValueError, match="maximum size"):
        storage.add_roster_slot(storage.roster_workspace_for_league(league), player("incoming"),
                                team_id=home["id"], validate_rules=rules)
    assert not storage.list_team_roster(league["id"], home["id"])


@pytest.mark.parametrize("kind", ["roster", "cap"])
def test_now_ineligible_high_bid_falls_back_to_eligible_second(hub_db, kind):
    league, home, away, _ = league_pair(roster_size_max=1, salary_cap=20)
    bid(league, home, "claimed", 18)
    bid(league, away, "claimed", 5)
    storage.add_roster_slot(storage.roster_workspace_for_league(league),
                            player("late-add", salary=10), team_id=home["id"])
    if kind == "cap":
        rules = LeagueRules.model_validate(league["rules"])
        rules.roster_size_max = 10
        storage.update_league_rules(league["id"], rules)
    result = fa_market.process_window(league["id"], WINDOW)
    assert result["awarded_count"] == 1
    assert result["awarded"][0]["team_id"] == away["id"]
    assert {b["team_id"]: b["status"] for b in storage.list_fa_bids(league["id"], status=None)} == {
        home["id"]: "lost", away["id"]: "won"}
    awarded = storage.get_roster_slot(storage.roster_workspace_for_league(league), "claimed")
    assert awarded["team_id"] == away["id"] and awarded["salary"] == 5




@pytest.mark.parametrize("draft_type,window", [("auction", WINDOW)])
def test_blind_market_does_not_reveal_competing_claims(hub_db, draft_type, window):
    league, home, away, _ = league_pair(draft_type=draft_type)
    assert bid(league, home, "shared", 4, window=window)["high_bid"] is None
    bid(league, away, "shared", 50, window=window)
    bid(league, away, "secret", 30, window=window)
    market = fa_market.list_market(league["id"], window_id=window, team_id=home["id"])
    assert market["blind"] and market["open_count"] == 1
    assert market["players"] == [{"player_id": "shared", "player_name": "Player shared",
        "team": "KC", "position": "WR", "high_bid": None, "bid_count": 1, "my_bid": 4}]
    assert all(row["team_id"] == home["id"] for row in market["my_bids"])
    anonymous = fa_market.list_market(league["id"], window_id=window)
    assert anonymous["players"] == anonymous["my_bids"] == []
    assert anonymous["open_count"] == 0


def test_forged_other_league_team_is_rejected_before_claim_is_saved(hub_db):
    league, _, _, _ = league_pair()
    _, foreign, _, _ = league_pair(suffix="foreign")
    with pytest.raises(ValueError, match="belong|this league|not found"):
        bid(league, foreign, "forged", 1)
    assert storage.list_fa_bids(league["id"], status=None) == []


def test_transaction_rejects_foreign_team_and_preserves_claim(hub_db):
    league, _, _, rules = league_pair()
    _, foreign, _, _ = league_pair(suffix="foreign")
    with pytest.raises(ValueError, match="does not belong"):
        storage.add_roster_slot(storage.roster_workspace_for_league(league), player("forged"),
                                team_id=foreign["id"], validate_rules=rules)
    assert not storage.list_workspace_roster_slots(storage.roster_workspace_for_league(league))


def test_linked_host_rejects_bid_and_lineup_move(hub_db):
    league, home, _, _ = league_pair()
    storage.update_league_sleeper_id(league["id"], "external-host")
    with pytest.raises(ValueError, match="Sleeper"):
        bid(league, home, "claim", 5)
    with pytest.raises(ValueError, match="Sleeper"):
        fa_market.process_window(league["id"], WINDOW)
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "integrity-one", "auth_type": "dev"}
    try:
        response = TestClient(app).post(f"/api/hub/league/{league['id']}/lineup/swap", json={
            "season": 2026, "week": 1, "starter_player_id": "starter", "bench_player_id": "bench"})
        assert response.status_code == 409, response.text
        assert "Sleeper" in response.json()["detail"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
    assert not storage.list_week_lineups(league["id"], 2026, 1)
    assert not storage.list_fa_bids(league["id"], status=None)


@pytest.mark.parametrize("kind", ["full_roster", "over_cap"])
def test_undo_cut_rejection_preserves_contract_status_and_revision(hub_db, kind):
    from src.draft_hub.contract_service import apply_roster_edit
    league, home, _, rules = league_pair(roster_size_max=1 if kind == "full_roster" else 10,
                                        salary_cap=15 if kind == "over_cap" else 200)
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace, {**player("cut", salary=5), "roster_status": "cut_before_draft",
        "contract": {"current_salary": 5, "base_salary": 10, "years_remaining": 1,
                     "contract_phase": "dead_cap"}}, team_id=home["id"])
    storage.add_roster_slot(workspace, player("active", salary=8), team_id=home["id"])
    before = storage.get_roster_slot(workspace, "cut", team_id=home["id"])
    revision = storage.league_cache_revisions(league["id"])
    with pytest.raises(ValueError, match="maximum size|Over cap"):
        apply_roster_edit(league["id"], workspace, "cut", team_id=home["id"],
            roster_status="active", validate_rules=rules,
            contract={"current_salary": 10, "base_salary": 10, "years_remaining": 1,
                      "contract_phase": "veteran"})
    assert storage.get_roster_slot(workspace, "cut", team_id=home["id"]) == before
    assert storage.league_cache_revisions(league["id"]) == revision


def test_commissioner_cannot_process_an_open_waiver_window_early(hub_db, monkeypatch):
    from app import hub_routes
    league, home, _, _ = league_pair()
    bid(league, home, "still-open", 4)
    monkeypatch.setattr(hub_routes, "_ctx", lambda sub: {"mode": "league", "league_id": league["id"],
        "is_commissioner": True, "acquisition_window": {"id": "waivers", "window_id": WINDOW}})
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "integrity-one", "auth_type": "dev"}
    try:
        response = TestClient(app).post("/api/hub/fa-market/process")
        assert response.status_code == 400, response.text
        assert "after the claim window closes" in response.json()["detail"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
    assert storage.list_fa_bids(league["id"], status=None)[0]["status"] == "open"
    assert not storage.list_team_roster(league["id"], home["id"])


def test_seeded_playoff_bracket_locks_season_settings(hub_db):
    league, home, away, rules = league_pair()
    storage.replace_week_matchups(league["id"], 2026, 15, [{"matchup_id": "playoff-r1-1-game-s1-s2",
        "home_team_id": home["id"], "away_team_id": away["id"]}])
    proposed = rules.model_copy(update={"regular_season_games": 13})
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "integrity-one", "auth_type": "dev"}
    try:
        response = TestClient(app).put("/api/hub/workspace", json={
            "league_id": league["id"], "rules": proposed.model_dump()})
        assert response.status_code == 409, response.text
        assert "bracket has been seeded" in response.json()["detail"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
    assert storage.get_league(league["id"])["rules"] == rules.model_dump()


@pytest.mark.parametrize("host", ["scoresense", "sleeper"])
def test_insights_overview_route_uses_final_native_or_official_sleeper_records(hub_db, monkeypatch, host):
    from app import hub_routes
    from src.draft_hub import league_history as history
    league, home, away, rules = league_pair(draft_type="snake")
    hub_routes._clear_insights_response_cache()
    history._CHAIN_CACHE.clear()
    history._SCORING_CACHE.clear()
    if host == "scoresense":
        storage.replace_week_matchups(league["id"], 2026, 1, [{"matchup_id": "week-one",
            "home_team_id": home["id"], "away_team_id": away["id"]}])
        storage.save_native_week_scores(league["id"], 2026, 1, [], [
            {"team_id": home["id"], "points": 21, "matchup_id": "week-one"},
            {"team_id": away["id"], "points": 10, "matchup_id": "week-one"}], rules.scoring.model_dump())
        storage.save_native_live_week(league["id"], 2026, 2, {"status": "live", "season": 2026, "week": 2,
            "teams": [{"team_id": home["id"], "points": 999}, {"team_id": away["id"], "points": 0}]})
    else:
        storage.update_league_sleeper_id(league["id"], "official-current")
        storage.upsert_sleeper_league_chain("official-current", [{"season": "2026", "league_id": "official-current"}])
        storage.upsert_sleeper_scoring_cache("official-current", {"available": True, "season": "2026",
            "sleeper_league_id": "official-current", "preseason": False, "weeks": [], "playoff": {},
            "standings": [{"roster_id": "1", "owner_id": "one", "team_name": "Official Alpha",
                "wins": 2, "losses": 0, "ties": 0, "points_for": 120.25, "points_against": 90,
                "total_points": 120.25, "avg_points": 120.25, "weeks_scored": 1},
                {"roster_id": "2", "owner_id": "two", "team_name": "Official Beta",
                "wins": 0, "losses": 2, "ties": 0, "points_for": 90, "points_against": 120.25,
                "total_points": 90, "avg_points": 90, "weeks_scored": 1}]})
    def unexpected_provider_call(*args, **kwargs):
        raise AssertionError("Saved Insights visits must not call the provider")
    monkeypatch.setattr(history, "_fetch_json", unexpected_provider_call)
    monkeypatch.setattr("src.integrations.sleeper_league.fetch_league", unexpected_provider_call)
    monkeypatch.setattr("src.integrations.sleeper_league.fetch_league_users", unexpected_provider_call)
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "integrity-one", "auth_type": "dev"}
    try:
        response = TestClient(app).get(f"/api/hub/league/{league['id']}/insights/overview")
        assert response.status_code == 200, response.text
        landing = response.json()["landing"]
        assert landing["available"] and landing["has_records"]
        first = landing["current_standings"][0]
        expected = (1, 0, 21, 10) if host == "scoresense" else (2, 0, 120.25, 90)
        assert (first["wins"], first["losses"], first["points_for"], first["points_against"]) == expected
        assert not landing["champions"]
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
        hub_routes._clear_insights_response_cache()
        history._CHAIN_CACHE.clear()
        history._SCORING_CACHE.clear()


@pytest.mark.parametrize("draft_type", ["auction", "snake", "linear"])
def test_multi_player_trade_exceeding_explicit_roster_limit_rolls_back(hub_db, draft_type):
    from src.draft_hub.trade_proposals import execute_multiparty_trade, validate_trade_package
    league, home, away, _ = league_pair(draft_type=draft_type, roster_size_max=2)
    workspace = storage.roster_workspace_for_league(league)
    for team, ids in [(home, ["home-stays", "home-sends"]), (away, ["away-first", "away-second"])]:
        for pid in ids:
            storage.add_roster_slot(workspace, player(pid), team_id=team["id"])
    parties = [{"team_id": home["id"], "sends": ["home-sends"]},
               {"team_id": away["id"], "sends": ["away-first", "away-second"]}]
    before = storage.list_workspace_roster_slots(workspace)
    revision = storage.league_cache_revisions(league["id"])
    preview = validate_trade_package(league["id"], parties)
    assert not preview["ok"] and any("maximum size" in error for error in preview["errors"])
    with pytest.raises(ValueError, match="maximum size"):
        execute_multiparty_trade(league["id"], parties)
    assert storage.list_workspace_roster_slots(workspace) == before
    assert storage.league_cache_revisions(league["id"]) == revision


def test_trade_transaction_rejects_changed_rules_and_preserves_all_rows(hub_db):
    league, home, away, stale = league_pair(roster_size_max=2)
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace, player("first"), team_id=home["id"])
    storage.add_roster_slot(workspace, player("second"), team_id=away["id"])
    storage.update_league_rules(league["id"], stale.model_copy(update={"roster_size_max": 1}))
    before = storage.list_workspace_roster_slots(workspace)
    revision = storage.league_cache_revisions(league["id"])
    with pytest.raises(ValueError, match="rules changed"):
        storage.apply_trade_plan(workspace, [
            {"player_id": "first", "from_team_id": home["id"], "team_id": away["id"]},
            {"player_id": "second", "from_team_id": away["id"], "team_id": home["id"]}],
            dead_cap_rules=stale)
    assert storage.list_workspace_roster_slots(workspace) == before
    assert storage.league_cache_revisions(league["id"]) == revision


@pytest.mark.parametrize("draft_type", ["snake", "linear"])
def test_non_salary_trade_ignores_legacy_salary_and_contract_costs(hub_db, draft_type):
    from src.draft_hub.trade_proposals import execute_multiparty_trade, validate_trade_package
    league, home, away, _ = league_pair(draft_type=draft_type, roster_size_max=1, salary_cap=1)
    workspace = storage.roster_workspace_for_league(league)
    for team, pid, salary in [(home, "first", 900), (away, "second", 800)]:
        storage.add_roster_slot(workspace, {**player(pid, salary=salary), "contract_years": 99}, team_id=team["id"])
    parties = [{"team_id": home["id"], "sends": ["first"]}, {"team_id": away["id"], "sends": ["second"]}]
    preview = validate_trade_package(league["id"], parties)
    assert preview["ok"], preview["errors"]
    execute_multiparty_trade(league["id"], parties)
    assert storage.get_roster_slot(workspace, "first")["team_id"] == away["id"]
    assert storage.get_roster_slot(workspace, "second")["team_id"] == home["id"]


def test_trade_stale_ownership_failure_rolls_back_an_earlier_move(hub_db):
    league, home, away, rules = league_pair()
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace, player("first"), team_id=home["id"])
    storage.add_roster_slot(workspace, player("second"), team_id=away["id"])
    before = storage.list_workspace_roster_slots(workspace)
    revision = storage.league_cache_revisions(league["id"])
    with pytest.raises(ValueError, match="Failed to move second"):
        storage.apply_trade_plan(workspace, [
            {"player_id": "first", "from_team_id": home["id"], "team_id": away["id"]},
            {"player_id": "second", "from_team_id": home["id"], "team_id": away["id"]}],
            dead_cap_rules=rules)
    assert storage.list_workspace_roster_slots(workspace) == before
    assert storage.league_cache_revisions(league["id"]) == revision


def test_trade_transaction_revalidates_a_new_destination_acquisition(hub_db, monkeypatch):
    from src.draft_hub.trade_proposals import execute_multiparty_trade
    league, home, away, rules = league_pair(roster_size_max=1)
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace, player("gift"), team_id=home["id"])
    apply = storage.apply_trade_plan
    def concurrent_acquisition(*args, **kwargs):
        # Another independently valid acquisition fills the destination after
        # the trade preview has succeeded and before its transaction starts.
        storage.add_roster_slot(workspace, player("new-award"), team_id=away["id"], validate_rules=rules)
        return apply(*args, **kwargs)
    monkeypatch.setattr(storage, "apply_trade_plan", concurrent_acquisition)
    with pytest.raises(ValueError, match="maximum size"):
        execute_multiparty_trade(league["id"], [{"team_id": home["id"], "sends": ["gift"]},
                                              {"team_id": away["id"], "sends": []}])
    assert storage.get_roster_slot(workspace, "gift")["team_id"] == home["id"]
    assert [row["player_id"] for row in storage.list_team_roster(league["id"], away["id"])] == ["new-award"]


def test_native_pick_manager_can_instant_add_without_a_salary_obligation(hub_db, monkeypatch):
    from zoneinfo import ZoneInfo
    from src.draft_hub.contracts import cap_hit
    league, _, away, _ = league_pair(draft_type="snake", salary_cap=1)
    player("instant")
    monkeypatch.setattr("src.draft_hub.acquisition_window._now_et",
                        lambda now=None: datetime(2026, 9, 10, 10, tzinfo=ZoneInfo("America/New_York")))
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "second-one", "auth_type": "dev"}
    try:
        response = TestClient(app).post("/api/hub/roster", json={
            "player_id": "instant", "player_name": "Instant Player", "team": "KC",
            "position": "WR", "salary": 99, "contract_years": 1})
        assert response.status_code == 200, response.text
        assert response.json()["slot"]["salary"] == 0
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
    row = storage.get_roster_slot(storage.roster_workspace_for_league(league), "instant")
    assert row["team_id"] == away["id"] and row["salary"] == 0
    assert cap_hit(row, 0) == 0
    assert not storage.list_fa_bids(league["id"], status=None)


@pytest.mark.parametrize("kind", ["cap", "position", "staff_override"])
def test_force_reassignment_validates_the_actual_carried_player(hub_db, monkeypatch, kind):
    from zoneinfo import ZoneInfo

    league, home, away, rules = league_pair(salary_cap=20 if kind != "position" else 200)
    if kind == "position":
        rules.roster["wr"]["max"] = 1
        storage.update_league_rules(league["id"], rules)
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace, player("carried", salary=19), team_id=home["id"])
    storage.add_roster_slot(workspace, player("existing", salary=10), team_id=away["id"])
    monkeypatch.setattr("src.draft_hub.acquisition_window._now_et",
                        lambda now=None: datetime(2026, 9, 10, 10, tzinfo=ZoneInfo("America/New_York")))
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "integrity-one", "auth_type": "dev"}
    try:
        response = TestClient(app).post("/api/hub/roster", json={
            "player_id": "carried", "player_name": "Carried", "team": "KC",
            "position": "K" if kind == "position" else "WR", "salary": 1,
            "contract_years": 1, "team_id": away["id"], "force": True,
            "staff_edit": kind == "staff_override"})
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
    carried = storage.get_roster_slot(workspace, "carried")
    if kind == "staff_override":
        assert response.status_code == 200, response.text
        assert carried["team_id"] == away["id"]
    else:
        assert response.status_code == 400, response.text
        assert carried["team_id"] == home["id"]
        expected = "Over cap" if kind == "cap" else "submitted position does not match"
        assert expected in response.text
    assert carried["salary"] == 19 and carried["position"] == "WR"


@pytest.mark.parametrize("changed", ["rules", "roster"])
def test_reassignment_transaction_checks_latest_destination_state(hub_db, changed):
    league, home, away, stale = league_pair(salary_cap=200, roster_size_max=1)
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace, player("carried", salary=19), team_id=home["id"])
    if changed == "rules":
        saved = stale.model_copy(deep=True)
        saved.salary_cap = 10
        storage.update_league_rules(league["id"], saved)
        expected = "Over cap"
    else:
        storage.add_roster_slot(workspace, player("late-award"), team_id=away["id"])
        expected = "maximum size"
    before = storage.list_workspace_roster_slots(workspace)
    revisions = storage.league_cache_revisions(league["id"])
    with pytest.raises(ValueError, match=expected):
        storage.move_roster_player(workspace, "carried", away["id"], validate_rules=stale)
    assert storage.list_workspace_roster_slots(workspace) == before
    assert storage.league_cache_revisions(league["id"]) == revisions


def test_reassignment_transaction_rejects_a_foreign_destination(hub_db):
    league, home, _, rules = league_pair()
    _, foreign, _, _ = league_pair(suffix="foreign")
    workspace = storage.roster_workspace_for_league(league)
    storage.add_roster_slot(workspace, player("carried"), team_id=home["id"])
    with pytest.raises(ValueError, match="does not belong"):
        storage.move_roster_player(workspace, "carried", foreign["id"], validate_rules=rules)
    assert storage.get_roster_slot(workspace, "carried")["team_id"] == home["id"]
