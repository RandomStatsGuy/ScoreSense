"""Causality, source integrity and coherent training regressions."""

from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from src.analytics.recent_usage_eval import promotion_gate
from src.projections.temporal_inputs import (
    PREGAME_POLICY, RECENT_POLICY, RECENT_SEASON_POLICY, RECENT_MEDIAN_POLICY, attach_pregame_defense, inference_inputs, training_inputs,
)


def games():
    return pd.DataFrame({"player_id": ["a"]*6, "player_display_name": ["A"]*6,
        "season": [2024]*3 + [2025]*3, "week": [1, 2, 3, 1, 2, 3], "team": ["KC"]*6,
        "opponent": ["LV"]*6, "Fpts": [12., 0., -2., 20., 10., 999.],
        "opponent_pass_epa_allowed": [.1, .2, .3, .4, .5, 99.],
        "opponent_rush_epa_allowed": [.2]*6, "attempts_lead": [20.]*6,
        "passing_yards_lead": [100., 0., 0., 200., 150., 9999.],
        "carries_lead": [5.]*6, "rushing_yards_lead": [10.]*6, "passing_yards_avg": [50.]*6})


def test_training_and_serving_use_identical_prior_games_and_target_opponent():
    data = games()
    target = data.iloc[[5]].copy()
    trained = training_inputs(data, "qb", RECENT_POLICY).set_index(["season", "week"])
    served = inference_inputs(target, data, "qb", RECENT_POLICY).iloc[0]
    assert served["recent4_Fpts_avg"] == 7.  # includes played zero and negative
    assert served["opponent_pass_epa_allowed"] == pytest.approx(.3)
    for col in ("recent4_Fpts_avg", "recent4_passing_yards_avg", "opponent_pass_epa_allowed"):
        assert served[col] == pytest.approx(trained.loc[(2025, 3), col])
    changed = data.copy()
    changed.loc[5, ["Fpts", "passing_yards_lead", "opponent_pass_epa_allowed"]] = -9000.
    pd.testing.assert_frame_equal(inference_inputs(target, data, "qb", RECENT_POLICY),
                                  inference_inputs(target, changed, "qb", RECENT_POLICY))


def test_defensive_context_deduplicates_games_and_excludes_same_week():
    data = pd.concat([games(), games()], ignore_index=True)
    target = pd.DataFrame({"opponent": ["LV", "KC", "LV"], "season": [2025]*3, "week": [3, 3, 1]}, index=[8, 3, 1])
    out = attach_pregame_defense(target, data)
    assert list(out.index) == [8, 3, 1]
    assert out.iloc[0].opponent_pass_epa_allowed == pytest.approx(.3)
    assert pd.isna(out.iloc[1].opponent_pass_epa_allowed)
    assert out.iloc[2].opponent_pass_epa_allowed == pytest.approx(.2)


def test_season_role_candidate_uses_new_season_evidence_and_pregame_opener_fallback():
    data = games()
    trained = training_inputs(data, "qb", RECENT_SEASON_POLICY).set_index(["season", "week"])
    served = inference_inputs(data.iloc[[5]], data, "qb", RECENT_SEASON_POLICY)
    assert trained.loc[(2025, 3), "recent4_Fpts_avg"] == 15.
    assert served.iloc[0].recent4_Fpts_avg == 15.
    opener = inference_inputs(data.iloc[[3]], data, "qb", RECENT_SEASON_POLICY)
    assert opener.iloc[0].recent4_Fpts_avg == pytest.approx(10./3)
    assert opener.iloc[0].recent4_Fpts_avg == trained.loc[(2025, 1), "recent4_Fpts_avg"]


def test_raw_target_quality_does_not_use_future_normalization():
    data = games().assign(targets_lead=5., receptions_lead=3., receiving_yards_lead=50.,
                          receiving_air_yards_lead=70., target_quality_raw_lead=[1.,2.,3.,4.,5.,9999.])
    old = training_inputs(data, "wr", PREGAME_POLICY)
    data.loc[5, "target_quality_raw_lead"] = -9999.
    new = training_inputs(data, "wr", PREGAME_POLICY)
    pd.testing.assert_series_equal(old.target_quality_raw_avg, new.target_quality_raw_avg)
    served = inference_inputs(data.iloc[[5]], data, "wr", PREGAME_POLICY)
    assert served.iloc[0].target_quality_raw_avg == 3.


