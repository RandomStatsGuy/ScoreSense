"""Saved Insights visits must work with Sleeper entirely unavailable."""
import pytest
from fastapi.testclient import TestClient
from app.api import app
from app.auth import require_hub_user
from app import hub_routes
from src.draft_hub import storage, league_history as history
from src.draft_hub.schemas import LeagueRules


@pytest.fixture
def saved_history(hub_db, monkeypatch):
    league = storage.create_league("insights-owner", "History", 2026, LeagueRules())
    lid = league["id"]
    storage.join_league("insights-owner", league["room_code"], "New name")
    storage.update_league_sleeper_id(lid, "current")
    chain = [{"season": "2026", "league_id": "current"}, {"season": "2025", "league_id": "prior"}]
    storage.upsert_sleeper_league_chain("current", chain)
    for year, provider, name in [(2025, "prior", "Old name"), (2026, "current", "New name")]:
        rows = [{"roster_id": str(i), "owner_id": f"u{i}", "owner_name": f"Manager {i}",
                 "team_name": name if i == 1 else "Same nickname", "wins": 3, "losses": 1,
                 "total_points": 200 + i, "weeks_scored": 4} for i in range(1, 16)]
        storage.upsert_sleeper_scoring_cache(provider, {
            "available": True, "season": str(year), "sleeper_league_id": provider,
            "standings": rows, "weeks": [], "preseason": False,
            "playoff": {"champion_team_name": name, "champion_owner_id": "u1", "champion_roster_id": "1"},
        })
    # Expiration cannot turn a page visit into a provider refresh.
    with storage.get_conn() as conn:
        conn.execute("UPDATE sleeper_scoring_cache SET synced_at = '2000-01-01T00:00:00+00:00'")
    history._CHAIN_CACHE.clear()
    hub_routes._clear_insights_response_cache()
    def forbidden(*args, **kwargs):
        pytest.fail("A saved Insights read contacted Sleeper or rebuilt rosters")
    monkeypatch.setattr(history, "_fetch_json", forbidden)
    monkeypatch.setattr("src.integrations.sleeper_league.fetch_league", forbidden)
    monkeypatch.setattr("src.integrations.sleeper_league.fetch_league_users", forbidden)
    monkeypatch.setattr("src.integrations.sleeper_league.fetch_league_rosters", forbidden)
    yield lid, league["room_code"]
    hub_routes._clear_insights_response_cache()
    history._CHAIN_CACHE.clear()


def test_stale_scoring_and_lineage_survive_process_restart(saved_history):
    out = history.get_sleeper_scoring_history("current", scoring_season="2025", cached_only=True)
    assert out["cached"] and out["stale"]
    assert out["standings"][0]["team_name"] == "Old name"
    assert out["standings"][0]["owner_id"] == "u1"
    assert out["available_seasons"] == ["2026", "2025"]


def test_all_time_uses_owner_ids_and_keeps_every_manager(saved_history):
    landing = history.build_insights_landing("current", cached_only=True)
    assert len(landing["record_leaders"]) == 15
    assert len(landing["scoring_leaders"]) == 15
    winner = next(r for r in landing["record_leaders"] if r["owner_id"] == "u1")
    assert winner["wins"] == 6 and winner["team_name"] == "New name"
    scoring = history.get_sleeper_scoring_history("current", scoring_season="all", cached_only=True)
    assert len(scoring["standings"]) == 15
    assert next(r for r in scoring["standings"] if r["owner_id"] == "u1")["total_points"] == 402


def test_overview_does_not_rebuild_rosters_and_cache_retains_viewer_access(saved_history, monkeypatch):
    lid, room = saved_history
    def forbidden(*args, **kwargs):
        pytest.fail("Overview rebuilt all league rosters")
    monkeypatch.setattr(storage, "league_roster_overview", forbidden)
    user = {"sub": "insights-owner"}
    app.dependency_overrides[require_hub_user] = lambda: user
    try:
        with TestClient(app) as client:
            url = f"/api/hub/league/{lid}/insights/overview"
            first = client.get(url)
            assert first.status_code == 200, first.text
            assert first.json()["landing"]["most_titles"]["owner_name"] == "Manager 1"
            assert len(first.json()["landing"]["record_leaders"]) == 15
            storage.join_league("insights-member", room, "Other team")
            user["sub"] = "insights-member"
            second = client.get(url)
            assert second.status_code == 200
            assert second.json()["hub_context"]["team_id"] != first.json()["hub_context"]["team_id"]
            user["sub"] = "insights-outsider"
            assert client.get(url).status_code == 403
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_missing_saved_season_returns_refresh_hint_without_fetching(saved_history):
    with storage.get_conn() as conn:
        conn.execute("DELETE FROM sleeper_scoring_cache WHERE sleeper_league_id = 'prior'")
    out = history.get_sleeper_scoring_history("current", scoring_season="2025", cached_only=True)
    assert not out["available"] and out["reason"] == "not_synced"
    assert history.build_insights_landing("current", cached_only=True)["partial"]


def test_latest_exact_nickname_beats_a_former_fuzzy_match(saved_history):
    from src.draft_hub.owner_display import scoring_owner_maps_for_league
    lid, _ = saved_history
    for provider, name in [("prior", "Crushing Disappointment"), ("current", "Panda Fraud")]:
        p = storage.get_sleeper_scoring_cache(provider)["payload"]
        p["standings"][0].update(team_name=name, owner_name="")
        storage.upsert_sleeper_scoring_cache(provider, p)
    _, owners = scoring_owner_maps_for_league(lid, season_year="all", sleeper_league_id="current", cached_only=True)
    assert owners["u1"] == "Andrew M"


def test_historic_nickname_fallback_cannot_replace_saved_manager_identity(saved_history, monkeypatch):
    from src.draft_hub.owner_display import scoring_owner_maps_for_league, enrich_team_row
    lid, _ = saved_history
    monkeypatch.setattr("src.draft_hub.historic_insights.list_history_seasons", lambda league_id: [2025, 2026])
    monkeypatch.setattr(storage, "list_owner_season_map", lambda *args, **kwargs: [
        {"owner_label": "Old name", "hub_team_name": "Old name", "sleeper_user_id": "u1"}
    ])
    monkeypatch.setattr(storage, "list_league_contract_rows", lambda *args, **kwargs: [])
    prior = storage.get_sleeper_scoring_cache("prior")["payload"]
    prior["standings"][0]["owner_name"] = "Old name"
    storage.upsert_sleeper_scoring_cache("prior", prior)
    teams, owners = scoring_owner_maps_for_league(lid, season_year=2025, sleeper_league_id="current", cached_only=True)
    row = enrich_team_row(prior["standings"][0], teams, sleeper_owner_map=owners, year_specific=True)
    assert row["owner_name"] == "Manager 1"
    assert row["display_name"] == "Manager 1 · Old name"


def test_workspace_can_bundle_the_saved_overview_without_a_second_page_request(saved_history):
    lid, _ = saved_history
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "insights-owner"}
    try:
        with TestClient(app) as client:
            res = client.get("/api/hub/workspace?insights_overview=1")
            assert res.status_code == 200, res.text
            assert res.json()["insights_overview"]["hub_context"]["league_id"] == lid
            assert res.json()["insights_overview"]["landing"]["available"]
            assert "insights_overview" not in client.get("/api/hub/workspace").json()
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
