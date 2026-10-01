"""Regression tests for observed input failures, including future independence."""

import numpy as np
import pandas as pd
import pytest

from src.core.features import feature_completeness, prepare_feature_matrix
from src.core.projection_context import build_projection_roster
from src.integrations.sleeper import _rookie_stub_from_template, apply_vet_backup_projection_scale
from src.projections.rookie_role import compute_rookie_role, scale_rookie_stub_features


def test_target_profile_includes_last_game_and_excludes_target_and_future():
    games = pd.DataFrame({
        "player_id": ["a"] * 4, "season": [2025, 2026, 2026, 2026],
        "week": [18, 1, 2, 3], "team": ["NO"] * 4,
        "carries_lead": [10., 20., 30., 1000.],
        "rush_attmpt_avg": [0., 10., 15., 20.],
    })
    roster = build_projection_roster(games, 2026, 3)
    assert roster.iloc[0]["rush_attmpt_avg"] == 20.
    assert roster.iloc[0]["_profile_week"] == 2
    assert roster.iloc[0]["week"] == 3
    changed = games.copy()
    changed.loc[3, "carries_lead"] = -9000
    pd.testing.assert_frame_equal(roster, build_projection_roster(changed, 2026, 3))
    assert build_projection_roster(games, 2025, 1).empty


def test_prior_profile_survives_when_player_has_not_played_this_season():
    games = pd.DataFrame({"player_id": ["a", "b"], "season": [2025, 2026], "week": [18, 1]})
    roster = build_projection_roster(games, 2026, 2).set_index("player_id")
    assert set(roster.index) == {"a", "b"}
    assert roster.loc["a", "_profile_season"] == 2025
    assert roster.loc["a", "season"] == 2026
    assert not roster.loc["a", "_opportunity_observed"]


def test_metadata_and_matchup_are_never_usage_scaled():
    stub = pd.Series({"passing_yards_avg": 100., "carry_share_avg": .1,
                      "_vet_backup_mult": .15, "_sleeper_depth_order": 3,
                      "_sleeper_search_rank": 108, "season": 2026, "week": 4,
                      "is_home": 1, "days_rest": 7, "opponent_pass_epa_allowed": -.2,
                      "implied_team_total_avg": 24., "target_quality_avg": .7})
    scaled = scale_rookie_stub_features(stub, stub, 2.75)
    assert scaled["passing_yards_avg"] == 275.
    for col in stub.index.difference(["passing_yards_avg", "carry_share_avg"]):
        assert scaled[col] == stub[col]


def test_week_four_mendoza_uses_current_backup_role_without_donor_flags(monkeypatch):
    monkeypatch.setattr("src.projections.rookie_role.sentiment_role_boost",
                        lambda **kw: pytest.fail("Research sentiment must not change live forecasts"))
    sleeper = pd.Series({"full_name": "Fernando Mendoza", "team": "LV", "position": "QB",
                         "depth_chart_order": 3, "search_rank": 108, "gsis_id": "mendoza", "sleeper_id": "m"})
    template = pd.Series({"passing_yards_avg": 100., "pass_attmpt_avg": 20.,
                          "_vet_backup_mult": .66, "_vet_backup_label": "donor",
                          "_sleeper_depth_order": 8, "_sleeper_search_rank": 999,
                          "_profile_week": 18, "season": 2025, "week": 18})
    stub = _rookie_stub_from_template(template, sleeper, season=2026, target_week=4,
                                    position="qb", medians=template)
    assert stub["_sleeper_depth_order"] == 3
    assert stub["_sleeper_search_rank"] == 108
    assert stub["_vet_backup_mult"] == .15
    assert "_profile_week" not in stub
    assert stub["_rookie_role_mult"] < 1
    assert "camp" not in stub["_rookie_role_label"]
    projection = pd.DataFrame({"Player": ["Fernando Mendoza"], "Team": ["LV"],
                               "Projected Points": [16.], "Low (P10)": [8.], "High (P90)": [24.]})
    discounted = apply_vet_backup_projection_scale(projection, pd.DataFrame([stub]))
    assert discounted.iloc[0]["Projected Points"] == 2.4
    assert np.isfinite(discounted["Projected Points"]).all()


