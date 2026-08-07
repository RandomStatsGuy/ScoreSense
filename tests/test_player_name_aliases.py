"""League player name alias storage and matching."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.auth import require_hub_user
from src.draft_hub import storage
from src.draft_hub.player_name_aliases import (
    alias_meta_by_name_key,
    enrich_row_with_alias,
    load_alias_map,
    looks_like_abbrev,
    prepare_alias_upsert,
    resolve_player_name,
    suggest_canonical_names,
)
from src.draft_hub.salary_sheet_audit import build_salary_sheet_audit
from src.draft_hub.schemas import LeagueRules


def test_upsert_and_resolve_alias(hub_db):
    league = storage.create_league("alias-user", "Alias League", 2025, LeagueRules())
    lid = league["id"]
    storage.upsert_player_name_alias(lid, "Jeanty", "Ashton Jeanty", position="RB")
    alias_map = load_alias_map(lid)
    assert resolve_player_name("Jeanty", alias_map) == "Ashton Jeanty"
    assert resolve_player_name("Ashton Jeanty", alias_map) == "Ashton Jeanty"


def test_draft_win_without_alias_still_missing(hub_db, monkeypatch):
    from src.draft_hub import salary_sheet_audit as audit_mod

    league = storage.create_league("no-alias", "No Alias", 2025, LeagueRules())
    lid = league["id"]

    file_rows = {
        2025: [
            {
                "owner_label": "Caleb K",
                "player_name": "Jeanty",
                "position": "RB",
                "cap_hit": 20,
                "roster_status": "active",
            },
        ],
    }
    wins = {
        2025: [
            {
                "owner_label": "Caleb K",
                "player_name": "Ashton Jeanty",
                "position": "RB",
                "cap_hit": 25,
            },
        ],
    }
    monkeypatch.setattr(audit_mod, "_load_commissioner_rows_by_season", lambda: file_rows)
    monkeypatch.setattr(audit_mod, "_load_database_overlay_rows_by_season", lambda _lid: {})
    monkeypatch.setattr(audit_mod, "load_draft_wins_by_season", lambda: (wins, {}))

    payload = build_salary_sheet_audit(lid, season_year=2025)
    assert payload["missing_count"] == 1
    assert payload["missing_by_owner"]["Caleb K"][0]["player_name"] == "Ashton Jeanty"


def test_draft_win_matches_aliased_sheet_name(hub_db, monkeypatch):
    from src.draft_hub import salary_sheet_audit as audit_mod

    league = storage.create_league("alias-draft", "Alias Draft", 2025, LeagueRules())
    lid = league["id"]
    storage.upsert_player_name_alias(lid, "Jeanty", "Ashton Jeanty", position="RB")

    file_rows = {
        2025: [
            {
                "owner_label": "Caleb K",
                "player_name": "Jeanty",
                "position": "RB",
                "cap_hit": 20,
                "roster_status": "active",
            },
        ],
    }
    wins = {
        2025: [
            {
                "owner_label": "Caleb K",
                "player_name": "Ashton Jeanty",
                "position": "RB",
                "cap_hit": 20,
            },
        ],
    }
    monkeypatch.setattr(audit_mod, "_load_commissioner_rows_by_season", lambda: file_rows)
    monkeypatch.setattr(audit_mod, "_load_database_overlay_rows_by_season", lambda _lid: {})
    monkeypatch.setattr(audit_mod, "load_draft_wins_by_season", lambda: (wins, {}))

    payload = build_salary_sheet_audit(lid, season_year=2025)
    assert payload["missing_count"] == 0


def test_suggest_canonical_names_last_name(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.player_name_aliases.search_players",
        lambda query, **kwargs: [
            {
                "player_name": "Ashton Jeanty",
                "position": "RB",
                "team": "LV",
                "sleeper_player_id": "12345",
                "source": "sleeper",
            }
        ] if query.lower().startswith("jean") else [],
    )
    monkeypatch.setattr(
        "src.draft_hub.player_name_aliases._collect_sheet_names",
        lambda: [{"player_name": "Josh Allen", "position": "QB"}],
    )
    monkeypatch.setattr(
        "src.draft_hub.player_name_aliases.load_draft_pool",
        lambda *_a, **_k: __import__("pandas").DataFrame(),
    )
    out = suggest_canonical_names("Jeanty", position="RB", season=2025)
    assert out
    assert out[0]["player_name"] == "Ashton Jeanty"
    assert out[0]["sleeper_player_id"] == "12345"
    assert out[0]["source"] == "sleeper"


def test_prepare_alias_upsert_from_sleeper_id(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.player_name_aliases.player_by_sleeper_id",
        lambda sid: {
            "sleeper_player_id": sid,
            "player_name": "Ashton Jeanty",
            "position": "RB",
            "team": "LV",
        },
    )
    from src.draft_hub.player_name_aliases import prepare_alias_upsert

    fields = prepare_alias_upsert("Jeanty", sleeper_player_id="12345")
    assert fields["canonical_name"] == "Ashton Jeanty"
    assert fields["sleeper_player_id"] == "12345"
    assert fields["position"] == "RB"


def test_prior_owner_fields_from_cap_sheet(hub_db, monkeypatch):
    from src.draft_hub.player_name_aliases import (
        _build_cap_sheet_name_refs,
        _prior_owner_fields,
        find_unmapped_names,
    )

    league = storage.create_league("prior-owner", "Prior Owner", 2025, LeagueRules())
    lid = league["id"]

    file_rows = {
        2024: [
            {
                "owner_label": "Aaron D",
                "hub_team_name": "Aaron Team 2024",
                "player_name": "Jeanty",
                "position": "RB",
                "cap_hit": 10,
                "roster_status": "active",
            },
        ],
        2025: [
            {
                "owner_label": "Caleb K",
                "hub_team_name": "Caleb Team 2025",
                "player_name": "Jeanty",
                "position": "RB",
                "cap_hit": 12,
                "roster_status": "active",
            },
        ],
    }
    monkeypatch.setattr(
        "src.draft_hub.player_name_aliases._load_commissioner_rows_by_season",
        lambda: file_rows,
    )
    monkeypatch.setattr(
        "src.draft_hub.player_name_aliases.search_players",
        lambda *_a, **_k: [{"player_name": "Ashton Jeanty", "position": "RB", "source": "sleeper"}],
    )

    refs = _build_cap_sheet_name_refs(lid)
    pk_fields = _prior_owner_fields(list(refs.values())[0], 2025)
    assert pk_fields["prior_season"] == 2024
    assert pk_fields["prior_owner_label"] == "Aaron D"

    unmapped = find_unmapped_names(lid, season=2025)
    jeanty = next(u for u in unmapped if u["alias_name"] == "Jeanty")
    assert jeanty["prior_owner_label"] == "Aaron D"
    assert jeanty["prior_season"] == 2024


def test_player_name_alias_api(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.player_name_aliases.find_unmapped_names",
        lambda *_a, **_k: [],
    )
    league = storage.create_league("alias-api", "Alias API", 2025, LeagueRules())
    lid = league["id"]
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "alias-api", "auth_type": "dev"}
    try:
        client = TestClient(app)
        put = client.put(
            f"/api/hub/league/{lid}/player-name-aliases",
            json={
                "alias_name": "Jeanty",
                "canonical_name": "Ashton Jeanty",
                "sleeper_player_id": "99999",
                "position": "RB",
            },
        )
        assert put.status_code == 200
        assert put.json()["canonical_name"] == "Ashton Jeanty"
        assert put.json()["sleeper_player_id"] == "99999"

        listed = client.get(f"/api/hub/league/{lid}/player-name-aliases")
        assert listed.status_code == 200
        assert len(listed.json()["rows"]) == 1

        alias_id = listed.json()["rows"][0]["id"]
        deleted = client.delete(f"/api/hub/league/{lid}/player-name-aliases/{alias_id}")
        assert deleted.status_code == 200
    finally:
        app.dependency_overrides.pop(require_hub_user, None)


def test_looks_like_abbrev_includes_initials_and_defenses():
    assert looks_like_abbrev("Jeanty")
    assert looks_like_abbrev("J. Williams")
    assert looks_like_abbrev("DK Metcalf")
    assert looks_like_abbrev("DJ Moore")
    assert looks_like_abbrev("Bills DST")
    assert not looks_like_abbrev("Josh Allen")


def test_enrich_row_with_alias_applies_position_for_weak_sheet_pos(hub_db):
    league = storage.create_league("alias-pos", "Alias Pos", 2025, LeagueRules())
    lid = league["id"]
    storage.upsert_player_name_alias(
        lid,
        "Washington DEF",
        "Commanders",
        position="DEF",
        sleeper_player_id="WAS",
    )
    meta = alias_meta_by_name_key(lid)
    row = enrich_row_with_alias({"player_name": "Washington DEF", "position": "NAN"}, meta)
    assert row["position"] == "DEF"
    assert row["name_mapped"] is True


def test_enrich_row_with_alias_marks_same_name_maps(hub_db):
    league = storage.create_league("same-name", "Same Name", 2025, LeagueRules())
    lid = league["id"]
    storage.upsert_player_name_alias(
        lid,
        "DK Metcalf",
        "DK Metcalf",
        position="WR",
        sleeper_player_id="5846",
    )
    meta = alias_meta_by_name_key(lid)
    row = enrich_row_with_alias({"player_name": "DK Metcalf", "position": "WR"}, meta)
    assert row["name_mapped"] is True
    assert row["sleeper_player_id"] == "5846"


def test_prepare_alias_upsert_defense(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.draft_hub.player_name_aliases.player_by_sleeper_id",
        lambda sid: {
            "sleeper_player_id": sid,
            "player_name": "Bills",
            "position": "DEF",
            "team": "BUF",
        },
    )
    fields = prepare_alias_upsert("Bills DST", sleeper_player_id="BUF", position="DST")
    assert fields["canonical_name"] == "Bills"
    assert fields["sleeper_player_id"] == "BUF"
    assert fields["position"] == "DEF"


def test_search_players_defense_team_names(monkeypatch):
    from src.integrations import sleeper as sleeper_mod

    sample = {
        "BUF": {
            "active": True,
            "position": "DEF",
            "first_name": "Buffalo",
            "last_name": "Bills",
            "team": "BUF",
            "status": "Active",
        },
        "5846": {
            "active": True,
            "position": "WR",
            "full_name": "DK Metcalf",
            "last_name": "Metcalf",
            "team": "PIT",
            "status": "Active",
        },
    }
    monkeypatch.setattr(sleeper_mod, "load_sleeper_players", lambda **_k: sample)
    sleeper_mod._PLAYERS_SEARCH_ROWS = None
    sleeper_mod._PLAYERS_SEARCH_BY_LAST = None

    hits = sleeper_mod.search_players("Bills DST", position="DST", limit=3, force_refresh=True)
    assert hits
    assert hits[0]["player_name"] == "Bills"
    assert hits[0]["sleeper_player_id"] == "BUF"


def test_player_name_alias_suggest_by_sleeper_id(hub_db, monkeypatch):
    monkeypatch.setattr(
        "src.integrations.sleeper.player_by_sleeper_id",
        lambda sid: {
            "sleeper_player_id": sid,
            "player_name": "DK Metcalf",
            "position": "WR",
            "team": "PIT",
        },
    )
    league = storage.create_league("lookup-api", "Lookup API", 2025, LeagueRules())
    lid = league["id"]
    app.dependency_overrides[require_hub_user] = lambda: {"sub": "lookup-api", "auth_type": "dev"}
    try:
        client = TestClient(app)
        res = client.get(f"/api/hub/league/{lid}/player-name-aliases/suggest?sleeper_player_id=5846")
        assert res.status_code == 200
        assert res.json()["suggestions"][0]["player_name"] == "DK Metcalf"
    finally:
        app.dependency_overrides.pop(require_hub_user, None)
