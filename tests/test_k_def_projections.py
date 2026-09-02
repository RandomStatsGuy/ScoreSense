"""Rank-based K/DEF season projections for the draft pool and recap overlay."""

from __future__ import annotations

import pandas as pd

from src.draft_hub.draft_recap import build_owner_draft_report
from src.draft_hub.k_def_pool_cache import (
    K_DEF_QUANTILE_METHOD,
    build_k_def_projection_index,
    invalidate_k_def_cache,
    k_def_projection_index,
    k_def_season_bands,
    k_def_week_bands,
    load_k_def_rows,
    overlay_k_def_projections,
    overlay_k_def_week_projections,
)
from src.draft_hub.presets import load_preset
from src.draft_hub import storage


def test_k_def_season_bands_rank_down_and_ordered():
    elite = k_def_season_bands(0, "K")
    mid = k_def_season_bands(11, "K")
    late = k_def_season_bands(23, "K")
    assert elite["season_proj"] > mid["season_proj"] > late["season_proj"] > 0
    assert elite["season_p10"] < elite["season_p50"] < elite["season_p90"]
    assert elite["per_game_proj"] > 0
    assert elite["season_quantile_method"] == K_DEF_QUANTILE_METHOD
    dst = k_def_season_bands(0, "DEF")
    assert dst["season_p90"] - dst["season_p50"] > elite["season_p90"] - elite["season_p50"]


def test_load_k_def_rows_sets_projections(monkeypatch):
    df = pd.DataFrame(
        [
            {"sleeper_id": "k1", "full_name": "Justin Tucker", "team": "BAL", "position": "K", "search_rank": 150},
            {"sleeper_id": "k2", "full_name": "Streamer K", "team": "NYJ", "position": "K", "search_rank": 900},
            {"sleeper_id": "d1", "full_name": "Ravens", "team": "BAL", "position": "DEF", "search_rank": 180},
            {"sleeper_id": "d2", "full_name": "Jets", "team": "NYJ", "position": "DEF", "search_rank": 950},
        ]
    )
    monkeypatch.setattr("src.integrations.sleeper.players_dataframe", lambda force_refresh=False: df)
    invalidate_k_def_cache()
    rows = load_k_def_rows(load_preset("snake_draft_v1"), [], team_count=12)
    kickers = [r for r in rows if r["position"] == "K"]
    defs = [r for r in rows if r["position"] == "DEF"]
    assert kickers[0]["player"] == "Justin Tucker"
    assert kickers[0]["season_proj"] > kickers[1]["season_proj"] > 80
    assert kickers[0]["season_p10"] < kickers[0]["season_p50"] < kickers[0]["season_p90"]
    assert defs[0]["season_proj"] > defs[1]["season_proj"] > 70
    assert all(r["season_quantile_method"] == K_DEF_QUANTILE_METHOD for r in rows)


def test_k_def_rows_skip_free_agents_with_nan_team(monkeypatch):
    df = pd.DataFrame(
        [
            {"sleeper_id": "k-fa", "full_name": "FA Kicker", "team": pd.NA, "position": "K", "search_rank": 10},
            {"sleeper_id": "k1", "full_name": "Justin Tucker", "team": "BAL", "position": "K", "search_rank": 150},
            {"sleeper_id": "d-fa", "full_name": "FA DEF", "team": None, "position": "DEF", "search_rank": 20},
            {"sleeper_id": "d1", "full_name": "Ravens", "team": "BAL", "position": "DEF", "search_rank": 180},
        ]
    )
    monkeypatch.setattr("src.integrations.sleeper.players_dataframe", lambda force_refresh=False: df)
    invalidate_k_def_cache()
    rows = load_k_def_rows(load_preset("snake_draft_v1"), [], team_count=12)
    assert {r["player_id"] for r in rows} == {"k1", "d1"}
    index = build_k_def_projection_index(df)
    assert set(index) == {"k1", "d1"}


