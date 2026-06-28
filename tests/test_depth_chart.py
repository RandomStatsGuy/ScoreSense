"""Tests for preseason depth-chart filtering."""

import pandas as pd

from src.core.depth_chart import (
    filter_qb_depth_chart,
    filter_rb_depth_chart,
    filter_wr_depth_chart,
)
from src.core.projection_context import build_inference_roster
from src.projections.draft_projections import predict_draft_season
from src.projections.predict import predict_upcoming_week


def test_filter_qb_depth_chart_keeps_pass_volume_leader():
    mlready = pd.DataFrame(
        {
            "player_id": ["starter", "backup"],
            "player_display_name": ["Daniel Jones", "Anthony Richardson"],
            "season": [2025, 2025],
            "week": [14, 5],
            "team": ["IND", "IND"],
            "pass_attmpt_avg": [31.9, 21.8],
            "passing_yards_avg": [215.0, 149.0],
        }
    )
    roster = pd.DataFrame(
        {
            "player_id": ["starter", "backup"],
            "player_display_name": ["Daniel Jones", "Anthony Richardson"],
            "team": ["IND", "IND"],
            "season": [2026, 2026],
            "week": [1, 1],
            "pass_attmpt_avg": [31.9, 21.8],
            "passing_yards_avg": [215.0, 149.0],
        }
    )
    filtered, meta = filter_qb_depth_chart(roster, mlready, feature_season=2025)
    assert meta["applied"] is True
    assert meta["removed"] == 1
    assert len(filtered) == 1
    assert filtered.iloc[0]["player_display_name"] == "Daniel Jones"


def test_filter_qb_depth_chart_prefers_games_over_rookie_stub():
    """Rookie median templates can inflate pass_attmpt_avg — starter must have more 2025 starts."""
    mlready = pd.DataFrame(
        {
            "player_id": ["lamar", "rookie"],
            "player_display_name": ["Lamar Jackson", "Diego Pavia"],
            "season": [2025, 2025],
            "week": [18, 1],
            "team": ["BAL", "BAL"],
            "pass_attmpt_avg": [25.0, 27.0],
            "passing_yards_avg": [210.0, 220.0],
        }
    )
    roster = pd.DataFrame(
        {
            "player_id": ["lamar", "rookie"],
            "player_display_name": ["Lamar Jackson", "Diego Pavia"],
            "team": ["BAL", "BAL"],
            "season": [2026, 2026],
            "week": [1, 1],
            "pass_attmpt_avg": [25.3, 27.0],
            "passing_yards_avg": [210.0, 220.0],
            "_rookie_estimate": [False, True],
        }
    )
    filtered, _ = filter_qb_depth_chart(roster, mlready, feature_season=2025)
    assert len(filtered) == 1
    assert filtered.iloc[0]["player_display_name"] == "Lamar Jackson"


def test_filter_qb_sole_rookie_team_kept():
    """Teams with only rookie stubs and no prior starts keep one QB (NYG edge case)."""
    mlready = pd.DataFrame(
        columns=[
            "player_id",
            "player_display_name",
            "season",
            "week",
            "team",
            "pass_attmpt_avg",
            "passing_yards_avg",
        ]
    )
    roster = pd.DataFrame(
        {
            "player_id": ["rookie"],
            "player_display_name": ["Jaxson Dart"],
            "team": ["NYG"],
            "season": [2026],
            "week": [1],
            "pass_attmpt_avg": [27.0],
            "passing_yards_avg": [200.0],
            "_rookie_estimate": [True],
        }
    )
    filtered, meta = filter_qb_depth_chart(roster, mlready, feature_season=2025)
    assert len(filtered) == 1
    assert filtered.iloc[0]["player_display_name"] == "Jaxson Dart"
    assert "NYG" in meta.get("sole_rookie_teams", [])


def test_filter_rb_depth_chart_keeps_top_two_by_carry_share():
    mlready = pd.DataFrame(
        {
            "player_id": ["rb1", "rb2", "rb3"],
            "player_display_name": ["Starter", "Backup", "Deep"],
            "season": [2025, 2025, 2025],
            "week": [10, 8, 3],
            "team": ["DET", "DET", "DET"],
            "carry_share_avg": [0.55, 0.30, 0.05],
            "rush_attmpt_avg": [15.0, 8.0, 2.0],
            "targets_avg": [3.0, 4.0, 1.0],
        }
    )
    roster = pd.DataFrame(
        {
            "player_id": ["rb1", "rb2", "rb3"],
            "player_display_name": ["Starter", "Backup", "Deep"],
            "team": ["DET", "DET", "DET"],
            "season": [2026, 2026, 2026],
            "week": [1, 1, 1],
            "carry_share_avg": [0.55, 0.30, 0.05],
            "rush_attmpt_avg": [15.0, 8.0, 2.0],
            "targets_avg": [3.0, 4.0, 1.0],
        }
    )
    filtered, meta = filter_rb_depth_chart(roster, mlready, feature_season=2025)
    assert meta["removed"] == 1
    assert meta["keep_per_team"] == 2
    kept = set(filtered["player_display_name"])
    assert kept == {"Starter", "Backup"}


