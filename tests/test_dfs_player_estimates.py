import numpy as np
import pandas as pd
import pytest

from src.projections.dfs_pool import starting_kickers, special_team_predictions, load_dfs_pool, unavailable_roster_rows
from src.projections.dfs_special_teams import score_history, features_before, VERSION
from src.products.dfs_salaries import attach_salaries_to_pool, parse_salary_csv


def test_blank_export_ids_do_not_disable_alias_recovery_or_duplicate_players():
    pool = pd.DataFrame([{"player_id": "a", "Player": "James Cook", "Position": "RB", "Team": "BUF", "Projected Points": 15, "Low (P10)": 4, "High (P90)": 28},
                         {"player_id": "b", "Player": "Josh Allen", "Position": "QB", "Team": "BUF", "Projected Points": 23, "Low (P10)": 10, "High (P90)": 32}])
    salary = parse_salary_csv("Name,Position,Salary,TeamAbbrev\nJames Cook III,RB,7400,BUF\nJosh Allen,QB,8000,BUF\n")
    result, stats = attach_salaries_to_pool(pool, salary)
    assert len(result) == 2
    assert stats["alias_matched"] == 1
    assert result.salary.notna().all()
    assert set(result.dfs_id) == {""}
    assert "_salary_row_key" not in result


def test_defense_uses_team_forecast_and_never_invents_one():
    pool = pd.DataFrame([{"player_id": "dst:KC", "Player": "KC DST", "Position": "DST", "Team": "KC", "Projected Points": 6, "Low (P10)": -1, "High (P90)": 16, "projection_source": "ScoreSense"}])
    salary = parse_salary_csv("Name,Position,Salary,TeamAbbrev\nChiefs,DST,3000,KC\nBills,DST,2900,BUF\n")
    result, _ = attach_salaries_to_pool(pool, salary)
    assert len(result) == 2
    assert result[result.Team.eq("KC")]["Projected Points"].iloc[0] == 6
    assert pd.isna(result[result.Team.eq("BUF")]["Projected Points"].iloc[0])


def kicker(name, team="KC", depth=1, injury="", status="Active"):
    return {"sleeper_id": name, "gsis_id": "", "full_name": name, "team": team,
            "position": "K", "depth_chart_order": depth, "injury_status": injury, "status": status}


def test_starting_kickers_excludes_ambiguous_backups_and_inactive():
    rows = [kicker("Starter"), kicker("Backup", depth=2), kicker("Ambiguous A", "BUF"), kicker("Ambiguous B", "BUF"),
            kicker("Out", "NYJ", injury="IR"), kicker("Only", "SF", depth=None)]
    result = starting_kickers(pd.DataFrame(rows))
    assert set(result.full_name) == {"Starter", "Only"}


def test_model_gate_and_historical_leakage_guard():
    with pytest.raises(ValueError, match="gate"):
        special_team_predictions(pd.DataFrame(), {}, pd.DataFrame(), 2026, 1, {"version": VERSION})
    bundle = {"version": VERSION, "gate": {"positions": {"DST": {"passed": True}}}, "trained_through_season": 2025}
    assert special_team_predictions(pd.DataFrame(), {}, pd.DataFrame(), 2025, 1, bundle).empty


def test_features_ignore_current_and_future_week_outcomes():
    history = pd.DataFrame([{"season": 2024, "week": w, "team": "KC", "opponent_team": "BUF", "DST": v} for w,v in [(1,4),(2,8),(3,500),(4,900)]])
    x = features_before(history, "KC", "BUF", 2024, 3, "DST")
    assert x == [6, 2, 6, 6, 6]


def test_missing_artifact_does_not_run_inference(tmp_path, monkeypatch):
    monkeypatch.setattr("src.projections.dfs_pool.DFS_PREDICTIONS_DIR", tmp_path)
    assert load_dfs_pool(2026, 1).empty


def test_unavailable_players_remain_visible_without_fake_zero_projection():
    roster = pd.DataFrame([{**kicker("Injured"), "position": "RB", "injury_status": "IR"}])
    rows = unavailable_roster_rows(roster, pd.DataFrame(columns=["Player", "Team"]))
    assert rows.iloc[0]["Injury Status"] == "IR"
    assert pd.isna(rows.iloc[0]["Projected Points"])


@pytest.mark.parametrize("depth_mode", ["coverage", "dfs"])
def test_dfs_roster_mode_bypasses_depth_cut_and_requests_missing_profiles(monkeypatch, depth_mode):
    from src.core.projection_context import build_inference_roster
    frame = pd.DataFrame([{"player_id": "x", "team": "KC", "position": "QB", "season": 2025, "week": 1}])
    seen = []
    def overlay(data, *a, **kwargs):
        seen.append(kwargs)
        return data, {"applied": True}
    monkeypatch.setattr("src.integrations.sleeper.apply_sleeper_roster_overlay", overlay)
    monkeypatch.setattr("src.integrations.roster_identity.apply_roster_identity_overlay", lambda data,*a,**k: (data,{}))
    monkeypatch.setattr("src.core.depth_chart.filter_depth_chart_starters", lambda *a,**k: (_ for _ in ()).throw(AssertionError("depth cut")))
    out, _ = build_inference_roster(frame, "qb", 2026, 1, depth_mode=depth_mode)
    assert len(out) == 1
    assert seen[0]["add_missing"] is True