def test_empty_projection_index_is_cached(monkeypatch):
    import src.draft_hub.k_def_pool_cache as kdef

    invalidate_k_def_cache()
    kdef._PROJ_INDEX = {}
    monkeypatch.setattr(
        kdef,
        "_sleeper_players_df",
        lambda allow_fetch=False: (_ for _ in ()).throw(AssertionError("should use empty cache")),
    )
    assert k_def_projection_index() == {}


def test_overlay_k_def_projections_fills_zeros(monkeypatch):
    index = {
        "k1": {
            "p10": 120.0,
            "p50": 141.0,
            "p90": 158.0,
            "season_proj": 141.0,
            "position": "K",
            "player_name": "Tucker",
            "team": "BAL",
        }
    }
    monkeypatch.setattr(
        "src.draft_hub.k_def_pool_cache.k_def_projection_index",
        lambda allow_fetch=False: index,
    )
    rows = [
        {"player_id": "k1", "position": "K", "player_name": "Tucker", "season_proj": 0.0},
        {"player_id": "wr1", "position": "WR", "player_name": "Puka", "season_proj": 280.0},
    ]
    overlay_k_def_projections(rows)
    assert rows[0]["season_proj"] == 141.0
    assert rows[0]["season_p50"] == 141.0
    assert rows[1]["season_proj"] == 280.0


def test_overlay_k_def_week_projections_uses_per_game(monkeypatch):
    index = {
        "k1": {
            "p10": 120.0,
            "p50": 141.0,
            "p90": 158.0,
            "season_proj": 141.0,
            "per_game": 8.3,
            "position": "K",
            "player_name": "Tucker",
            "team": "BAL",
        }
    }
    monkeypatch.setattr(
        "src.draft_hub.k_def_pool_cache.k_def_projection_index",
        lambda allow_fetch=False: index,
    )
    cards = [
        {"player_id": "k1", "position": "K", "player_name": "Tucker", "p50": None},
        {"player_id": "wr1", "position": "WR", "player_name": "Puka", "p50": 16.2},
    ]
    overlay_k_def_week_projections(cards)
    assert cards[0]["p50"] == 8.3
    assert cards[0]["has_projection"] is True
    assert cards[0]["projection_missing"] is False
    assert cards[1]["p50"] == 16.2
    bands = k_def_week_bands({"position": "K", "p50": 141.0}, games=17)
    assert bands["p50"] == 8.3


def test_owner_report_overlays_kicker_projection(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DRAFT_HUB_DB", tmp_path / "draft_hub.db")
    monkeypatch.setattr(storage, "DRAFT_HUB_DIR", tmp_path)
    monkeypatch.setattr(
        "src.draft_hub.k_def_pool_cache.k_def_projection_index",
        lambda allow_fetch=False: {
            "k1": {
                "p10": 118.0,
                "p50": 139.0,
                "p90": 156.0,
                "season_proj": 139.0,
                "position": "K",
                "player_name": "Tucker",
                "team": "BAL",
            }
        },
    )
    rules = load_preset("snake_draft_v1")
    league = storage.create_league("k-rep", "K Report", 2026, rules, test_mode=True)
    team = storage.list_league_teams(league["id"])[0]
    storage.update_draft_session(league["id"], status="completed", completed_at="2026-01-01T00:00:00+00:00")
    storage.update_league_settings(league["id"], draft_completed=True)
    storage.append_draft_event(
        league["id"],
        "pick",
        {
            "team_id": team["id"],
            "team_name": team["name"],
            "player_id": "k1",
            "player_name": "Justin Tucker",
            "position": "K",
            "amount": 0,
            "overall": 150,
            "round": 13,
            "season_proj": 0.0,
        },
    )
    report = build_owner_draft_report(league["id"], team["id"])
    assert report["picks"][0]["season_proj"] == 139.0
    assert report["picks"][0]["season_p50"] == 139.0
