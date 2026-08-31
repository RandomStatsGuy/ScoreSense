"""Tests for Sleeper roster overlay on draft projections."""

import pandas as pd

from src.integrations.sleeper import apply_sleeper_roster_overlay


def _mock_sleeper() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "sleeper_id": "s1",
                "full_name": "Geno Smith",
                "team": "NYJ",
                "position": "QB",
                "status": "Active",
                "gsis_id": "00-0030565",
                "years_exp": 12,
            },
            {
                "sleeper_id": "s2",
                "full_name": "Kenny Pickett",
                "team": "CAR",
                "position": "QB",
                "status": "Active",
                "gsis_id": "00-0038102",
                "years_exp": 3,
            },
            {
                "sleeper_id": "s3",
                "full_name": "Fernando Mendoza",
                "team": "LV",
                "position": "QB",
                "status": "Active",
                "gsis_id": "",
                "years_exp": 0,
                "depth_chart_order": 1,
                "search_rank": 39,
            },
            {
                "sleeper_id": "s5",
                "full_name": "Jacob Clark",
                "team": "LV",
                "position": "QB",
                "status": "Active",
                "gsis_id": "",
                "years_exp": 0,
                "depth_chart_order": None,
                "search_rank": 9999999,
            },
            {
                "sleeper_id": "s4",
                "full_name": "Retired QB",
                "team": "",
                "position": "QB",
                "status": "Retired",
                "gsis_id": "00-0099999",
                "years_exp": 10,
            },
        ]
    )


def test_apply_sleeper_roster_overlay_updates_teams_and_adds_rookie():
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0030565",
                "player_display_name": "Geno Smith",
                "team": "LV",
                "season": 2026,
                "week": 1,
                "passing_yards_avg": 220.0,
                "pass_attmpt_avg": 34.0,
            },
            {
                "player_id": "00-0038102",
                "player_display_name": "Kenny Pickett",
                "team": "LV",
                "season": 2026,
                "week": 1,
                "passing_yards_avg": 180.0,
                "pass_attmpt_avg": 28.0,
            },
            {
                "player_id": "00-0039999",
                "player_display_name": "Backup Vet",
                "team": "DEN",
                "season": 2026,
                "week": 1,
                "passing_yards_avg": 120.0,
                "pass_attmpt_avg": 18.0,
            },
            {
                "player_id": "00-0038888",
                "player_display_name": "Third String",
                "team": "WAS",
                "season": 2026,
                "week": 1,
                "passing_yards_avg": 90.0,
                "pass_attmpt_avg": 12.0,
            },
        ]
    )

    updated, stats = apply_sleeper_roster_overlay(
        roster,
        "qb",
        season=2026,
        sleeper_df=_mock_sleeper(),
    )

    assert stats["applied"] is True
    assert stats["teams_updated"] == 2
    assert stats["rookies_added"] == 2

    geno = updated[updated["player_display_name"] == "Geno Smith"].iloc[0]
    pickett = updated[updated["player_display_name"] == "Kenny Pickett"].iloc[0]
    mendoza = updated[updated["player_display_name"] == "Fernando Mendoza"].iloc[0]

    assert geno["team"] == "NYJ"
    assert pickett["team"] == "CAR"
    assert mendoza["team"] == "LV"
    assert bool(mendoza["_rookie_estimate"]) is True
    assert mendoza["_rookie_role_label"] == "starter-camp"
    assert float(mendoza["_rookie_role_mult"]) == 2.75

    clark = updated[updated["player_display_name"] == "Jacob Clark"].iloc[0]
    assert clark["_rookie_role_label"] == "development"
    assert float(clark["_rookie_role_mult"]) == 0.26
    assert float(clark["passing_yards_avg"]) < float(mendoza["passing_yards_avg"])
    # Backup template should be below the starter-heavy all-roster median path.
    assert float(mendoza["pass_attmpt_avg"]) < 34.0 * 2.75


def test_backup_template_prefers_low_usage(monkeypatch):
    from src.integrations.sleeper import _backup_feature_template

    roster = pd.DataFrame(
        [
            {"player_display_name": "High", "pass_attmpt_avg": 40.0, "passing_yards_avg": 300.0},
            {"player_display_name": "Mid", "pass_attmpt_avg": 28.0, "passing_yards_avg": 220.0},
            {"player_display_name": "Low1", "pass_attmpt_avg": 14.0, "passing_yards_avg": 110.0},
            {"player_display_name": "Low2", "pass_attmpt_avg": 10.0, "passing_yards_avg": 80.0},
            {"player_display_name": "Low3", "pass_attmpt_avg": 8.0, "passing_yards_avg": 60.0},
        ]
    )
    _template, medians = _backup_feature_template(roster, "qb")
    assert float(medians["pass_attmpt_avg"]) < 20.0
    assert float(medians["passing_yards_avg"]) < 150.0


