"""Tests for season-long projection evaluation helpers."""

from unittest.mock import patch

import pandas as pd

from src.analytics.fp_preseason_benchmark import (
    attach_fp_week1_preseason_totals,
    fp_preseason_metrics,
)
from src.analytics.season_long_eval import (
    _actual_season_totals,
    _merge_eval_frame,
    _preseason_scoresense_proj,
    _prior_year_baseline,
    _ytd_through_week,
    tune_qb_preseason_alpha,
)


def test_actual_season_totals_sums_regular_weeks():
    df = pd.DataFrame(
        {
            "player_id": ["p1", "p1", "p1", "p2"],
            "season": [2024, 2024, 2024, 2024],
            "week": [1, 2, 19, 1],
            "Fpts": [10.0, 12.0, 99.0, 8.0],
        }
    )
    out = _actual_season_totals(df, 2024)
    p1 = out[out.player_id == "p1"].iloc[0]
    assert p1.actual_total == 22.0
    assert p1.games_played == 2


def test_prior_year_baseline_uses_ppg_times_games():
    df = pd.DataFrame(
        {
            "player_id": ["p1"] * 4,
            "season": [2023] * 4,
            "week": [1, 2, 3, 4],
            "Fpts": [10.0, 20.0, 10.0, 20.0],
        }
    )
    base = _prior_year_baseline(df, season=2024, games=17)
    assert base.iloc[0]["baseline_proj"] == 15.0 * 17


def test_ytd_through_week_excludes_target_week():
    df = pd.DataFrame(
        {
            "player_id": ["p1", "p1", "p1"],
            "season": [2024, 2024, 2024],
            "week": [1, 2, 4],
            "Fpts": [5.0, 7.0, 20.0],
        }
    )
    ytd = _ytd_through_week(df, 2024, target_week=4)
    assert ytd.iloc[0]["fpts_ytd"] == 12.0


def test_merge_eval_frame_filters_min_games():
    actual = pd.DataFrame(
        {
            "player_id": ["p1", "p2"],
            "actual_total": [200.0, 50.0],
            "games_played": [16, 4],
            "season": [2024, 2024],
        }
    )
    pred = pd.DataFrame({"player_id": ["p1", "p2"], "scoresense_proj": [190.0, 60.0]})
    base = pd.DataFrame({"player_id": ["p1", "p2"], "baseline_proj": [180.0, 55.0]})
    out = _merge_eval_frame(actual, pred, base, min_games=8)
    assert len(out) == 1
    assert out.iloc[0]["player_id"] == "p1"


def test_attach_fp_week1_preseason_totals_scales_by_17():
    test_df = pd.DataFrame(
        {
            "player_id": ["p1", "p2"],
            "week": [1, 1],
            "player_name": ["Player One", "Player Two"],
            "team": ["KC", "BUF"],
        }
    )
    fp_loaded = pd.DataFrame(
        {
            "season": [2024, 2024],
            "week": [1, 1],
            "name_key": ["player one", "player two"],
            "team": ["KC", "BUF"],
            "fantasypros_proj": [20.0, 15.0],
        }
    )

    def fake_attach(w1, season, position, cache_only=True):
        out = w1.copy()
        out["fantasypros_proj"] = [20.0, float("nan")]
        return out

    with patch(
        "src.analytics.fp_preseason_benchmark.load_fp_season_projections",
        return_value=fp_loaded,
    ), patch(
        "src.analytics.fp_preseason_benchmark.attach_fantasypros_projections",
        side_effect=fake_attach,
    ):
        cols, coverage = attach_fp_week1_preseason_totals(
            test_df, 2024, "qb", auto_fetch=False
        )

    assert len(cols) == 2
    p1 = cols[cols.player_id == "p1"].iloc[0]
    assert p1.fantasypros_preseason == 20.0 * 17
    assert cols["fantasypros_preseason"].notna().sum() == 1
    assert coverage == 0.5


def test_fp_preseason_metrics_beats_flag():
    frame = pd.DataFrame(
        {
            "actual_total": [200.0, 180.0],
            "scoresense_proj": [195.0, 175.0],
            "fantasypros_preseason": [210.0, 190.0],
        }
    )
    metrics = fp_preseason_metrics(frame)
    assert metrics["fantasypros_mae"] == 10.0
    assert metrics["fantasypros_coverage"] == 1.0
    assert metrics["beats_fantasypros_mae"] is True


def test_tune_qb_preseason_alpha_picks_lowest_train_mae():
    mae_by_alpha = {
        0.0: 80.0,
        0.5: 70.0,
        0.55: 72.0,
        1.0: 85.0,
    }

    def fake_mae(df, position, season, *, alpha, data_dir=None):
        return mae_by_alpha.get(round(alpha, 2), 90.0)

    with patch("src.analytics.season_long_eval._preseason_mae", side_effect=fake_mae), patch(
        "src.analytics.season_long_eval.preseason_blend_alpha", lambda pos: 0.55
    ):
        result = tune_qb_preseason_alpha(
            df=pd.DataFrame(),
            train_seasons=[2020],
            holdout_seasons=[2025],
            step=0.5,
        )

    assert result["chosen_alpha"] == 0.5
    assert result["train_mae_by_alpha"]["0.5"] == 70.0
    assert result["holdout_mae"]["chosen"] == 70.0
    assert result["holdout_mae"]["current_constant"] == 72.0


def test_blend_preseason_totals_with_expected_games():
    from src.projections.season_blend import blend_preseason_totals, expected_preseason_games

    pids = pd.Series(["p1", "p2"])
    model_ppg = pd.Series([20.0, 15.0])
    prior_ppg = pd.Series({"p1": 18.0})
    prior_games = pd.Series({"p1": 14})
    games = expected_preseason_games(pids, prior_games, rookie_games=12)
    out = blend_preseason_totals(pids, model_ppg, prior_ppg, games=games, alpha=0.5)
    assert out.iloc[0] == round(0.5 * 20 * 14 + 0.5 * 18 * 14, 1)
    assert out.iloc[1] == round(15.0 * 12, 1)


def test_expected_preseason_games_rookie_default():
    from src.projections.season_blend import expected_preseason_games

    pids = pd.Series(["new_guy"])
    prior = pd.Series(dtype=float)
    games = expected_preseason_games(pids, prior, rookie_games=12)
    assert int(games.iloc[0]) == 12