def test_camp_override_expires_but_can_be_explicitly_scoped(monkeypatch):
    row = pd.Series({"full_name": "Test", "team": "LV", "position": "QB", "depth_chart_order": 3})
    monkeypatch.setattr("src.projections.rookie_role.load_rookie_role_overrides", lambda *a, **kw: [
        {"player": "Test", "role_mult": 2.75, "role_label": "starter-camp"}])
    assert compute_rookie_role("qb", row, season=2026, target_week=1)[0] == 2.75
    assert compute_rookie_role("qb", row, season=2026, target_week=4)[0] < 1
    monkeypatch.setattr("src.projections.rookie_role.load_rookie_role_overrides", lambda *a, **kw: [
        {"player": "Test", "role_mult": 2., "start_week": 3, "end_week": 4}])
    assert compute_rookie_role("qb", row, season=2026, target_week=4)[0] == 2.


def test_missing_features_remain_visible_after_compatibility_imputation():
    df = pd.DataFrame({"observed_zero": [0., 0.], "partial": [1., np.nan]})
    cols = ["observed_zero", "partial", "missing"]
    quality = feature_completeness(df, cols)
    assert quality["missing_columns"] == ["missing"]
    assert quality["null_counts"] == {"partial": 1}
    assert quality["all_zero_columns"] == ["observed_zero"]
    assert not quality["complete"]
    matrix = prepare_feature_matrix(df, "qb", feature_cols_override=cols)
    assert matrix.attrs["input_quality"] == quality


def test_candidate_merge_never_duplicates_keys_or_hides_missing_enrichment():
    from src.analytics.candidate_etl import merge_candidate_frame
    base = pd.DataFrame({"player_id": ["a", "b"], "season": [2026, 2026], "week": [1, 1]})
    candidates = base.iloc[:1].assign(routes_avg=24.)
    merged = merge_candidate_frame(base, candidates)
    assert len(merged) == 2
    assert merged.iloc[0]["routes_avg"] == 24.
    assert pd.isna(merged.iloc[1]["routes_avg"])
    with pytest.raises(ValueError, match="duplicate"):
        merge_candidate_frame(base, pd.concat([candidates, candidates]))


def test_snap_feed_maps_pfr_ids_to_gsis_without_name_guessing(monkeypatch):
    from types import SimpleNamespace
    from src.analytics import candidate_etl
    snaps = pd.DataFrame({"season": [2026, 2026], "week": [3, 3], "team": ["NO", "NO"],
                          "pfr_player_id": ["SameName01", "SameName02"],
                          "player": ["Same Name", "Same Name"], "offense_snaps": [40, 10],
                          "offense_pct": [.8, .2]})
    ids = pd.DataFrame({"pfr_id": ["SameName01", "SameName02"], "gsis_id": ["a", "b"]})
    fake = SimpleNamespace(import_snap_counts=lambda **kw: snaps, import_ids=lambda: ids)
    monkeypatch.setattr(candidate_etl, "_import_nfl_data_py", lambda: fake)
    result = candidate_etl._load_snap_counts([2026]).set_index("player_id")
    assert result.loc["a", "offense_snaps"] == 40
    assert result.loc["b", "offense_pct"] == .2


def test_normal_etl_import_does_not_silently_disable_enrichment(monkeypatch, tmp_path):
    from src.etl import nflverse_etl as etl
    from src.analytics import candidate_etl, historical_injury
    base = pd.DataFrame({"player_id": ["a"], "season": [2026], "week": [1], "Fpts": [10.]})
    calls = []
    monkeypatch.setattr("src.config.CANDIDATE_DATA_DIR", tmp_path)
    def build(pos, seasons, **kwargs):
        calls.append(pos)
        base.assign(routes_avg=24.).to_parquet(tmp_path / f"candidate_features_{pos}.parquet")
    monkeypatch.setattr(candidate_etl, "build_candidate_features", build)
    monkeypatch.setattr(historical_injury, "add_historical_injury_features", lambda d: d.assign(injury_opportunity_boost_hist_avg=.1))
    monkeypatch.setattr(etl, "load_weekly_player_stats", lambda s: base)
    monkeypatch.setattr(etl, "load_schedules", lambda s: pd.DataFrame())
    monkeypatch.setattr(etl, "load_play_by_play", lambda s: pd.DataFrame())
    monkeypatch.setattr(etl, "load_team_epa", lambda s, **kw: pd.DataFrame())
    monkeypatch.setattr(candidate_etl, "_load_snap_counts", lambda s: pd.DataFrame())
    monkeypatch.setattr(etl, "build_position_dataset", lambda *args: base.copy())
    monkeypatch.setattr(etl, "merge_target_quality_into_wr_features", None)
    paths = etl.build_all_datasets([2026], tmp_path / "processed")
    assert calls == ["qb", "rb", "wr"]
    for path in paths.values():
        saved = pd.read_parquet(path)
        assert saved.iloc[0]["routes_avg"] == 24.
        assert saved.iloc[0]["injury_opportunity_boost_hist_avg"] == .1


