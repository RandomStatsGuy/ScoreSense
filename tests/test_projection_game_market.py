from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from src.core.game_market import MARKET_COLS, missing_market
from src.projections.temporal_inputs import (
    MARKET_MEDIAN_POLICY, RECENT_MEDIAN_POLICY, inference_inputs, policy_feature_cols,
    quantile_feature_subsets, training_inputs,
)
from tests.test_projection_temporal_inputs import games


def schedule():
    return pd.DataFrame({"season": [2025]*3, "week": [1, 2, 3], "home_team": "KC", "away_team": "LV",
                         "spread_line": [4., 6., 8.], "total_line": [40., 44., 48.]})


def test_market_train_serve_parity_and_target_game_context():
    data = games()
    trained = training_inputs(data, "qb", MARKET_MEDIAN_POLICY, schedule())
    served = inference_inputs(data.iloc[[5]], data, "qb", MARKET_MEDIAN_POLICY, schedule())
    for col in (*MARKET_COLS, "recent4_Fpts_avg", "recent4_passing_yards_avg", "opponent_pass_epa_allowed"):
        assert served.iloc[0][col] == pytest.approx(trained.iloc[5][col])
    assert served.game_implied_team_total.item() == 28.
    changed = data.copy()
    changed.loc[5, ["Fpts", "passing_yards_lead", "opponent_pass_epa_allowed"]] = -999.
    pd.testing.assert_frame_equal(served, inference_inputs(data.iloc[[5]], changed, "qb", MARKET_MEDIAN_POLICY, schedule()))


def test_market_policy_keeps_legacy_tails_and_separate_reference_contract():
    base = ["implied_team_total_avg", "total_line_avg", "passing_yards_avg"]
    cols = policy_feature_cols("qb", base, MARKET_MEDIAN_POLICY)
    subset = quantile_feature_subsets("qb", cols, MARKET_MEDIAN_POLICY)
    assert subset[.1] == subset[.9] == base
    assert all(c in subset[.5] for c in MARKET_COLS)
    assert "implied_team_total_avg" not in subset[.5]
    assert set(policy_feature_cols("qb", base, RECENT_MEDIAN_POLICY)).issubset(cols)


def test_new_policy_uses_cached_schedule_without_fetching(monkeypatch):
    from src.core import schedule_utils
    calls = []
    def load(seasons, *, allow_fetch):
        calls.append(allow_fetch)
        return pd.DataFrame()
    monkeypatch.setattr(schedule_utils, "_load_schedules", load)
    output = inference_inputs(games().iloc[[5]], games(), "qb", MARKET_MEDIAN_POLICY)
    assert calls == [False]
    assert missing_market(output).all()


def test_schedule_without_market_quotes_preserves_player_rows():
    quotes = schedule().drop(columns=["spread_line", "total_line"])
    output = inference_inputs(games().iloc[[5]], games(), "qb", MARKET_MEDIAN_POLICY, quotes)
    assert len(output) == 1
    assert missing_market(output).all()


@pytest.mark.parametrize("bad_quote", [np.nan, np.inf, 0., -1.])
def test_missing_market_uses_qualified_reference_median(monkeypatch, bad_quote):
    from src.projections import predict
    from src.core import schedule_utils

    class Head:
        def __init__(self, value):
            self.value = value
            self.feature_names_in_ = np.array(["recent4_Fpts_avg"])
        def predict(self, X):
            return np.full(len(X), self.value)

    cols = policy_feature_cols("qb", ["passing_yards_avg"], MARKET_MEDIAN_POLICY)
    bundle = {"input_policy": MARKET_MEDIAN_POLICY, "feature_cols": cols,
              "quantile_models": {.1: Head(1.), .5: Head(22.), .9: Head(30.)},
              "market_fallback_model": Head(15.)}
    monkeypatch.setattr(predict, "load_model", lambda *a: bundle)
    monkeypatch.setattr(predict, "_attach_sleeper_injury_status", lambda f: f)
    source = schedule()
    source.loc[source.week.eq(3), "total_line"] = bad_quote
    monkeypatch.setattr(schedule_utils, "_load_schedules", lambda *a, **kw: source)
    result = predict.predict_from_features(games().iloc[[5]], "qb", apply_injury_adjustments=False, history=games())
    assert result["Projected Points"].item() == 15.
    assert result["Low (P10)"].item() == 1.
    assert result["High (P90)"].item() == 30.
    assert result.attrs["input_quality"]["market_fallback_rows"] == 1
    monkeypatch.setattr(schedule_utils, "_load_schedules", lambda *a, **kw: schedule())
    quoted = predict.predict_from_features(games().iloc[[5]], "qb", apply_injury_adjustments=False, history=games())
    assert quoted["Projected Points"].item() == 22.
    assert quoted.attrs["input_quality"]["market_fallback_rows"] == 0
    bundle.pop("market_fallback_model")
    with pytest.raises(ValueError, match="fallback median"):
        predict.predict_from_features(games().iloc[[5]], "qb", apply_injury_adjustments=False, history=games())


