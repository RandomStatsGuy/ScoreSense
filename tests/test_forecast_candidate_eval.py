from copy import deepcopy

import numpy as np
import pandas as pd
import pytest

from src.analytics.forecast_candidate_eval import candidate_contract, diagnostic_gate, evaluate
from src.ml.training_config import DEFAULT_TRAINING_CONFIG


def comparison(season):
    ref = {"mae": 6., "weighted_interval_score": 4., "boom": {"recall": .8, "precision": .4},
           "bust": {"f1": .6}}
    candidate = deepcopy(ref)
    candidate.update(mae=5.5, weighted_interval_score=3.8)
    return {"season": season, "cohorts": {name: {"reference": deepcopy(ref), "candidate": deepcopy(candidate),
                                               "paired_mae": {"ci95": [-.6, -.4]}}
            for name in ("all_observed", "actionable")}}


def test_qualification_requires_complete_seasons_and_both_cohorts():
    comparisons = [comparison(y) for y in range(2019, 2026)]
    assert diagnostic_gate(comparisons)["research_qualified"]
    assert not diagnostic_gate(comparisons)["production_eligible"]
    assert not diagnostic_gate(comparisons[1:])["research_qualified"]
    comparisons[0]["cohorts"]["actionable"]["candidate"]["mae"] = 100.
    assert not diagnostic_gate(comparisons)["research_qualified"]


@pytest.mark.parametrize("event,metric", [("boom", "recall"), ("boom", "precision"), ("bust", "f1")])
@pytest.mark.parametrize("season", [2022, 2025])
def test_lower_point_error_cannot_mask_risk_regression(event, metric, season):
    comparisons = [comparison(y) for y in range(2019, 2026)]
    pair = comparisons[season-2019]["cohorts"]["actionable"]
    pair["candidate"][event][metric] = pair["reference"][event][metric] - .03
    assert not diagnostic_gate(comparisons)["research_qualified"]


def test_missing_risk_metric_and_duplicate_season_fail_closed():
    comparisons = [comparison(y) for y in range(2019, 2026)]
    comparisons[0]["cohorts"]["all_observed"]["candidate"]["boom"]["recall"] = None
    assert not diagnostic_gate(comparisons)["research_qualified"]
    with pytest.raises(ValueError, match="once"):
        diagnostic_gate(comparisons + [comparison(2025)])


def test_small_noisy_later_season_gain_does_not_qualify():
    comparisons = [comparison(y) for y in range(2019, 2026)]
    comparisons[-1]["cohorts"]["all_observed"]["paired_mae"]["ci95"] = [-.03, .01]
    assert not diagnostic_gate(comparisons)["research_qualified"]


def test_market_feature_contract_does_not_redefine_legacy_features():
    cols = ["recent4_Fpts_avg", "implied_team_total_avg", "total_line_avg", "passing_yards_avg"]
    alpha, candidate_cols, config = candidate_contract("game_market_p50", cols, DEFAULT_TRAINING_CONFIG)
    assert alpha == .5
    assert "game_implied_team_total" in candidate_cols
    assert "implied_team_total_avg" not in candidate_cols
    assert "total_line_avg" not in candidate_cols
    assert cols == ["recent4_Fpts_avg", "implied_team_total_avg", "total_line_avg", "passing_yards_avg"]
    assert config is DEFAULT_TRAINING_CONFIG


def test_offline_runner_trains_before_target_and_saves_matched_rows(tmp_path, monkeypatch):
    import src.analytics.forecast_candidate_eval as module

    data = pd.DataFrame({"player_id": ["p1", "p2"]*3, "season": [2018, 2018, 2019, 2019, 2020, 2020],
        "week": 1, "team": ["KC", "BUF"]*3, "position": "QB", "Fpts": [0., 30., 0., 30., 999., 999.],
        "x": [1., 2., 3., 4., 999., 999.]})
    data.to_parquet(tmp_path / "qb_mlready.parquet")
    schedule = pd.DataFrame({"season": [2018, 2019, 2020], "week": 1, "home_team": "KC", "away_team": "BUF",
                            "total_line": 48., "spread_line": 4.})
    schedule.to_parquet(tmp_path / "schedules.parquet")
    monkeypatch.setattr(module, "training_inputs", lambda data, *args: data.copy())
    monkeypatch.setattr(module, "policy_feature_cols", lambda *args: ["x"])
    monkeypatch.setattr(module, "quantile_feature_subsets", lambda *args: {.1: ["x"], .9: ["x"]})
    fits = []

    class Head:
        def __init__(self, q):
            self.q = q
        def predict(self, X):
            return np.full(len(X), { .1: 0., .5: 15., .9: 35.}[self.q])

    def fit(X, y, quantiles=(.1, .5, .9), **kwargs):
        fits.append((X.copy(), y.copy()))
        return {q: Head(q) for q in quantiles}

    monkeypatch.setattr(module, "train_quantile_models", fit)
    output = tmp_path / "report.json"
    report = evaluate("qb", tmp_path, tmp_path / "schedules.parquet", output, "game_market_p50", [2019])
    assert all(y.tolist() == [0., 30.] for _, y in fits)
    assert all(X.x.max() == 2. for X, _ in fits)
    assert report["comparisons"][0]["train_seasons"] == [2018]
    saved = pd.read_parquet(tmp_path / "report_2019_rows.parquet")
    assert saved.Fpts.tolist() == [0., 30.]
    assert saved.reference_q50.tolist() == [15., 15.]
    assert output.exists()
    assert not report["diagnostic_gate"]["production_eligible"]