def test_gate_requires_all_six_seasons_and_limits_boom_regression():
    rows = [{"season": s, "baseline": {"composite": .8, "boom_recall": .7},
             "recent": {"composite": .75, "boom_recall": .69}} for s in range(2019, 2025)]
    assert promotion_gate(rows)["passed"]
    assert not promotion_gate(rows)["eligible_for_publication"]  # no later check
    holdout = {"season": 2025, "baseline": {"composite": .8, "boom_recall": .7},
               "recent": {"composite": .7, "boom_recall": .69}}
    assert promotion_gate(rows + [holdout])["eligible_for_publication"]
    holdout["recent"]["boom_recall"] = .65
    assert not promotion_gate(rows + [holdout])["eligible_for_publication"]
    assert not promotion_gate(rows[:-1])["passed"]
    rows[0]["recent"]["boom_recall"] = .67
    assert not promotion_gate(rows)["passed"]


def test_chronological_training_retains_zeros_and_refits_all_rows(tmp_path, monkeypatch):
    import joblib
    from src.pipeline import train
    data = games()
    data.to_parquet(tmp_path / "qb_mlready.parquet")
    monkeypatch.setattr(train, "get_position_features", lambda pos: SimpleNamespace(feature_cols=("passing_yards_avg", "opponent_pass_epa_allowed")))
    fits = []
    def fit(X, y, *args, **kwargs):
        fits.append(list(y))
        return {"placeholder": True}
    monkeypatch.setattr(train, "train_quantile_models", fit)
    monkeypatch.setattr(train, "predict_quantiles", lambda m, X: pd.DataFrame({"q10": 0., "q50": 10., "q90": 20.}, index=X.index))
    metrics = train.train_position_model("qb", tmp_path, [2024, 2025], tmp_path / "models")
    assert fits[0] == [12., 0., -2.]
    assert fits[1] == list(data.Fpts)
    assert metrics["zero_or_negative_rows"] == 2
    assert metrics["fit_max_season_before_validation"] == 2024
    bundle = joblib.load(tmp_path / "models/qb_model.joblib")
    assert bundle["input_policy"] == PREGAME_POLICY
    assert bundle["train_seasons"] == [2024, 2025]
    assert bundle["training_digest"] == metrics["training_digest"]


def test_recent_candidate_cannot_be_published_without_matching_gate(tmp_path, monkeypatch):
    from src.pipeline import train
    games().to_parquet(tmp_path / "qb_mlready.parquet")
    monkeypatch.setattr(train, "get_position_features", lambda pos: SimpleNamespace(feature_cols=("passing_yards_avg",)))
    monkeypatch.setattr(train, "train_quantile_models", lambda *a, **kw: pytest.fail("Ungated fitting"))
    with pytest.raises(ValueError, match="passed gate"):
        train.train_position_model("qb", tmp_path, [2024, 2025], tmp_path / "models", input_policy=RECENT_POLICY)
    assert not (tmp_path / "models").exists()


def test_train_all_updates_the_calibrated_serving_bundles(tmp_path, monkeypatch):
    from src.pipeline import train
    calls = []
    tmp_path.mkdir(exist_ok=True)
    monkeypatch.setattr(train, "train_position_model", lambda pos, **kw: calls.append(pos) or {})
    monkeypatch.setattr(train, "train_rb_calibrated_model", lambda *a: calls.append("rb_calibrated") or {})
    monkeypatch.setattr(train, "train_wr_calibrated_model", lambda *a: calls.append("wr_calibrated") or {})
    monkeypatch.setattr(train, "PROJECTION_MODEL_GATES_DIR", tmp_path / "no_gates")
    train.train_all(model_dir=tmp_path)
    assert calls == ["qb", "rb", "wr", "rb_calibrated", "wr_calibrated"]


def test_failed_later_position_does_not_publish_partial_model_set(tmp_path, monkeypatch):
    from src.pipeline import train
    model_dir = tmp_path / "models"
    model_dir.mkdir()
    previous = model_dir / "qb_model.joblib"
    previous.write_bytes(b"last good model")
    monkeypatch.setattr(train, "PROJECTION_MODEL_GATES_DIR", tmp_path / "no_gates")
    def fit(pos, **kwargs):
        if pos == "rb":
            raise RuntimeError("source failed")
        (kwargs["model_dir"] / "qb_model.joblib").write_bytes(b"new model")
        return {}
    monkeypatch.setattr(train, "train_position_model", fit)
    with pytest.raises(RuntimeError, match="source failed"):
        train.train_all(model_dir=model_dir)
    assert previous.read_bytes() == b"last good model"
    assert list(model_dir.iterdir()) == [previous]


def test_new_fumble_schemas_preserve_totals_without_double_counting():
    from src.etl.nflverse_etl import _normalize_weekly_columns
    data = pd.DataFrame({"fumbles_total": [3., np.nan], "rushing_fumbles": [1., 2.],
                         "receiving_fumbles": [1., 1.], "sack_fumbles": [1., 0.],
                         "rushing_fumbles_lost": [1., 0.], "sack_fumbles_lost": [0., 1.]})
    out = _normalize_weekly_columns(data)
    assert list(out.fumbles) == [3., 3.]
    assert list(out.fumbles_lost) == [1., 1.]


