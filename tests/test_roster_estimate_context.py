from src.draft_hub import storage
from src.draft_hub.roster_overview_enrich import enrich_league_roster_overview
from src.draft_hub.schemas import LeagueRules


def test_estimate_status_distinguishes_projection_minimum_and_missing():
    rules = LeagueRules()
    rules.auction.min_bid = 3
    overview = {"league": {"season": 2026, "rules": rules.model_dump()}, "teams": [
        {"team": {"id": "a"}, "roster": [
            {"player_id": pid, "salary": 12, "contract_years": 2, "position": "TE"}
            for pid in ["projection", "floor", "missing"]
        ]}
    ]}
    result = enrich_league_roster_overview(overview, fair_map={"projection": 20, "floor": 3})
    rows = result["teams"][0]["roster"]
    assert [r["estimate_status"] for r in rows] == ["projection", "minimum_bid", "unavailable"]
    assert [r["value_delta"] for r in rows] == [-8, None, None]
    assert result["estimate_context"] == {"season": 2026, "minimum_bid": 3}


def test_snapshot_time_is_scoped_to_league_season_and_current_fingerprint(hub_db, monkeypatch):
    monkeypatch.setattr(storage, "_utcnow", lambda: "2026-09-15T13:04:00Z")
    storage.upsert_insights_fair_values("a", 2026, {"p": 20}, pool_fingerprint="current")
    assert storage.get_insights_fair_values_built_at("a", 2026, "current") == "2026-09-15T13:04:00Z"
    assert storage.get_insights_fair_values_built_at("a", 2026, "old") is None
    assert storage.get_insights_fair_values_built_at("b", 2026, "current") is None
    assert storage.get_insights_fair_values_built_at("a", 2025, "current") is None
