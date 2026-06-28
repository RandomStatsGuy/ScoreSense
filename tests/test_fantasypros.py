"""Tests for FantasyPros integration (fixture JSON only — no live API)."""

import pandas as pd

from src.integrations.fantasypros import (
    attach_fantasypros_projections,
    parse_fp_projections,
    parse_fp_rankings,
)
from src.integrations.fantasypros_enrich import enrich_position_mlready

FP_PROJ_FIXTURE = {
    "players": [
        {
            "fpid": 1234,
            "name": "Patrick Mahomes",
            "team_id": "KC",
            "position_id": "QB",
            "stats": {"points_ppr": 22.5, "points": 20.0},
        },
        {
            "fpid": 5678,
            "name": "Travis Kelce",
            "team_id": "KC",
            "position_id": "TE",
            "stats": {"points": 14.2},
        },
    ]
}

FP_RANK_FIXTURE = {
    "players": [
        {
            "player_id": 1234,
            "player_name": "Patrick Mahomes",
            "player_team_id": "KC",
            "player_position_id": "QB",
            "rank_ecr": 1,
        },
    ]
}


def test_parse_fp_projections():
    df = parse_fp_projections(FP_PROJ_FIXTURE, season=2024, week=9)
    assert len(df) == 2
    mahomes = df[df["player_name"] == "Patrick Mahomes"].iloc[0]
    assert mahomes["fantasypros_proj"] == 22.5
    assert mahomes["fp_position"] == "QB"
    assert mahomes["team"] == "KC"
    kelce = df[df["player_name"] == "Travis Kelce"].iloc[0]
    assert kelce["fantasypros_proj"] == 14.2


def test_parse_fp_rankings():
    df = parse_fp_rankings(FP_RANK_FIXTURE, season=2024, week=9)
    assert len(df) == 1
    assert df.iloc[0]["fp_ecr"] == 1.0


def test_attach_fantasypros_projections_by_name_team(monkeypatch):
    base = pd.DataFrame(
        {
            "player_id": ["00-0036389"],
            "player_display_name": ["Patrick Mahomes"],
            "team": ["KC"],
            "season": [2024],
            "week": [9],
            "name_key": ["patrick mahomes"],
        }
    )
    fp = pd.DataFrame(
        {
            "season": [2024],
            "week": [9],
            "name_key": ["patrick mahomes"],
            "team": ["KC"],
            "fantasypros_proj": [22.5],
            "fp_position": ["QB"],
        }
    )

    monkeypatch.setattr(
        "src.integrations.fantasypros.load_fp_season_projections",
        lambda season, **kwargs: fp,
    )

    out = attach_fantasypros_projections(base, season=2024, position="qb")
    assert out.iloc[0]["fantasypros_proj"] == 22.5


def test_enrich_position_mlready(tmp_path, monkeypatch):
    mlready = tmp_path / "qb_mlready.parquet"
    pd.DataFrame(
        {
            "player_id": ["p1"],
            "player_display_name": ["Patrick Mahomes"],
            "team": ["KC"],
            "season": [2024],
            "week": [9],
            "Fpts": [25.0],
        }
    ).to_parquet(mlready)

    fp_frame = pd.DataFrame(
        {
            "season": [2024],
            "week": [9],
            "name_key": ["patrick mahomes"],
            "team": ["KC"],
            "fp_consensus_ppr": [22.5],
            "fp_ecr": [1.0],
        }
    )
    monkeypatch.setattr(
        "src.integrations.fantasypros_enrich.build_fp_enrichment_frame",
        lambda season, position: fp_frame,
    )

    out = enrich_position_mlready("qb", seasons=[2024], data_dir=tmp_path)
    assert out.iloc[0]["fp_consensus_ppr"] == 22.5
    assert out.iloc[0]["fp_ecr"] == 1.0