def test_failed_etl_publication_preserves_last_good_processed_file(monkeypatch, tmp_path):
    from src.etl import nflverse_etl as etl
    data = pd.DataFrame({"player_id": ["a"], "season": [2026], "week": [1], "Fpts": [10.]})
    path = tmp_path / "qb_mlready.parquet"
    data.assign(routes_avg=24.).to_parquet(path)
    original = path.read_bytes()
    monkeypatch.setattr(etl, "load_weekly_player_stats", lambda s: data)
    monkeypatch.setattr(etl, "load_schedules", lambda s: pd.DataFrame())
    monkeypatch.setattr(etl, "load_play_by_play", lambda s: pd.DataFrame())
    monkeypatch.setattr(etl, "load_team_epa", lambda s, **kw: pd.DataFrame())
    monkeypatch.setattr(etl, "merge_target_quality_into_wr_features", None)
    monkeypatch.setattr(etl, "build_position_dataset", lambda *a: data)
    def broken_write(frame, target):
        target.write_bytes(b"incomplete write")
        raise OSError("write failed")
    monkeypatch.setattr(etl, "write_parquet", broken_write)
    with pytest.raises(OSError, match="write failed"):
        etl.build_all_datasets([2026], tmp_path, enrich_analytics=False)
    assert path.read_bytes() == original
    assert not list(tmp_path.glob("*.tmp"))


def test_walk_forward_training_and_baselines_are_future_independent(monkeypatch, tmp_path):
    from src.pipeline import backtest
    df = pd.DataFrame({"player_id": ["a", "b", "a", "b", "a"],
                       "season": [2023, 2024, 2024, 2024, 2025], "week": [1, 1, 1, 2, 1],
                       "Fpts": [10., 30., 20., 40., 1000.], "passing_yards_avg": [100.] * 5})
    path = tmp_path / "qb_mlready.parquet"
    df.to_parquet(path)
    trained = []
    def train(x, y, *a, **kw):
        trained.append(list(y))
        return {}
    monkeypatch.setattr(backtest, "train_quantile_models", train)
    monkeypatch.setattr(backtest, "predict_quantiles", lambda m, x: pd.DataFrame(
        {"q10": 1., "q50": 10., "q90": 20.}, index=x.index))
    original = backtest.walk_forward_backtest("qb", tmp_path, [2024])
    assert trained == [[10.]]
    b = original[original.player_id == "b"].sort_values("week")
    assert list(b.season_avg_baseline) == [10., 30.]
    assert list(b.last_game_baseline) == [10., 30.]
    df.loc[df.season == 2025, "Fpts"] = -1000.
    df.to_parquet(path)
    pd.testing.assert_frame_equal(original, backtest.walk_forward_backtest("qb", tmp_path, [2024]))
    with pytest.raises(ValueError, match="training games"):
        backtest.walk_forward_backtest("qb", tmp_path, [2023])


def test_matchup_history_excludes_same_game_and_later_outcomes():
    from src.pipeline.backtest import lag_legacy_matchup_epa
    data = pd.DataFrame({"opponent": ["KC"] * 4, "season": [2024] * 4,
                         "week": [1, 1, 2, 3], "opponent_pass_epa_allowed": [.2, .2, .4, 999.]})
    before = lag_legacy_matchup_epa(data)
    assert list(before.opponent_pass_epa_allowed) == [0., 0., .2, pytest.approx(.3)]
    data.loc[data.week >= 2, "opponent_pass_epa_allowed"] = -999.
    after = lag_legacy_matchup_epa(data)
    assert before.loc[2, "opponent_pass_epa_allowed"] == after.loc[2, "opponent_pass_epa_allowed"]


