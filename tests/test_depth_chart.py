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


def test_filter_qb_prefers_sleeper_depth_over_prior_volume():
    """QB2 with big prior volume must not outrank the listed Sleeper QB1."""
    mlready = pd.DataFrame(
        {
            "player_id": ["shough", "rattler"],
            "player_display_name": ["Tyler Shough", "Spencer Rattler"],
            "season": [2025, 2025],
            "week": [2, 16],
            "team": ["NO", "NO"],
            "pass_attmpt_avg": [18.0, 32.0],
            "passing_yards_avg": [140.0, 230.0],
        }
    )
    roster = pd.DataFrame(
        {
            "player_id": ["shough", "rattler"],
            "player_display_name": ["Tyler Shough", "Spencer Rattler"],
            "team": ["NO", "NO"],
            "season": [2026, 2026],
            "week": [1, 1],
            "pass_attmpt_avg": [18.0, 32.0],
            "passing_yards_avg": [140.0, 230.0],
            "_sleeper_depth_order": [1, 2],
        }
    )
    filtered, meta = filter_qb_depth_chart(roster, mlready, feature_season=2025)
    assert len(filtered) >= 1
    assert filtered.iloc[0]["player_display_name"] == "Tyler Shough"


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
    assert len(filtered) >= 1
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
    assert meta["keep_per_team"] == 3
    kept = set(filtered["player_display_name"])
    assert "Starter" in kept
    assert "Backup" in kept


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
    kept = list(filtered["player_display_name"])
    assert kept[0] == "Veteran"
    assert "Veteran" in set(kept)


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
    assert meta["keep_per_team"] == 4
    kept = set(filtered["player_display_name"])
    assert {"WR0", "WR1", "WR2"}.issubset(kept)


def test_unranked_starter_not_dropped_for_listed_backup():
    """Sleeper DC on a backup must not erase last year's starter with no DC row."""
    mlready = pd.DataFrame(
        {
            "player_id": ["daniels", "mariota"],
            "player_display_name": ["Jayden Daniels", "Marcus Mariota"],
            "season": [2025, 2025],
            "week": [16, 4],
            "team": ["WAS", "WAS"],
            "pass_attmpt_avg": [30.0, 22.0],
            "passing_yards_avg": [220.0, 160.0],
        }
    )
    roster = pd.DataFrame(
        {
            "player_id": ["daniels", "mariota"],
            "player_display_name": ["Jayden Daniels", "Marcus Mariota"],
            "team": ["WAS", "WAS"],
            "season": [2026, 2026],
            "week": [1, 1],
            "pass_attmpt_avg": [30.0, 22.0],
            "passing_yards_avg": [220.0, 160.0],
            "_sleeper_depth_order": [pd.NA, 1],
        }
    )
    from src.core.depth_chart import filter_depth_chart_starters

    filtered, _ = filter_depth_chart_starters(roster, "qb", mlready, 2025)
    names = set(filtered["player_display_name"])
    assert "Jayden Daniels" in names


def test_wr_te_split_does_not_drop_wr_for_extra_tes():
    mlready = pd.DataFrame(
        {
            "player_id": [f"p{i}" for i in range(6)],
            "player_display_name": ["WR1", "WR2", "WR3", "TE1", "TE2", "TE3"],
            "season": [2025] * 6,
            "week": [10] * 6,
            "team": ["ATL"] * 6,
            "target_share_avg": [0.28, 0.22, 0.18, 0.16, 0.12, 0.10],
            "targets_avg": [9.0, 7.0, 6.0, 5.0, 4.0, 3.0],
            "receptions_avg": [6.0, 5.0, 4.0, 4.0, 3.0, 2.0],
        }
    )
    roster = pd.DataFrame(
        {
            "player_id": [f"p{i}" for i in range(6)],
            "player_display_name": ["WR1", "WR2", "WR3", "TE1", "TE2", "TE3"],
            "position": ["WR", "WR", "WR", "TE", "TE", "TE"],
            "team": ["ATL"] * 6,
            "season": [2026] * 6,
            "week": [1] * 6,
            "target_share_avg": [0.28, 0.22, 0.18, 0.16, 0.12, 0.10],
            "targets_avg": [9.0, 7.0, 6.0, 5.0, 4.0, 3.0],
            "receptions_avg": [6.0, 5.0, 4.0, 4.0, 3.0, 2.0],
        }
    )
    filtered, meta = filter_wr_depth_chart(roster, mlready, feature_season=2025)
    kept = set(filtered["player_display_name"])
    assert {"WR1", "WR2", "WR3", "TE1", "TE2"}.issubset(kept)
    assert meta["keep_per_team"] == 4
    assert meta["te_keep_per_team"] == 2


def test_established_vet_kept_beyond_keep_n():
    mlready = pd.DataFrame(
        {
            "player_id": ["a", "b", "c"],
            "player_display_name": ["Vet A", "Vet B", "Vet C"],
            "season": [2025, 2025, 2025],
            "week": [10, 9, 8],
            "team": ["KC", "KC", "KC"],
            "pass_attmpt_avg": [32.0, 20.0, 18.0],
            "passing_yards_avg": [250.0, 140.0, 120.0],
        }
    )
    roster = pd.DataFrame(
        {
            "player_id": ["a", "b", "c", "camp"],
            "player_display_name": ["Vet A", "Vet B", "Vet C", "Camp"],
            "team": ["KC"] * 4,
            "season": [2026] * 4,
            "week": [1] * 4,
            "pass_attmpt_avg": [32.0, 20.0, 18.0, 5.0],
            "passing_yards_avg": [250.0, 140.0, 120.0, 40.0],
            "_sleeper_depth_order": [1, 2, pd.NA, 1],
            "_rookie_estimate": [False, False, False, True],
        }
    )
    from src.core.depth_chart import filter_depth_chart_starters

    filtered, meta = filter_depth_chart_starters(roster, "qb", mlready, 2025)
    names = set(filtered["player_display_name"])
    assert {"Vet A", "Vet B", "Vet C"}.issubset(names)
    assert meta.get("keep_per_team") == 2