def test_scoring_rejects_missing_fields_and_duplicate_games():
    with pytest.raises(ValueError, match="lacks fields"):
        score_history(pd.DataFrame(), pd.DataFrame())


def scoring_fixture(points_allowed):
    numeric = ["fg_made_0_19", "fg_made_20_29", "fg_made_30_39", "fg_made_40_49", "fg_made_50_59", "fg_made_60_", "pat_made",
               "def_sacks", "def_interceptions", "fumble_recovery_opp", "def_tds", "special_teams_tds", "def_safeties", "def_punt_blocks", "def_fg_blocks", "def_pat_blocks", "def_2pt_made"]
    rows = [{**dict.fromkeys(numeric, 0), "season": 2024, "week": 1, "game_id": "g", "season_type": "REG", "team": team, "opponent_team": opp}
            for team, opp in [("KC", "BUF"), ("BUF", "KC")]]
    games = pd.DataFrame([{"game_id": "g", "home_team": "KC", "away_team": "BUF", "home_score": 20, "away_score": points_allowed}])
    return pd.DataFrame(rows), games


@pytest.mark.parametrize("allowed,expected", [(0,10),(1,7),(6,7),(7,4),(13,4),(14,1),(20,1),(21,0),(27,0),(28,-1),(34,-1),(35,-4)])
def test_defense_points_allowed_boundaries(allowed, expected):
    teams, games = scoring_fixture(allowed)
    scored = score_history(teams, games)
    assert scored.loc[scored.team.eq("KC"), "DST"].iloc[0] == expected


def test_defensive_touchdowns_and_safeties_do_not_count_as_points_allowed():
    teams, games = scoring_fixture(9)  # pick-six + PAT + safety; only PAT allowed
    teams.loc[teams.team.eq("BUF"), ["def_tds", "def_safeties"]] = [1,1]
    teams.loc[teams.team.eq("KC"), ["def_sacks", "def_interceptions", "def_fg_blocks", "def_tds"]] = [2,1,1,1]
    scored = score_history(teams, games)
    assert scored.loc[scored.team.eq("KC"), "DST"].iloc[0] == 19  # 7 PA + 2 sacks + 2 INT + 2 block + 6 TD


def test_kicker_field_goal_distance_bands_and_extra_points():
    teams, games = scoring_fixture(20)
    teams.loc[teams.team.eq("KC"), ["fg_made_30_39", "fg_made_40_49", "fg_made_50_59", "fg_made_60_", "pat_made"]] = [1,1,1,1,2]
    scored = score_history(teams, games)
    assert scored.loc[scored.team.eq("KC"), "K"].iloc[0] == 19


def test_duplicate_and_null_scoring_inputs_fail_closed():
    teams, games = scoring_fixture(20)
    with pytest.raises(ValueError, match="Duplicate"):
        score_history(pd.concat([teams, teams]), games)
    teams.loc[0, "def_tds"] = np.nan
    with pytest.raises(ValueError, match="Incomplete"):
        score_history(teams, games)


def test_hollywood_alias_is_guarded_by_team_and_position():
    pool = pd.DataFrame([{"player_id": "x", "Player": "Marquise Brown", "Position": "WR", "Team": "PHI", "Projected Points": 5, "Low (P10)": 1, "High (P90)": 10}])
    salary = parse_salary_csv("Name,Position,Salary,TeamAbbrev\nHollywood Brown,WR,4000,PHI\n")
    merged, stats = attach_salaries_to_pool(pool, salary)
    assert len(merged) == 1 and stats["alias_matched"] == 1
    salary.loc[0, "team"] = "KC"
    merged, _ = attach_salaries_to_pool(pool, salary)
    assert merged.loc[merged.salary.notna(), "Projected Points"].isna().all()


@pytest.mark.parametrize("team,position,reason", [("KC", "TE", "position_conflict"), ("BUF", "WR", "team_conflict")])
def test_unresolved_identity_conflicts_are_explicit(team, position, reason):
    pool = pd.DataFrame([{"player_id": "x", "Player": "Test Player", "Position": "WR", "Team": "KC", "Projected Points": 5, "Low (P10)": 1, "High (P90)": 10}])
    salary = parse_salary_csv(f"Name,Position,Salary,TeamAbbrev\nTest Player,{position},4000,{team}\n")
    _, stats = attach_salaries_to_pool(pool, salary)
    assert stats["projection_coverage"]["missing_players"][0]["reason"] == reason
    assert not stats["projection_coverage"]["all_available_players_have_inputs"]