def test_target_quality_aliases_do_not_duplicate_player_games():
    from bdb_companion.target_quality import build_pbp_target_quality, merge_target_quality_into_wr_features
    pbp = pd.DataFrame({"season": [2026]*2, "week": [1]*2, "receiver_player_id": ["a"]*2,
                       "receiver": ["Alias A", "Alias B"], "pass": [1, 1], "air_yards": [10., 20.],
                       "cpoe": [0.,0.], "xyac_epa": [0.,0.], "epa": [1.,2.], "pass_touchdown": [0,0]})
    tq = build_pbp_target_quality(pbp=pbp)
    assert len(tq) == 1
    assert tq.iloc[0].targets == 2
    spine = pd.DataFrame({"player_id": ["a"], "season": [2026], "week": [1], "offense_pct_avg": [np.nan]})
    out = merge_target_quality_into_wr_features(spine, tq)
    assert len(out) == 1 and pd.isna(out.iloc[0].offense_pct_avg)
    assert "target_quality_raw_lead" in out


def test_shared_pbp_does_not_request_unneeded_participation(monkeypatch):
    from src.etl import nflverse_etl as etl
    calls = []
    monkeypatch.setattr(etl, "_import_nfl_data_py", lambda: SimpleNamespace(import_pbp_data=lambda **kw: calls.append(kw) or pd.DataFrame()))
    etl.load_play_by_play([2026])
    assert calls[0]["include_participation"] is False
    assert calls[0]["downcast"] is False
    assert {"epa", "receiver_player_id", "pass_oe", "xyac_epa"}.issubset(calls[0]["columns"])


def test_median_candidate_keeps_the_fitted_tail_feature_contracts():
    from src.ml.quantile import train_quantile_models, predict_quantiles
    from src.ml.training_config import TrainingConfig
    from src.projections.temporal_inputs import quantile_feature_subsets
    X = pd.DataFrame({"career": np.arange(20.), "recent4_Fpts_avg": np.arange(20.)[::-1]})
    cfg = TrainingConfig(name="small_contract_test", regressor_overrides_by_alpha={q: {"n_estimators": 2, "max_depth": 1} for q in (.1, .5, .9)})
    subsets = quantile_feature_subsets("qb", list(X.columns), RECENT_MEDIAN_POLICY)
    models = train_quantile_models(X, np.arange(20.), training_config=cfg, feature_cols_by_alpha=subsets)
    assert list(models[.1].feature_names_in_) == ["career"]
    assert list(models[.5].feature_names_in_) == list(X.columns)
    assert list(models[.9].feature_names_in_) == ["career"]
    assert np.isfinite(predict_quantiles(models, X)).all().all()


def test_auto_training_gate_accepts_matching_data_and_rejects_revision(tmp_path, monkeypatch):
    import json
    from src.core.features import prepare_feature_matrix
    from src.pipeline import train
    from src.projections.temporal_inputs import feature_digest, policy_feature_cols

    data = games()
    data.to_parquet(tmp_path / "qb_mlready.parquet")
    monkeypatch.setattr(train, "PROJECTION_MODEL_GATES_DIR", tmp_path)
    monkeypatch.setattr(train, "get_position_features", lambda pos: SimpleNamespace(feature_cols=("passing_yards_avg",)))
    cols = policy_feature_cols("qb", ["passing_yards_avg"], RECENT_MEDIAN_POLICY)
    inputs = training_inputs(data, "qb", RECENT_MEDIAN_POLICY).sort_values(["player_id", "season", "week"])
    X = prepare_feature_matrix(inputs, "qb", feature_cols_override=cols)
    path = tmp_path / "recent_usage_gate_qb.json"
    path.write_text(json.dumps({"gate": {"eligible_for_publication": True}, "pregame_safe": True,
        "candidate_policy": RECENT_MEDIAN_POLICY, "position": "qb",
        "training_config": train.DEFAULT_TRAINING_CONFIG.name,
        "training_specification": train.training_specification(train.DEFAULT_TRAINING_CONFIG, "qb"), "feature_cols": cols,
        "training_through_2024_digest": feature_digest(X, inputs.Fpts)}))
    options = train.gated_training_options("qb", tmp_path, [2024, 2025], train.DEFAULT_TRAINING_CONFIG)
    assert options == {"input_policy": RECENT_MEDIAN_POLICY, "gate_report": path}
    from dataclasses import replace
    changed_preset = replace(train.DEFAULT_TRAINING_CONFIG, regressor_overrides_by_alpha={.5: {"max_depth": 2}})
    assert train.gated_training_options("qb", tmp_path, [2024, 2025], changed_preset) == {}
    data.loc[0, "Fpts"] = 50.
    data.to_parquet(tmp_path / "qb_mlready.parquet")
    assert train.gated_training_options("qb", tmp_path, [2024, 2025], train.DEFAULT_TRAINING_CONFIG) == {}
    with pytest.raises(ValueError, match="QB refresh cannot use the configured qualified model"):
        train.gated_training_options("qb", tmp_path, [2024, 2025], train.DEFAULT_TRAINING_CONFIG,
                                     require_qualified=True)


