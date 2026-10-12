from copy import deepcopy

import pytest

from src.analytics.dfs_shared_outcomes_eval import evaluate_count_profiles, _crps


def ledger():
    result = []
    for week in range(1, 13):
        for game, (home, away) in enumerate((("BUF", "MIA"), ("KC", "LV"))):
            # Exact paired regimes create dependence while still preserving the
            # full play/dropback/throw partition. These are declared fixtures.
            regime = (week + game) % 3
            for team, opponent, is_home in ((home, away, True), (away, home, False)):
                plays, dropbacks = 45 + regime * 8, 25 + regime * 7
                sacks, scrambles = regime, 2
                result.append({"game_id": f"w{week}-g{game}", "season": 2024, "week": week,
                    "team": team, "opponent": opponent, "is_home": is_home, "source_id": "synthetic",
                    "kickoff_at": f"2024-09-{week:02d}T17:00:00Z", "ended_at": f"2024-09-{week:02d}T21:00:00Z", "known_at": None,
                    "plays": plays, "designed_runs": plays - dropbacks, "dropbacks": dropbacks,
                    "sacks": sacks, "scrambles": scrambles, "throws": dropbacks - sacks - scrambles,
                    "targeted": dropbacks - sacks - scrambles - 2, "untargeted": 2})
    return result


def evaluate(rows):
    return evaluate_count_profiles(rows, tune_from_week=4, tune_through_week=6, evaluate_from_week=7,
                                   history_windows=(0, 3), bootstrap_repeats=50)


def test_chronological_profiles_preserve_counts_and_do_not_claim_fantasy_calibration():
    report = evaluate(ledger())
    assert report["coverage"] == {"evaluation_games": 12, "evaluation_team_games": 24,
                                  "week_blocks": 6, "conservation_passed": True}
    assert not report["promotion"]["calibrated_fantasy_joint_tail"]
    assert all(int(gid.split("-")[0][1:]) < row["week"] for row in report["predictions"] for gid in row["history_game_ids"])
    assert report["marginal"]["sacks"]["observed_zero_fraction"] > 0
    assert report["joint"]["plays"]["mean_predicted_profile_covariance"] > 0
    assert report["joint"]["plays"]["independent_predicted_covariance"] == 0
    assert "Exact product" in report["independent_ablation"]


def test_later_outcomes_cannot_change_earlier_selection_or_forecasts():
    rows = ledger()
    baseline = evaluate(rows)
    for row in rows:
        if row["week"] >= 10:
            row["plays"] += 100
            row["designed_runs"] += 100
    altered = evaluate(rows)
    assert baseline["selection"] == altered["selection"]
    assert [row for row in baseline["predictions"] if row["week"] < 10] == [row for row in altered["predictions"] if row["week"] < 10]
    assert baseline["marginal"]["plays"] != altered["marginal"]["plays"]


def test_future_known_at_removes_both_game_sides_from_history():
    rows = ledger()
    for row in rows:
        if row["game_id"] == "w1-g0":
            row["known_at"] = "2024-10-01T00:00:00Z"
    report = evaluate_count_profiles(rows, tune_from_week=4, tune_through_week=6, evaluate_from_week=7,
                                    history_windows=(0,), bootstrap_repeats=50)
    assert all("w1-g0" not in row["history_game_ids"] for row in report["predictions"])


def test_complete_opponents_and_nonoverlapping_split_required():
    rows = ledger()
    with pytest.raises(ValueError, match="both exact game sides"):
        evaluate(rows[1:])
    with pytest.raises(ValueError, match="chronological"):
        evaluate_count_profiles(rows, tune_through_week=10, evaluate_from_week=10)


def test_known_at_comparison_uses_utc_instants_across_offsets():
    rows = ledger()
    pair = [row for row in rows if row["game_id"] == "w1-g0"]
    pair[0]["known_at"] = "2024-09-08T16:00:00Z"
    pair[1]["known_at"] = "2024-09-08T14:00:00-04:00"  # 18:00Z, after week 8 cutoff.
    report = evaluate_count_profiles(rows, tune_from_week=4, tune_through_week=6, evaluate_from_week=7,
                                    history_windows=(0,), bootstrap_repeats=50)
    week8 = [row for row in report["predictions"] if row["week"] == 8]
    assert week8 and all("w1-g0" not in row["history_game_ids"] for row in week8)


def test_exact_empirical_crps_matches_known_two_point_distribution():
    assert _crps([0, 2], 1) == .5
    assert _crps([0, 2], 3) == 1.5