def test_filter_rb_depth_chart_prefers_games_over_rookie_stub():
    mlready = pd.DataFrame(
        {
            "player_id": ["vet", "rookie", "deep"],
            "player_display_name": ["Veteran", "Rookie Stub", "Deep Backup"],
            "season": [2025, 2025, 2025],
            "week": [12, 1, 2],
            "team": ["SF", "SF", "SF"],
            "carry_share_avg": [0.40, 0.50, 0.05],
            "rush_attmpt_avg": [12.0, 14.0, 1.0],
            "targets_avg": [2.0, 3.0, 0.5],
        }
    )
    roster = pd.DataFrame(
        {
            "player_id": ["vet", "rookie", "deep"],
            "player_display_name": ["Veteran", "Rookie Stub", "Deep Backup"],
            "team": ["SF", "SF", "SF"],
            "season": [2026, 2026, 2026],
            "week": [1, 1, 1],
            "carry_share_avg": [0.40, 0.50, 0.05],
            "rush_attmpt_avg": [12.0, 14.0, 1.0],
            "targets_avg": [2.0, 3.0, 0.5],
            "_rookie_estimate": [False, True, False],
        }
    )
    filtered, _ = filter_rb_depth_chart(roster, mlready, feature_season=2025)
    kept = set(filtered["player_display_name"])
    assert "Rookie Stub" not in kept
    assert "Veteran" in kept


def test_filter_wr_depth_chart_keeps_top_three_by_target_share():
    mlready = pd.DataFrame(
        {
            "player_id": [f"wr{i}" for i in range(5)],
            "player_display_name": [f"WR{i}" for i in range(5)],
            "season": [2025] * 5,
            "week": [10, 9, 8, 4, 2],
            "team": ["MIA"] * 5,
            "target_share_avg": [0.28, 0.22, 0.18, 0.10, 0.05],
            "targets_avg": [9.0, 7.0, 6.0, 3.0, 1.0],
            "receptions_avg": [6.0, 5.0, 4.0, 2.0, 1.0],
        }
    )
    roster = pd.DataFrame(
        {
            "player_id": [f"wr{i}" for i in range(5)],
            "player_display_name": [f"WR{i}" for i in range(5)],
            "team": ["MIA"] * 5,
            "season": [2026] * 5,
            "week": [1] * 5,
            "target_share_avg": [0.28, 0.22, 0.18, 0.10, 0.05],
            "targets_avg": [9.0, 7.0, 6.0, 3.0, 1.0],
            "receptions_avg": [6.0, 5.0, 4.0, 2.0, 1.0],
        }
    )
    filtered, meta = filter_wr_depth_chart(roster, mlready, feature_season=2025)
    assert meta["removed"] == 2
    assert meta["keep_per_team"] == 3
    kept = set(filtered["player_display_name"])
    assert kept == {"WR0", "WR1", "WR2"}


def test_build_inference_roster_applies_qb_depth_chart_preseason():
    path = __import__("src.config", fromlist=["PROCESSED_DATA_DIR"]).PROCESSED_DATA_DIR / "qb_mlready.parquet"
    if not path.exists():
        return
    df = pd.read_parquet(path)
    roster, meta = build_inference_roster(df, "qb", season=2026, target_week=1)
    assert meta["preseason_mode"] is True
    depth = meta.get("depth_chart") or {}
    assert depth.get("applied") is True
    ind = roster[roster["team"] == "IND"]
    assert len(ind) == 1
    assert ind.iloc[0]["player_display_name"] == "Daniel Jones"
    bal = roster[roster["team"] == "BAL"]
    assert len(bal) == 1
    assert bal.iloc[0]["player_display_name"] == "Lamar Jackson"


def test_build_inference_roster_applies_rb_depth_chart_preseason():
    path = __import__("src.config", fromlist=["PROCESSED_DATA_DIR"]).PROCESSED_DATA_DIR / "rb_mlready.parquet"
    if not path.exists():
        return
    df = pd.read_parquet(path)
    roster, meta = build_inference_roster(df, "rb", season=2026, target_week=1)
    assert meta["preseason_mode"] is True
    depth = meta.get("depth_chart") or {}
    assert depth.get("applied") is True
    assert depth.get("keep_per_team") == 2
    team_counts = roster.groupby("team").size()
    assert (team_counts <= 2).all()


def test_build_inference_roster_applies_wr_depth_chart_preseason():
    path = __import__("src.config", fromlist=["PROCESSED_DATA_DIR"]).PROCESSED_DATA_DIR / "wr_mlready.parquet"
    if not path.exists():
        return
    df = pd.read_parquet(path)
    roster, meta = build_inference_roster(df, "wr", season=2026, target_week=1)
    assert meta["preseason_mode"] is True
    depth = meta.get("depth_chart") or {}
    assert depth.get("applied") is True
    assert depth.get("keep_per_team") == 3
    team_counts = roster.groupby("team").size()
    assert (team_counts <= 3).all()


def test_preseason_weekly_ind_starter_is_daniel_jones():
    preds = predict_upcoming_week("qb", season=2026, week=1, apply_injury_adjustments=False)
    ind = preds[preds["Team"] == "IND"]
    assert len(ind) == 1
    assert ind.iloc[0]["Player"] == "Daniel Jones"
    assert "Anthony Richardson" not in set(preds["Player"])
    assert "Lamar Jackson" in set(preds["Player"])
    top = preds.sort_values("Projected Points", ascending=False).iloc[0]
    assert top["Player"] != "Anthony Richardson"


def test_preseason_weekly_rb_max_two_per_team():
    preds = predict_upcoming_week("rb", season=2026, week=1, apply_injury_adjustments=False)
    team_counts = preds.groupby("Team").size()
    assert (team_counts <= 2).all()
    depth = (preds.attrs.get("inference_meta") or {}).get("depth_chart") or {}
    assert depth.get("applied") is True


def test_draft_preseason_ind_starter_is_daniel_jones():
    draft = predict_draft_season("qb", season=2026)
    ind = draft[draft["Team"] == "IND"].sort_values("Season Proj", ascending=False)
    depth = (draft.attrs.get("depth_chart") or {})
    assert depth.get("keep_per_team") == 2
    assert len(ind) == 2
    assert ind.iloc[0]["Player"] == "Daniel Jones"