def test_te_rookie_keeps_te_position():
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0030565",
                "player_display_name": "Vet WR",
                "team": "KC",
                "position": "WR",
                "season": 2026,
                "week": 1,
                "target_share_avg": 0.22,
                "receiving_yards_avg": 70.0,
            },
            {
                "player_id": "00-0030566",
                "player_display_name": "Vet WR2",
                "team": "BUF",
                "position": "WR",
                "season": 2026,
                "week": 1,
                "target_share_avg": 0.18,
                "receiving_yards_avg": 55.0,
            },
            {
                "player_id": "00-0030567",
                "player_display_name": "Vet WR3",
                "team": "MIA",
                "position": "WR",
                "season": 2026,
                "week": 1,
                "target_share_avg": 0.12,
                "receiving_yards_avg": 40.0,
            },
            {
                "player_id": "00-0030568",
                "player_display_name": "Vet WR4",
                "team": "CIN",
                "position": "WR",
                "season": 2026,
                "week": 1,
                "target_share_avg": 0.08,
                "receiving_yards_avg": 28.0,
            },
        ]
    )
    sleeper = pd.DataFrame(
        [
            {
                "sleeper_id": "te1",
                "full_name": "Kenyon Sadiq",
                "team": "NYJ",
                "position": "TE",
                "status": "Active",
                "gsis_id": "",
                "years_exp": 0,
                "depth_chart_order": 1,
                "search_rank": 109,
            }
        ]
    )
    updated, stats = apply_sleeper_roster_overlay(
        roster,
        "wr",
        season=2026,
        sleeper_df=sleeper,
    )
    assert stats["rookies_added"] == 1
    sadiq = updated[updated["player_display_name"] == "Kenyon Sadiq"].iloc[0]
    assert sadiq["position"] == "TE"
    assert sadiq["_rookie_role_label"] == "te1-path"
    assert float(sadiq["_rookie_role_mult"]) == 1.55


def test_vet_backup_scaling_rattler_and_richardson():
    from src.integrations.sleeper import sleeper_vet_backup_mult

    assert sleeper_vet_backup_mult("qb", 1) == (1.0, "")
    r_mult, r_label = sleeper_vet_backup_mult("qb", 2)
    assert r_mult < 0.5
    assert "backup" in r_label
    a_mult, _ = sleeper_vet_backup_mult("qb", 3)
    assert a_mult < r_mult


def test_overlay_scales_qb2_features():
    sleeper = pd.DataFrame(
        [
            {
                "sleeper_id": "s1",
                "full_name": "Tyler Shough",
                "team": "NO",
                "position": "QB",
                "status": "Active",
                "gsis_id": "00-0039001",
                "years_exp": 1,
                "depth_chart_order": 1,
                "search_rank": 81,
            },
            {
                "sleeper_id": "s2",
                "full_name": "Spencer Rattler",
                "team": "NO",
                "position": "QB",
                "status": "Active",
                "gsis_id": "00-0039002",
                "years_exp": 2,
                "depth_chart_order": 2,
                "search_rank": 999,
            },
        ]
    )
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0039001",
                "player_display_name": "Tyler Shough",
                "team": "NO",
                "season": 2026,
                "week": 1,
                "pass_attmpt_avg": 20.0,
                "passing_yards_avg": 150.0,
            },
            {
                "player_id": "00-0039002",
                "player_display_name": "Spencer Rattler",
                "team": "NO",
                "season": 2026,
                "week": 1,
                "pass_attmpt_avg": 32.0,
                "passing_yards_avg": 230.0,
            },
        ]
    )
    updated, stats = apply_sleeper_roster_overlay(
        roster, "qb", season=2026, sleeper_df=sleeper, add_rookies=False
    )
    assert stats["backups_scaled"] == 1
    shough = updated[updated["player_display_name"] == "Tyler Shough"].iloc[0]
    rattler = updated[updated["player_display_name"] == "Spencer Rattler"].iloc[0]
    assert float(shough.get("_vet_backup_mult", 1.0) or 1.0) >= 0.999
    assert float(rattler["_vet_backup_mult"]) < 0.5
    assert int(rattler["_sleeper_depth_order"]) == 2
    # Prior-season features stay intact; projection scale is applied post-model.
    assert float(rattler["pass_attmpt_avg"]) == 32.0


def test_apply_sleeper_roster_overlay_drops_unrostered():
    roster = pd.DataFrame(
        [
            {
                "player_id": "00-0099999",
                "player_display_name": "Retired QB",
                "team": "LV",
                "season": 2026,
                "week": 1,
                "passing_yards_avg": 100.0,
            }
        ]
    )

    updated, stats = apply_sleeper_roster_overlay(
        roster,
        "qb",
        season=2026,
        sleeper_df=_mock_sleeper(),
        add_rookies=False,
    )

    assert stats["removed_unrostered"] == 1
    assert updated.empty


def test_parse_depth_chart_order_rejects_nan_and_zero():
    from src.integrations.sleeper import _parse_depth_chart_order

    assert _parse_depth_chart_order(None) is None
    assert _parse_depth_chart_order(float("nan")) is None
    assert _parse_depth_chart_order(pd.NA) is None
    assert _parse_depth_chart_order(0) is None
    assert _parse_depth_chart_order(1) == 1
    assert _parse_depth_chart_order("2") == 2
