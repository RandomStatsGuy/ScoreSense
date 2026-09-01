"""Per-year owner to hub team name mapping."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.historic_insights import build_contract_analytics
from src.draft_hub.legacy_contract_history import import_legacy_files
from src.draft_hub.schemas import LeagueRules


def test_resolve_prefers_db_map_over_yaml(hub_db):
    league = storage.create_league("map-user", "Map League", 2025, LeagueRules())
    lid = league["id"]
    storage.upsert_owner_season_map(lid, 2021, "Aaron D", "Custom Team 2021", source_kind="manual")
    assert storage.resolve_hub_team_name(lid, 2021, "Aaron D") == "Custom Team 2021"


def test_ensure_seed_from_yaml(hub_db, monkeypatch):
    from src.draft_hub.legacy_contract_import import load_owner_team_map

    league = storage.create_league("seed-user", "Seed League", 2025, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season(
        lid,
        2022,
        [
            {
                "owner_label": "Aaron D",
                "player_name": "Player",
                "position": "QB",
                "cap_hit": 1.0,
                "roster_status": "active",
            }
        ],
    )
    yaml = load_owner_team_map()
    if not yaml:
        pytest.skip("manager_team_map.yaml missing")
    storage.ensure_owner_season_map_seeded(lid)
    rows = storage.list_owner_season_map(lid, season_year=2022)
    aaron = next((r for r in rows if r["owner_label"] == "Aaron D"), None)
    assert aaron is not None
    assert aaron["hub_team_name"] == yaml["Aaron D"]


def test_import_applies_owner_map(hub_db, monkeypatch):
    from pathlib import Path

    from src.config import OLD_LEAGUE_FILES_DIR

    if not OLD_LEAGUE_FILES_DIR.exists():
        pytest.skip("old_league_files not present")

    league = storage.create_league("imp-map", "Import Map", 2025, LeagueRules())
    lid = league["id"]
    storage.upsert_owner_season_map(lid, 2022, "Aaron D", "Mapped Aaron Team", source_kind="manual")

    result = import_legacy_files(lid, data_dir=OLD_LEAGUE_FILES_DIR, export_parquet=False)
    if 2022 not in result.get("seasons", []):
        pytest.skip("2022 sheet not parsed")

    rows = storage.list_league_contract_rows(lid, season_year=2022, owner_label="Aaron D")
    assert rows
    assert all(r.get("hub_team_name") == "Mapped Aaron Team" for r in rows)


def test_analytics_groups_by_mapped_team(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )
    league = storage.create_league("anal-map", "Analytics Map", 2025, LeagueRules())
    lid = league["id"]
    storage.upsert_owner_season_map(lid, 2024, "Aaron D", "Display Team", source_kind="manual")
    storage.replace_league_contract_season(
        lid,
        2024,
        [
            {
                "owner_label": "Aaron D",
                "hub_team_name": "Stale Name",
                "player_name": "QB One",
                "position": "QB",
                "cap_hit": 20.0,
                "roster_status": "active",
            }
        ],
    )
    analytics = build_contract_analytics(lid, season_year=2024)
    assert analytics is not None
    teams = {t["team_name"] for t in analytics["teams"]}
    assert "Display Team" in teams
    assert "Stale Name" not in teams


def test_contract_awards_use_owner_season_map(hub_db, monkeypatch):
    from src.draft_hub.historic_insights import build_contract_awards

    monkeypatch.setattr(
        "src.draft_hub.contract_rows_merged.load_commissioner_rows_by_season",
        lambda: {},
    )
    league = storage.create_league("award-map", "Award Map", 2025, LeagueRules())
    lid = league["id"]
    storage.upsert_owner_season_map(lid, 2025, "Aaron D", "2025 Aaron Team", source_kind="manual")
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Aaron D",
                "hub_team_name": "Thanks noob noob",
                "player_name": "T. Hill",
                "position": "WR",
                "cap_hit": 39.0,
                "roster_status": "active",
            },
            {
                "owner_label": "Chris G",
                "hub_team_name": "516-74-3927",
                "player_name": "T. Allgeier",
                "position": "RB",
                "cap_hit": 2.0,
                "roster_status": "active",
            },
        ],
    )
    awards = build_contract_awards(lid, season_year=2025)
    bag = next(a for a in awards if a["id"] == "highest_paid")
    assert bag["display_name"] == "Aaron D · 2025 Aaron Team"
    assert bag["team_name"] == "2025 Aaron Team"
    payroll = next(a for a in awards if a["id"] == "payroll_king")
    assert payroll["display_name"] == "Aaron D · 2025 Aaron Team"


def test_scoring_owner_map_contracts_beat_yaml_seed(hub_db):
    from src.draft_hub.owner_display import scoring_owner_maps_for_league

    league = storage.create_league("yaml-vs-sheet", "Yaml vs Sheet", 2025, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Aaron D",
                "hub_team_name": "Thanks noob noob",
                "player_name": "Player A",
                "position": "QB",
                "cap_hit": 1.0,
                "roster_status": "active",
            },
            {
                "owner_label": "Josh C",
                "hub_team_name": "Disappointment",
                "player_name": "Player B",
                "position": "RB",
                "cap_hit": 1.0,
                "roster_status": "active",
            },
        ],
    )
    storage.ensure_owner_season_map_seeded(lid)
    team_map, _ = scoring_owner_maps_for_league(lid, season_year=2025)
    assert team_map["Thanks noob noob"] == "Aaron D"
    assert team_map["Disappointment"] == "Josh C"


def test_scoring_owner_map_falls_back_to_latest_sheet_year(hub_db):
    from src.draft_hub.owner_display import scoring_owner_maps_for_league

    league = storage.create_league("plan-year", "Planning Year", 2026, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Caleb K",
                "hub_team_name": "White Supremacists",
                "player_name": "QB One",
                "position": "QB",
                "cap_hit": 10.0,
                "roster_status": "active",
            },
        ],
    )
    team_map, _ = scoring_owner_maps_for_league(lid, season_year=2026)
    assert team_map["White Supremacists"] == "Caleb K"


def test_list_league_teams_attaches_owner_name(hub_db):
    league = storage.create_league("owner-teams", "Owner Teams", 2025, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Caleb K",
                "hub_team_name": "White Supremacists",
                "player_name": "QB One",
                "position": "QB",
                "cap_hit": 10.0,
                "roster_status": "active",
            },
        ],
    )
    storage.join_league("ck-owner", league["room_code"], "White Supremacists")
    hist0 = storage.league_cache_revisions(lid)["historic_snapshot_revision"]
    teams = storage.list_league_teams(lid)
    hit = next(t for t in teams if t["name"] == "White Supremacists")
    assert hit["owner_name"] == "Caleb K"
    # Attaching owner names can seed the map, but seed writes must not bump.
    assert storage.league_cache_revisions(lid)["historic_snapshot_revision"] == hist0


def test_contract_seed_does_not_bump_historic_revision(hub_db):
    league = storage.create_league("seed-rev", "Seed Rev", 2026, LeagueRules())
    lid = league["id"]
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Team A",
                "hub_team_name": "Alpha",
                "player_name": "QB One",
                "position": "QB",
                "cap_hit": 10.0,
                "roster_status": "active",
            },
        ],
    )
    hist0 = storage.league_cache_revisions(lid)["historic_snapshot_revision"]
    storage.ensure_owner_season_map_seeded(lid)
    assert storage.league_cache_revisions(lid)["historic_snapshot_revision"] == hist0
    rows = storage.list_owner_season_map(lid, season_year=2025)
    hit = next((r for r in rows if r["owner_label"] == "Team A"), None)
    assert hit is not None
    assert hit["source_kind"] == "contract_seed"
    assert hit["hub_team_name"] == "Alpha"


def test_scoring_owner_map_prefers_season_map_over_contract_rows(hub_db):
    from src.draft_hub.owner_display import scoring_owner_maps_for_league

    league = storage.create_league("score-map", "Score Map", 2025, LeagueRules())
    lid = league["id"]
    storage.upsert_owner_season_map(
        lid, 2025, "Aaron D", "Disappointment", source_kind="manual"
    )
    storage.upsert_owner_season_map(
        lid, 2025, "Josh C", "Thanks noob noob", source_kind="manual"
    )
    storage.replace_league_contract_season(
        lid,
        2025,
        [
            {
                "owner_label": "Aaron D",
                "hub_team_name": "Thanks noob noob",
                "player_name": "Player A",
                "position": "QB",
                "cap_hit": 1.0,
                "roster_status": "active",
            },
            {
                "owner_label": "Josh C",
                "hub_team_name": "Disappointment",
                "player_name": "Player B",
                "position": "RB",
                "cap_hit": 1.0,
                "roster_status": "active",
            },
        ],
    )
    team_map, _ = scoring_owner_maps_for_league(lid, season_year=2025)
    assert team_map["Disappointment"] == "Aaron D"
    assert team_map["Thanks noob noob"] == "Josh C"


def test_owner_map_api_crud(hub_db):
    league = storage.create_league("api-map", "API Map", 2025, LeagueRules())
    lid = league["id"]

    def _user():
        return {"sub": "api-map", "auth_type": "dev"}

    app.dependency_overrides[require_hub_user] = _user
    client = TestClient(app)
    try:
        put = client.put(
            f"/api/hub/league/{lid}/owner-season-map",
            json={"season_year": 2023, "owner_label": "Josh C", "hub_team_name": "Josh Team"},
        )
        assert put.status_code == 200
        assert put.json()["hub_team_name"] == "Josh Team"

        listing = client.get(f"/api/hub/league/{lid}/owner-season-map?season=2023")
        assert listing.status_code == 200
        assert len(listing.json()["rows"]) == 1

        map_id = listing.json()["rows"][0]["id"]
        deleted = client.delete(f"/api/hub/league/{lid}/owner-season-map/{map_id}")
        assert deleted.status_code == 200
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