def test_unavailable_only_pool_is_not_reported_as_covered():
    from src.products.dfs_coverage import projection_coverage
    rows = pd.DataFrame([{"Player": "Out", "Injury Status": "IR"}])
    assert not projection_coverage(rows)["all_available_players_have_inputs"]


def test_history_404_is_explicitly_historical(monkeypatch):
    from src.jobs.dfs_special_history import refresh_special_history
    from unittest.mock import Mock
    monkeypatch.setattr("src.jobs.dfs_special_history.requests.get", lambda *a, **k: Mock(status_code=404))
    old = pd.DataFrame([{"season": 2025, "week": 18}])
    result = refresh_special_history(2026, old)
    assert not result.attrs["current_season_available"]
    assert result.iloc[0].season == 2025
    assert not old.attrs


def test_failed_second_variant_preserves_previous_pool(tmp_path, monkeypatch):
    from src.projections import dfs_pool
    monkeypatch.setattr(dfs_pool, "DFS_PREDICTIONS_DIR", tmp_path)
    old = pd.DataFrame([{"player_id": "old"}])
    old.to_parquet(dfs_pool.artifact_path(2026, 4, True))
    old.to_parquet(dfs_pool.artifact_path(2026, 4, False))
    monkeypatch.setattr(dfs_pool.joblib, "load", lambda *a: {"history": pd.DataFrame([{"season": 2025}])})
    monkeypatch.setattr("src.jobs.dfs_special_history.refresh_special_history", lambda s, h: h)
    monkeypatch.setattr("src.integrations.sleeper.players_dataframe", lambda: pd.DataFrame())
    monkeypatch.setattr("src.core.schedule_utils.week_matchups", lambda *a: {})
    monkeypatch.setattr(dfs_pool, "special_team_predictions", lambda *a: pd.DataFrame([{"player_id": "dst"}]))
    monkeypatch.setattr(dfs_pool, "unavailable_roster_rows", lambda *a: pd.DataFrame())
    def predict(pos, **kwargs):
        if not kwargs["apply_injury_adjustments"]:
            raise RuntimeError("raw inference failed")
        assert kwargs["depth_mode"] == "dfs"
        return pd.DataFrame([{"player_id": pos}])
    monkeypatch.setattr("src.projections.predict.predict_upcoming_week", predict)
    with pytest.raises(RuntimeError, match="raw inference"):
        dfs_pool.refresh_dfs_pool(2026, 4)
    for injury in (True, False):
        assert pd.read_parquet(dfs_pool.artifact_path(2026, 4, injury)).player_id.tolist() == ["old"]


@pytest.mark.parametrize("site,expected", [("draftkings_showdown", {"K", "DST", "WR"}), ("draftkings", {"DST", "WR"}), ("fanduel", {"WR"}), ("fanduel_single", {"WR", "K"})])
def test_deep_pool_site_and_position_scope(tmp_path, monkeypatch, site, expected):
    from src.products import lineup_optimizer
    pd.DataFrame([{"season": 2025, "week": 18}]).to_parquet(tmp_path / "qb_mlready.parquet")
    pool = pd.DataFrame([{"player_id": pos, "Player": pos, "Position": pos, "Team": "KC", "Projected Points": 5,
                         "Low (P10)": 1, "High (P90)": 12, "projection_site": "dk_fd_kicking" if pos == "K" else ("draftkings" if pos == "DST" else None)}
                        for pos in ("K", "DST", "WR")])
    monkeypatch.setattr("src.projections.dfs_pool.load_dfs_pool", lambda *a: pool)
    monkeypatch.setattr(lineup_optimizer, "load_weekly_prediction", lambda *a, **k: pytest.fail("live weekly fallback"))
    monkeypatch.setattr("src.core.schedule_utils.attach_bye_flags", lambda frame, *a: frame)
    out, _ = lineup_optimizer.build_lineup_pool(2026, 4, data_dir=tmp_path, site=site)
    assert set(out.Position) == expected


def test_deep_roster_adds_missing_veterans_only_when_requested():
    from src.integrations.sleeper import apply_sleeper_roster_overlay
    roster = pd.DataFrame([{"player_id": "starter", "player_display_name": "Starter Player", "team": "KC",
                           "season": 2025, "week": 18, "pass_attmpt_avg": 25., "passing_yards_avg": 180.}])
    sleeper = pd.DataFrame([{**kicker(name, team=team, depth=depth), "position": "QB", "gsis_id": pid, "years_exp": 8}
                           for name, team, depth, pid in [("Starter Player", "KC", 1, "starter"), ("Missing Veteran", "BUF", 2, "backup")]])
    ordinary, _ = apply_sleeper_roster_overlay(roster, "qb", season=2026, sleeper_df=sleeper, add_rookies=False)
    deep, _ = apply_sleeper_roster_overlay(roster, "qb", season=2026, sleeper_df=sleeper, add_rookies=False, add_missing=True)
    assert ordinary.player_id.tolist() == ["starter"]
    added = deep[deep.player_id.eq("backup")].iloc[0]
    assert added["_roster_estimate"] == True
    assert added["team"] == "BUF"