def test_full_refresh_preflights_all_serving_contracts_before_any_fit(tmp_path, monkeypatch):
    from src.pipeline import train
    previous = tmp_path / "qb_model.joblib"
    previous.write_bytes(b"previous qualified model")
    checks = []
    def options(position, data_dir, seasons, config, *, require_qualified):
        assert require_qualified
        checks.append((position, config.name))
        if position == "rb":
            raise ValueError("RB refresh cannot use the configured qualified model")
        return {"input_policy": RECENT_MEDIAN_POLICY}
    monkeypatch.setattr(train, "gated_training_options", options)
    monkeypatch.setattr(train, "train_position_model", lambda *a, **kw: pytest.fail("Fitting before serving qualification"))
    with pytest.raises(ValueError, match="RB refresh"):
        train.train_all(data_dir=tmp_path, model_dir=tmp_path)
    assert checks == [("qb", "default"), ("rb", "rb_p90_boom_3")]
    assert previous.read_bytes() == b"previous qualified model"
    assert list(tmp_path.iterdir()) == [previous]


def test_preflight_policies_apply_to_serving_bundles_with_their_actual_presets(tmp_path, monkeypatch):
    from src.pipeline import train
    checks, fits = [], []
    def options(position, data_dir, seasons, config, *, require_qualified):
        checks.append((position, config.name, require_qualified))
        return {"input_policy": RECENT_MEDIAN_POLICY, "gate_report": tmp_path / f"{position}.json"}
    monkeypatch.setattr(train, "gated_training_options", options)
    monkeypatch.setattr(train, "train_position_model", lambda pos, **kw: fits.append((pos, kw.get("input_policy"))) or {})
    monkeypatch.setattr(train, "train_rb_calibrated_model", lambda *a, **kw: fits.append(("rb_calibrated", kw["input_policy"])) or {})
    monkeypatch.setattr(train, "train_wr_calibrated_model", lambda *a, **kw: fits.append(("wr_calibrated", kw["input_policy"])) or {})
    train.train_all(data_dir=tmp_path, model_dir=tmp_path)
    assert checks == [("qb", "default", True), ("rb", "rb_p90_boom_3", True), ("wr", "wr_p90_boom_3", True)]
    assert fits == [("qb", RECENT_MEDIAN_POLICY), ("rb", None), ("wr", None),
                    ("rb_calibrated", RECENT_MEDIAN_POLICY), ("wr_calibrated", RECENT_MEDIAN_POLICY)]


def test_unknown_qualified_policy_cannot_silently_publish_the_baseline(tmp_path, monkeypatch):
    import json
    from src.pipeline import train
    monkeypatch.setattr(train, "PROJECTION_MODEL_GATES_DIR", tmp_path)
    (tmp_path / "recent_usage_gate_wr.json").write_text(json.dumps({
        "gate": {"eligible_for_publication": True}, "candidate_policy": "unrecognized_future_policy"}))
    with pytest.raises(ValueError, match="WR refresh"):
        train.gated_training_options("wr", tmp_path, [2024], train.WR_P90_BOOM_WEIGHT_3, require_qualified=True)


def test_weekly_loader_prefers_consistent_current_schema_and_logs_fallback(monkeypatch, capsys):
    from src.etl import nflverse_etl as etl
    urls, fallback_calls = [], []
    def read(url):
        urls.append(url)
        return pd.DataFrame({"recent_team": ["KC"], "passing_interceptions": [2]})
    monkeypatch.setattr(etl.pd, "read_parquet", read)
    monkeypatch.setattr(etl, "_import_nfl_data_py", lambda: SimpleNamespace(import_weekly_data=lambda **kw: fallback_calls.append(kw) or pd.DataFrame({"team": ["BUF"]})))
    assert etl._load_weekly_season(2020).iloc[0].interceptions == 2
    assert urls == ["https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_2020.parquet"]
    assert not fallback_calls
    monkeypatch.setattr(etl.pd, "read_parquet", lambda url: (_ for _ in ()).throw(OSError("feed unavailable")))
    assert etl._load_weekly_season(2020).iloc[0].team == "BUF"
    assert fallback_calls == [{"years": [2020], "downcast": False}]
    assert "trying legacy source" in capsys.readouterr().out