def test_market_gate_rejects_false_alarms_and_falls_back_to_recent_gate(tmp_path, monkeypatch):
    import json
    from src.pipeline import train
    from src.core.features import prepare_feature_matrix
    from src.projections.temporal_inputs import feature_digest

    data = games()
    data.to_parquet(tmp_path / "qb_mlready.parquet")
    monkeypatch.setattr(train, "PROJECTION_MODEL_GATES_DIR", tmp_path)
    monkeypatch.setattr(train, "get_position_features", lambda p: SimpleNamespace(feature_cols=("passing_yards_avg",)))
    cols = policy_feature_cols("qb", ["passing_yards_avg"], RECENT_MEDIAN_POLICY)
    inputs = training_inputs(data, "qb", RECENT_MEDIAN_POLICY)
    valid = {"candidate_policy": RECENT_MEDIAN_POLICY, "position": "qb", "pregame_safe": True,
             "training_config": "default", "training_specification": train.training_specification(train.DEFAULT_TRAINING_CONFIG, "qb"),
             "feature_cols": cols, "gate": {"eligible_for_publication": True},
             "training_through_2024_digest": feature_digest(prepare_feature_matrix(inputs, "qb", feature_cols_override=cols), inputs.Fpts)}
    (tmp_path / "recent_usage_gate_qb.json").write_text(json.dumps(valid))
    invalid = {**valid, "candidate_policy": MARKET_MEDIAN_POLICY, "comparisons": []}
    (tmp_path / "game_market_gate_qb.json").write_text(json.dumps(invalid))
    chosen = train.gated_training_options("qb", tmp_path, [2024, 2025], train.DEFAULT_TRAINING_CONFIG)
    assert chosen["input_policy"] == RECENT_MEDIAN_POLICY


def test_refresh_saves_fresh_schedule_without_losing_prior_training_seasons(tmp_path, monkeypatch):
    from src.etl import nflverse_etl as etl
    from src.core import schedule_utils
    from src.projections import input_policy

    processed = tmp_path / "processed"
    cache = tmp_path / "cache"
    cache.mkdir()
    monkeypatch.setattr(etl, "PROCESSED_DATA_DIR", processed)
    monkeypatch.setattr(schedule_utils, "SCHEDULE_CACHE", cache / "nfl_schedules.parquet")
    monkeypatch.setattr(input_policy, "CACHE_DIR", cache)
    schedule().assign(season=2018).to_parquet(schedule_utils.SCHEDULE_CACHE)
    before = input_policy.projection_input_revisions()
    data = pd.DataFrame({"player_id": ["a"], "season": [2025], "week": [1], "Fpts": [10.]})
    monkeypatch.setattr(etl, "load_weekly_player_stats", lambda s: data)
    monkeypatch.setattr(etl, "load_schedules", lambda s: schedule())
    monkeypatch.setattr(etl, "load_play_by_play", lambda s: pd.DataFrame())
    monkeypatch.setattr(etl, "load_team_epa", lambda s, **kw: pd.DataFrame())
    monkeypatch.setattr(etl, "merge_target_quality_into_wr_features", None)
    monkeypatch.setattr(etl, "build_position_dataset", lambda *a: data)
    etl.build_all_datasets([2025], enrich_analytics=False)
    assert pd.read_parquet(processed / "nfl_schedules.parquet").season.eq(2025).all()
    shared = pd.read_parquet(schedule_utils.SCHEDULE_CACHE)
    assert set(shared.season) == {2018, 2025}
    assert shared.loc[shared.season.eq(2025), "market_fetched_at_utc"].notna().all()
    assert input_policy.projection_input_revisions() != before
    assert not list(cache.glob("*.tmp"))
    previous = schedule_utils.SCHEDULE_CACHE.read_bytes()
    monkeypatch.setattr(etl, "load_schedules", lambda s: pd.DataFrame())
    etl.build_all_datasets([2025], enrich_analytics=False)
    assert schedule_utils.SCHEDULE_CACHE.read_bytes() == previous
