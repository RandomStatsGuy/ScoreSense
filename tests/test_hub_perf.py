"""Draft Hub performance paths — fast roster reads and value overlay cache."""

from __future__ import annotations

import pytest

from src.draft_hub.hub_context import list_roster_for_context, resolve_hub_context
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.value_sheet import build_draft_pool_payload, peek_pool_payload_cache


@pytest.fixture
def hub_client():
    from fastapi.testclient import TestClient
    from app.api import app

    return TestClient(app)


def test_list_roster_skips_live_sleeper_by_default(hub_db, monkeypatch):
    calls: list[str] = []

    def _boom(*_a, **_k):
        calls.append("live")
        raise AssertionError("live sleeper should not run on default roster read")

    monkeypatch.setattr(
        "src.draft_hub.league_sleeper_sync.compose_team_roster_from_live_snapshot",
        _boom,
    )
    monkeypatch.setattr(
        "src.draft_hub.hub_context._maybe_reconcile_league_rosters",
        lambda _ctx: calls.append("reconcile"),
    )

    from src.draft_hub import storage

    league = storage.create_league(
        "comm",
        name="Perf League",
        season=2026,
        rules=LeagueRules(),
        team_count=10,
    )
    team = storage.get_team_by_user(league["id"], "comm")
    storage.update_team_sleeper_link(
        str(team["id"]),
        sleeper_roster_id="r1",
        sleeper_team_name="T1",
        sleeper_player_ids=["p1"],
    )
    ctx = resolve_hub_context("comm")
    roster = list_roster_for_context(ctx)
    assert isinstance(roster, list)
    assert "live" not in calls
    assert "reconcile" not in calls