def test_recent_roles_allocate_committee_touches_without_invented_injury_usage():
    from src.core.features import completed_game_profiles
    from src.core.opportunity import compute_vacated_usage
    data = pd.DataFrame({
        "player_id": ["kamara", "miller", "etienne", "kamara", "miller", "etienne"],
        "player_display_name": ["Kamara", "Miller", "Etienne"] * 2,
        "season": [2026] * 6, "week": [2] * 3 + [3] * 3, "team": ["NO"] * 6,
        "position": ["RB"] * 6, "carries_lead": [9., 9., 12., 9., 9., 12.],
        "carry_share_avg": [.7, .1, .65] * 2,
    })
    profiles = completed_game_profiles(data).groupby("player_id").tail(1)
    synthetic = profiles.iloc[:1].assign(player_id="stub", player_display_name="Stub",
        _roster_estimate=True, _opportunity_observed=False, _opportunity_carry_share=.9)
    profiles = pd.concat([profiles, synthetic], ignore_index=True)
    injuries = pd.DataFrame({"full_name": ["Etienne", "Stub"], "team": ["NO", "NO"],
                             "position": ["RB", "RB"], "injury_status": ["Out", "IR"]})
    adjusted = compute_vacated_usage(profiles, injuries).set_index("player_id")
    assert adjusted.loc["kamara", "injury_opportunity_boost"] == pytest.approx(.2)
    assert adjusted.loc["miller", "injury_opportunity_boost"] == pytest.approx(.2)
    assert "Stub" not in adjusted.loc["kamara", "injury_note"]


def test_target_schedule_replaces_previous_venue_and_rest(monkeypatch):
    from src.core import schedule_utils
    schedules = pd.DataFrame({"season": [2026, 2026], "week": [3, 4],
                              "home_team": ["KC", "LV"], "away_team": ["LV", "KC"],
                              "gameday": ["2026-09-27", "2026-10-04"]})
    monkeypatch.setattr(schedule_utils, "_load_schedules", lambda *a, **kw: schedules)
    monkeypatch.setattr(schedule_utils, "teams_on_bye", lambda *a: set())
    roster = pd.DataFrame({"team": ["KC"], "opponent": ["LV"], "is_home": [1],
                           "days_rest": [4], "gameday": ["2026-09-27"]})
    updated = schedule_utils.attach_schedule_context(roster, 2026, 4)
    assert updated.iloc[0]["is_home"] == 0
    assert updated.iloc[0]["days_rest"] == 7


def test_injury_overlay_prepares_prior_games_for_unplayed_target_week(tmp_path, monkeypatch):
    from src.projections import injury_overlay
    data = pd.DataFrame({"player_id": ["a"], "season": [2026], "week": [3],
                         "team": ["NO"], "carry_share_avg": [.3]})
    data.to_parquet(tmp_path / "rb_mlready.parquet")
    calls = []
    def prepare(df, pos, season, week, **kwargs):
        calls.append((pos, season, week, kwargs["depth_mode"]))
        return df.assign(week=week, _opportunity_carry_share=.4), {}
    monkeypatch.setattr("src.core.projection_context.build_inference_roster", prepare)
    rows = injury_overlay._load_roster_features(2026, 4, {"NO"}, data_dir=tmp_path)
    assert calls == [("rb", 2026, 4, "coverage")]
    assert rows.iloc[0]["_opportunity_carry_share"] == .4


def test_ros_cold_path_applies_backup_discount_once(monkeypatch):
    from src.projections import ros_projections
    roster = pd.DataFrame({"player_display_name": ["Backup"], "team": ["LV"], "_vet_backup_mult": [.15]})
    monkeypatch.setattr(ros_projections, "load_weekly_prediction", lambda *a, **kw: pd.DataFrame())
    monkeypatch.setattr(ros_projections, "build_inference_roster", lambda *a, **kw: (roster, {}))
    monkeypatch.setattr("src.core.schedule_utils.attach_schedule_context", lambda d, *a: d)
    monkeypatch.setattr(ros_projections, "predict_from_features", lambda *a, **kw: pd.DataFrame({
        "Player": ["Backup"], "Team": ["LV"], "Projected Points": [16.],
        "Low (P10)": [8.], "High (P90)": [24.]}))
    weekly = ros_projections._load_or_predict_weekly("qb", 2026, 4,
        apply_injury_adjustments=False, data_dir=None, model_dir=None, df=pd.DataFrame())
    assert weekly.iloc[0]["Projected Points"] == 2.4
