"""SCORE-2: offline season-quantile interval-coverage eval logic."""

from __future__ import annotations

import pandas as pd
import pytest

import src.analytics.season_quantile_coverage_eval as coverage_eval
from src.projections.season_quantiles import METHOD_INDEPENDENT_SCALE, METHOD_MC_SCHEDULE_V1


def _fake_walk_forward_split(df, season):
    train_df = df[df["season"] < season].copy()
    test_df = df[df["season"] == season].copy()
    return train_df, test_df


def _fake_predict_walk_forward_season(train_df, test_df, position, season):
    # Deterministic, wide-but-plausible weekly quantiles keyed off row order.
    qpreds = pd.DataFrame(
        {"q10": [8.0] * len(test_df), "q50": [15.0] * len(test_df), "q90": [24.0] * len(test_df)},
        index=test_df.index,
    )
    return qpreds, True


@pytest.fixture(autouse=True)
def _patch_walk_forward(monkeypatch):
    monkeypatch.setattr(coverage_eval, "walk_forward_split", _fake_walk_forward_split)
    monkeypatch.setattr(coverage_eval, "predict_walk_forward_season", _fake_predict_walk_forward_season)


def _synthetic_df(season: int, n_weeks: int = 17, ppg: float = 15.0) -> pd.DataFrame:
    rows = [
        {"season": season, "week": w, "player_id": "p1", "team": "KC", "Fpts": ppg}
        for w in range(1, n_weeks + 1)
    ]
    # One prior season so games_expected can anchor off real history.
    rows += [
        {"season": season - 1, "week": w, "player_id": "p1", "team": "KC", "Fpts": ppg}
        for w in range(1, n_weeks + 1)
    ]
    return pd.DataFrame(rows)


def test_coverage_for_season_actual_within_band():
    df = _synthetic_df(2025)
    report = coverage_eval.coverage_for_season(df, "qb", 2025, draft_cohort_only=False)
    assert report["n"] == 1
    # Actual total (255) should land inside a schedule-aware MC season band.
    assert report["coverage"] == 1.0
    assert report["method"] == METHOD_MC_SCHEDULE_V1


def test_coverage_for_season_legacy_wider_band_also_covers():
    df = _synthetic_df(2025)
    report = coverage_eval.coverage_for_season(df, "qb", 2025, method=METHOD_INDEPENDENT_SCALE, draft_cohort_only=False)
    assert report["n"] == 1
    assert report["coverage"] == 1.0
    # Legacy naive x17 band is strictly wider than the MC band for the same inputs.
    mc_report = coverage_eval.coverage_for_season(df, "qb", 2025, draft_cohort_only=False)
    assert report["avg_spread"] > mc_report["avg_spread"]


def test_coverage_for_season_empty_when_no_data():
    df = pd.DataFrame(columns=["season", "week", "player_id", "team", "Fpts"])
    report = coverage_eval.coverage_for_season(df, "qb", 2025, draft_cohort_only=False)
    assert report["n"] == 0
    assert report["coverage"] is None