def test_value_overlay_requires_warm_pool(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    from src.draft_hub.value_sheet import invalidate_pool_payload_cache

    invalidate_pool_payload_cache()
    res = hub_client.get("/api/hub/value-overlay")
    assert res.status_code == 503

    warm = hub_client.get("/api/hub/draft-pool")
    assert warm.status_code == 200

    res2 = hub_client.get("/api/hub/value-overlay")
    assert res2.status_code == 200
    body = res2.json()
    assert "rows" in body
    assert body.get("hub_context")


def test_peek_pool_payload_cache_after_build(hub_db):
    from src.draft_hub.value_sheet import invalidate_pool_payload_cache

    invalidate_pool_payload_cache()
    rules = LeagueRules()
    payload = build_draft_pool_payload(2026, rules, [], team_count=12)
    cached = peek_pool_payload_cache(2026, rules, [], team_count=12)
    assert cached is not None
    assert cached["count"] == payload["count"]


def test_roster_and_cap_sheet_api_skip_sleeper_fetch(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    sleeper_calls: list[str] = []

    def _boom(*_a, **_k):
        sleeper_calls.append("fetch")
        raise AssertionError("Sleeper fetch on read path")

    monkeypatch.setattr("src.integrations.sleeper_league.fetch_linked_roster", _boom)
    monkeypatch.setattr("src.integrations.sleeper_league.fetch_all_linked_rosters", _boom)
    monkeypatch.setattr("src.draft_hub.league_sleeper_sync.fetch_team_snapshot_cached", _boom)

    roster_res = hub_client.get("/api/hub/roster")
    assert roster_res.status_code == 200
    cap_res = hub_client.get("/api/hub/cap-sheet")
    assert cap_res.status_code == 200
    assert sleeper_calls == []


def test_hub_timing_header_when_enabled(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    monkeypatch.setattr("src.draft_hub.timing.HUB_TIMING", True)
    res = hub_client.get("/api/hub/workspace")
    assert res.status_code == 200
    assert "X-Hub-Timing-MS" in res.headers


def test_insights_serves_cached_scoring_without_live_sleeper(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    from src.draft_hub import storage

    league = storage.create_league("dev", "Cache League", 2026, LeagueRules())
    storage.update_league_sleeper_id(league["id"], "sl-cache-test")
    storage.upsert_sleeper_scoring_cache(
        "sl-cache-test",
        {"available": True, "standings": [], "weeks": [], "season": "2026"},
    )

    def _boom(*_a, **_k):
        raise AssertionError("live scoring fetch on cached insights read")

    monkeypatch.setattr("src.draft_hub.league_history.build_sleeper_scoring_history", _boom)

    res = hub_client.get(f"/api/hub/league/{league['id']}/insights")
    assert res.status_code == 200
    scoring = res.json()["scoring"]
    assert scoring["available"] is True
    assert scoring.get("cached") is True


def test_insights_cap_section_skips_scoring(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    scoring_calls: list[str] = []

    def _track_scoring(*_a, **_k):
        scoring_calls.append("scoring")
        raise AssertionError("scoring should not run for sections=cap")

    monkeypatch.setattr(
        "src.draft_hub.league_history.get_sleeper_scoring_history",
        _track_scoring,
    )
    from src.draft_hub import storage

    league = storage.create_league("dev", "Cap Only League", 2026, LeagueRules())
    storage.update_league_sleeper_id(league["id"], "sl-cap-only")
    res = hub_client.get(f"/api/hub/league/{league['id']}/insights?sections=cap")
    assert res.status_code == 200
    assert scoring_calls == []
    body = res.json()
    assert body["analytics"]["teams"] is not None
    assert body["scoring"]["reason"] == "not_loaded"


def test_insights_sections_skips_unrequested_blocks(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    trade_calls: list[str] = []

    def _track_trade(*_a, **_k):
        trade_calls.append("trade")
        return {"suggestions": [], "partners": [], "balance": {}}

    monkeypatch.setattr("src.draft_hub.trade_insights.build_trade_insights", _track_trade)
    from src.draft_hub import storage

    league = storage.create_league("dev", "Sections League", 2026, LeagueRules())
    storage.update_league_sleeper_id(league["id"], "sl-sections-test")
    storage.upsert_sleeper_scoring_cache(
        "sl-sections-test",
        {"available": True, "standings": [], "weeks": [], "season": "2026"},
    )

    res = hub_client.get(f"/api/hub/league/{league['id']}/insights?sections=scoring")
    assert res.status_code == 200
    body = res.json()
    assert body["scoring"]["available"] is True
    assert trade_calls == []
    assert body["trade"]["suggestions"] == []


def test_insights_ownership_only_skips_scoring(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    scoring_calls: list[str] = []

    def _track_scoring(*_a, **_k):
        scoring_calls.append("scoring")
        raise AssertionError("scoring should not run for ownership_only")

    monkeypatch.setattr(
        "src.draft_hub.league_history.get_sleeper_scoring_history",
        _track_scoring,
    )
    from src.draft_hub import storage

    league = storage.create_league("dev", "Ownership League", 2026, LeagueRules())
    res = hub_client.get(
        f"/api/hub/league/{league['id']}/insights?ownership_only=1",
    )
    assert res.status_code == 200
    assert scoring_calls == []
    assert "players" in res.json()


def test_insights_cap_route_skips_sleeper_scoring(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    scoring_calls: list[str] = []

    def _track(*_a, **_k):
        scoring_calls.append("hit")
        raise AssertionError("Sleeper scoring on cap-only route")

    monkeypatch.setattr("src.draft_hub.league_history.build_sleeper_scoring_history", _track)
    from src.draft_hub import storage

    league = storage.create_league("dev", "Cap Route League", 2026, LeagueRules())
    res = hub_client.get(f"/api/hub/league/{league['id']}/insights/cap")
    assert res.status_code == 200
    assert scoring_calls == []
    body = res.json()
    assert body["analytics"]["teams"] is not None
    assert "cache_status" in body


def test_insights_cap_builds_analytics_once(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    import app.hub_routes as hub_routes
    from src.draft_hub import storage
    from src.draft_hub.historic_insights import build_current_spend_awards as orig_awards

    hub_routes._INSIGHTS_RESPONSE_CACHE.clear()
    analytics_passed: list[object] = []

    def _track_awards(overview, **kwargs):
        analytics_passed.append(kwargs.get("analytics"))
        return orig_awards(overview, **kwargs)

    monkeypatch.setattr(
        "src.draft_hub.historic_insights.build_current_spend_awards",
        _track_awards,
    )
    analytics_calls: list[str] = []

    def _track_analytics(overview, **kwargs):
        analytics_calls.append("analytics")
        from src.draft_hub.league_analytics import build_league_analytics

        return build_league_analytics(overview, **kwargs)

    monkeypatch.setattr("app.hub_routes.build_league_analytics", _track_analytics)

    league = storage.create_league("dev", "Dedupe League", 2026, LeagueRules())
    storage.delete_insights_cap_cache(league["id"])
    res = hub_client.get(f"/api/hub/league/{league['id']}/insights/cap")
    assert res.status_code == 200
    assert len(analytics_calls) == 1
    assert len(analytics_passed) == 1
    assert analytics_passed[0] is not None


def test_insights_trades_skips_draft_pool_when_fair_values_cached(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    pool_calls: list[str] = []

    def _boom(*_a, **_k):
        pool_calls.append("pool")
        raise AssertionError("draft pool on trades read with fair snapshot")

    monkeypatch.setattr("src.draft_hub.value_sheet._load_draft_pool", _boom)
    from src.draft_hub import storage
    from src.draft_hub.insights_cache import _fair_fingerprint

    league = storage.create_league("dev", "Trades Cache League", 2026, LeagueRules())
    storage.upsert_insights_fair_values(
        league["id"],
        2026,
        {"p1": 12.5, "p2": 8.0},
        pool_fingerprint=_fair_fingerprint(),
    )
    res = hub_client.get(f"/api/hub/league/{league['id']}/insights/trades")
    assert res.status_code == 200
    assert pool_calls == []
    assert res.json().get("cache_status", {}).get("fair_values") == "hit"


def test_insights_status_endpoint(hub_client, hub_db, monkeypatch):
    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    from src.draft_hub import storage

    league = storage.create_league("dev", "Status League", 2026, LeagueRules())
    storage.update_league_sleeper_id(league["id"], "sl-status")
    storage.upsert_sleeper_scoring_cache(
        "sl-status",
        {"available": True, "standings": [], "weeks": [], "season": "2026"},
    )
    res = hub_client.get(f"/api/hub/league/{league['id']}/insights/status")
    assert res.status_code == 200
    body = res.json()
    assert body["scoring"] == "hit"
    assert "source_version" in body


def test_insights_cached_scoring_section_under_budget(hub_client, hub_db, monkeypatch):
    import time

    monkeypatch.setattr("app.auth.hub_auth_enabled", lambda: False)
    from src.draft_hub import storage

    league = storage.create_league("dev", "Timing League", 2026, LeagueRules())
    storage.update_league_sleeper_id(league["id"], "sl-timing")
    storage.upsert_sleeper_scoring_cache(
        "sl-timing",
        {
            "available": True,
            "standings": [{"team_name": "A", "total_points": 100}],
            "weeks": [{"week": 1, "teams": []}],
            "season": "2026",
        },
    )
    t0 = time.perf_counter()
    res = hub_client.get(f"/api/hub/league/{league['id']}/insights/scoring")
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert res.status_code == 200
    assert res.json()["scoring"]["available"] is True
    assert elapsed_ms < 5000, f"cached scoring insights too slow: {elapsed_ms:.0f}ms"
