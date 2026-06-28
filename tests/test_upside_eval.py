"""Tests for upside evaluation metrics."""

import pandas as pd

from src.analytics.upside_eval import (
    boom_recall,
    boom_threshold,
    ceiling_mae,
    composite_score,
    compute_upside_metrics,
)


def test_boom_threshold():
    assert boom_threshold("qb") == 25.0
    assert boom_threshold("wr") == 20.0


def test_boom_recall_perfect():
    df = pd.DataFrame(
        {
            "season": [2024, 2024, 2024, 2024],
            "week": [1, 1, 1, 1],
            "player_id": ["a", "b", "c", "d"],
            "Fpts": [30.0, 10.0, 8.0, 5.0],
            "model_pred": [28.0, 9.0, 7.0, 4.0],
            "model_p90": [32.0, 12.0, 9.0, 6.0],
        }
    )
    recall = boom_recall(df, "qb")
    assert recall == 1.0


def test_ceiling_mae():
    df = pd.DataFrame(
        {
            "Fpts": [5.0, 8.0, 10.0, 12.0, 30.0],
            "model_pred": [5.0, 8.0, 10.0, 12.0, 20.0],
        }
    )
    mae = ceiling_mae(df)
    assert mae == 10.0


def test_composite_score_lower_is_better():
    good = composite_score(4.0, 0.8)
    bad = composite_score(6.0, 0.3)
    assert good < bad


def test_compute_upside_metrics_keys():
    df = pd.DataFrame(
        {
            "season": [2024] * 20,
            "week": [1] * 20,
            "player_id": [f"p{i}" for i in range(20)],
            "Fpts": [10.0 + i for i in range(20)],
            "model_pred": [9.0 + i for i in range(20)],
            "model_p90": [12.0 + i for i in range(20)],
        }
    )
    m = compute_upside_metrics(df, "wr")
    assert "boom_recall" in m
    assert "ceiling_mae" in m
    assert "mae" in m