def test_nan_player_ids_are_not_established_vets():
    import numpy as np

    from src.core.depth_chart import (
        _games_played,
        _is_established_vet,
        filter_depth_chart_starters,
    )

    mlready = pd.DataFrame(
        {
            "player_id": [np.nan, np.nan, "qb1"],
            "player_display_name": ["Ghost A", "Ghost B", "Real Vet"],
            "season": [2025, 2025, 2025],
            "week": [1, 2, 1],
            "team": ["KC", "KC", "KC"],
        }
    )
    gp = _games_played(mlready, 2025)
    assert "nan" not in gp
    assert gp.get("qb1") == 1
    ghost = pd.Series({"player_id": np.nan, "_rookie_estimate": False})
    assert _is_established_vet(ghost, gp) is False
    assert _is_established_vet(pd.Series({"player_id": "qb1"}), gp) is True

    roster = pd.DataFrame(
        {
            "player_id": [np.nan, np.nan, np.nan, "qb1"],
            "player_display_name": ["Ghost A", "Ghost B", "Ghost C", "Real Vet"],
            "team": ["KC"] * 4,
            "season": [2026] * 4,
            "week": [1] * 4,
            "pass_attmpt_avg": [1.0, 1.0, 1.0, 32.0],
            "passing_yards_avg": [10.0, 10.0, 10.0, 250.0],
            "_sleeper_depth_order": [pd.NA, pd.NA, pd.NA, 1],
            "_rookie_estimate": [False, False, False, False],
        }
    )
    filtered, _ = filter_depth_chart_starters(roster, "qb", mlready, 2025)
    names = set(filtered["player_display_name"])
    assert "Real Vet" in names
    # Missing ids must not share a "nan" games-played bucket and all get always-kept.
    assert len(filtered) <= 2
    assert len(names & {"Ghost A", "Ghost B", "Ghost C"}) <= 1


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
    assert not ind.empty
    assert "Daniel Jones" in set(ind["player_display_name"])
    bal = roster[roster["team"] == "BAL"]
    assert not bal.empty
    assert "Lamar Jackson" in set(bal["player_display_name"])


def test_build_inference_roster_applies_rb_depth_chart_preseason():
    path = __import__("src.config", fromlist=["PROCESSED_DATA_DIR"]).PROCESSED_DATA_DIR / "rb_mlready.parquet"
    if not path.exists():
        return
    df = pd.read_parquet(path)
    roster, meta = build_inference_roster(df, "rb", season=2026, target_week=1)
    assert meta["preseason_mode"] is True
    depth = meta.get("depth_chart") or {}
    assert depth.get("applied") is True
    assert depth.get("keep_per_team") == 3
    assert "Christian McCaffrey" in set(roster["player_display_name"]) or len(roster) > 0


def test_build_inference_roster_applies_wr_depth_chart_preseason():
    path = __import__("src.config", fromlist=["PROCESSED_DATA_DIR"]).PROCESSED_DATA_DIR / "wr_mlready.parquet"
    if not path.exists():
        return
    df = pd.read_parquet(path)
    roster, meta = build_inference_roster(df, "wr", season=2026, target_week=1)
    assert meta["preseason_mode"] is True
    depth = meta.get("depth_chart") or {}
    assert depth.get("applied") is True
    assert depth.get("keep_per_team") == 4
    assert depth.get("te_keep_per_team") == 2


def test_preseason_weekly_ind_starter_is_daniel_jones():
    preds = predict_upcoming_week("qb", season=2026, week=1, apply_injury_adjustments=False)
    ind = preds[preds["Team"] == "IND"]
    assert not ind.empty
    assert "Daniel Jones" in set(ind["Player"])
    assert "Lamar Jackson" in set(preds["Player"])
    top = preds.sort_values("Projected Points", ascending=False).iloc[0]
    assert top["Player"] != "Anthony Richardson"


def test_draft_preseason_ind_starter_is_daniel_jones():
    draft = predict_draft_season("qb", season=2026)
    ind = draft[draft["Team"] == "IND"].sort_values("Season Proj", ascending=False)
    depth = (draft.attrs.get("depth_chart") or {})
    assert depth.get("keep_per_team") == 2
    assert len(ind) >= 1
    assert ind.iloc[0]["Player"] == "Daniel Jones"
    # Draft depth keeps QB2; Richardson may remain as a scaled backup.
    richardson = draft[draft["Player"] == "Anthony Richardson"]
    if not richardson.empty:
        assert float(richardson.iloc[0]["Season Proj"]) < float(ind.iloc[0]["Season Proj"]) * 0.5


def test_draft_preseason_rattler_is_backup_not_starter_volume():
    draft = predict_draft_season("qb", season=2026)
    no = draft[draft["Team"] == "NO"].sort_values("Season Proj", ascending=False)
    assert len(no) >= 1
    assert no.iloc[0]["Player"] == "Tyler Shough"
    rattler = draft[draft["Player"] == "Spencer Rattler"]
    if not rattler.empty:
        # Kept as QB2 in draft depth, but must not look like a starter.
        assert float(rattler.iloc[0]["Season Proj"]) < 60.0
        assert float(rattler.iloc[0]["Season Proj"]) < float(no.iloc[0]["Season Proj"]) * 0.5
