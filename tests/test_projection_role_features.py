import numpy as np
import pandas as pd
import pytest

from src.analytics.forecast_candidate_eval import candidate_contract, publication_evidence
from src.analytics.role_features import attach_position, role_feature_cols, role_history, role_inference_inputs
from src.ml.training_config import WR_P90_BOOM_WEIGHT_3


def games():
    data = pd.DataFrame({"player_id": ["a"]*7, "season": [2024]*4 + [2025]*3,
                         "week": [1, 2, 3, 4, 1, 3, 4], "position": "TE"})
    for raw in ("offense_pct_lead", "target_share_lead", "air_yards_share_lead", "rz_targets_lead"):
        data[raw] = [.1, .2, np.nan, .4, 0., .8, 999.]
    return data


@pytest.mark.parametrize("target", [4, 5, 6])
def test_role_train_serve_parity_excludes_target_and_future_games(target):
    data = games()
    trained = role_history(data, "wr")
    row = data.iloc[[target]].copy()
    served = role_inference_inputs(row, data, "wr")
    for col in role_feature_cols("wr"):
        assert served.iloc[0][col] == pytest.approx(trained.iloc[target][col])
    changed = data.copy()
    changed.loc[target:, list(c for c in data if c.endswith("_lead"))] = -9999.
    pd.testing.assert_frame_equal(served, role_inference_inputs(row, changed, "wr"))
    assert served.iloc[0].is_tight_end == 1.


def test_new_season_role_preserves_played_zero_and_does_not_impute_missing():
    out = role_history(games(), "wr")
    assert out.iloc[4].recent4_offense_pct_avg == pytest.approx(.7 / 3)
    assert out.iloc[5].recent4_offense_pct_avg == 0.
    assert out.iloc[6].recent4_offense_pct_avg == .4
    assert np.isnan(out.iloc[0].recent4_offense_pct_avg)


def test_unseen_players_stay_missing_and_caller_order_is_preserved():
    rows = pd.DataFrame({"player_id": ["unknown", "a"], "season": 2025, "week": 4,
                         "position": ["WR", "TE"]}, index=[19, 3])
    out = role_inference_inputs(rows, games().sample(frac=1, random_state=1), "wr")
    assert out.index.tolist() == [19, 3]
    assert out.loc[19, role_feature_cols("wr")].isna().all()
    assert out.loc[3, "recent4_offense_pct_avg"] == .4
    assert out.is_tight_end.tolist() == [0., 1.]
    assert role_inference_inputs(rows.iloc[:0], games(), "wr").empty


def test_opener_fallback_counts_last_four_games_across_seasons():
    data = games()
    rows = pd.DataFrame({"player_id": ["a"], "season": [2026], "week": [1], "position": "TE"})
    served = role_inference_inputs(rows, data, "wr")
    assert served.iloc[0].recent4_offense_pct_avg == pytest.approx((.4 + 0. + .8 + 999.) / 4.)


def test_role_research_rejects_ambiguous_sources_and_contexts():
    data = games()
    with pytest.raises(ValueError, match="unique"):
        role_history(pd.concat([data, data.iloc[[0]]]), "wr")
    with pytest.raises(ValueError, match="source"):
        role_history(data.drop(columns="offense_pct_lead"), "wr")
    with pytest.raises(ValueError, match="RB and WR"):
        role_feature_cols("qb")
    with pytest.raises(ValueError, match="one target"):
        role_inference_inputs(data.iloc[[4, 5]], data, "wr")
    with pytest.raises(ValueError, match="explicit WR or TE"):
        attach_position(data.assign(position="REC"))


def test_role_candidate_remains_research_only_and_keeps_reference_features(monkeypatch):
    cols = ["recent4_Fpts_avg", "targets_avg"]
    alpha, candidate_cols, config = candidate_contract("current_role_p50", cols, WR_P90_BOOM_WEIGHT_3, "wr")
    assert alpha == .5
    assert candidate_cols == cols + role_feature_cols("wr") + ["is_tight_end"]
    assert cols == ["recent4_Fpts_avg", "targets_avg"]
    assert config is WR_P90_BOOM_WEIGHT_3
    with pytest.raises(ValueError, match="WR/TE"):
        candidate_contract("position_p50", cols, config, "rb")
    # Even a successful research gate cannot authorize unversioned role inputs.
    monkeypatch.setattr("src.analytics.forecast_candidate_eval.diagnostic_gate",
                        lambda comparisons: {"research_qualified": True})
    with pytest.raises(ValueError, match="Only a complete qualified game-market"):
        publication_evidence({"candidate": "current_role_p50", "comparisons": []})
