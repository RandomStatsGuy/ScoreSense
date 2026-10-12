"""Chronological count tests use explicitly synthetic accepted-play observations."""
from copy import deepcopy

import pandas as pd
import pytest

from src.analytics import dfs_opportunity_eval as evaluation


def plays():
    records = []
    kinds = [("run", 0, 0, 0, 0, 1, "", "r1"),
             ("pass", 1, 0, 0, 1, 0, "w1", ""),
             ("pass", 1, 1, 0, 1, 0, "", ""),
             ("run", 1, 0, 1, 0, 1, "", "q1"),
             ("pass", 1, 0, 0, 1, 0, "", ""),
             ("qb_spike", 1, 0, 0, 1, 0, "", ""),
             ("no_play", 1, 0, 0, 1, 0, "w1", ""),
             ("qb_kneel", 0, 0, 0, 0, 1, "", "q1"),
             ("run", 0, 0, 0, 0, 1, "", "r2")]
    for i, (kind, drop, sack, scramble, attempt, run, receiver, rusher) in enumerate(kinds):
        records.append({"game_id": "2024_01_KC_BUF", "play_id": i + 1, "season": 2024, "week": 1,
            "season_type": "REG", "home_team": "BUF", "away_team": "KC", "posteam": "KC" if i == 8 else "BUF",
            "defteam": "BUF" if i == 8 else "KC", "play_type": kind, "qb_dropback": drop, "sack": sack,
            "qb_scramble": scramble, "pass_attempt": attempt, "rush_attempt": run, "qb_kneel": int(kind == "qb_kneel"),
            "qb_spike": int(kind == "qb_spike"), "two_point_attempt": 0, "receiver_player_id": receiver,
            "rusher_player_id": rusher, "complete_pass": int(bool(receiver)), "qtr": 5 if i == 4 else 1,
            "time_of_day": f"2024-09-08T17:{i:02}:00Z"})
    return pd.DataFrame(records)


def history():
    rows = []
    for week in range(1, 8):
        for team, opponent in [("BUF", "KC"), ("KC", "BUF")]:
            count = (60 if team == "BUF" else 50) + week
            rows.append({"game_id": f"game-{week}", "season": 2024, "week": week,
                "team": team, "opponent": opponent, "is_home": (team == "BUF") == bool(week % 2),
                "kickoff_at": f"2024-09-{week * 2:02}T17:00:00Z", "ended_at": f"2024-09-{week * 2:02}T20:00:00Z",
                "known_at": None, "source_id": "fixture", "plays": count, "designed_runs": 20,
                "dropbacks": count - 20, "sacks": 2, "scrambles": 3, "throws": count - 25,
                "targeted": count - 28, "untargeted": 3})
    source = {"source_id": "fixture", "provider": "synthetic", "uri": "synthetic:counts",
        "content_sha256": "a" * 64, "period": {"season": 2024, "start_week": 1, "end_week": 7},
        "published_at": None, "retrieved_at": "2026-10-12T00:00:00Z", "known_at": None,
        "definition": "accepted_scrimmage_v1", "rights": {}, "evidence_scope": "synthetic"}
    return rows, [source]


def test_adapter_reconciles_sacks_scrambles_throws_targets_and_excludes_special_plays():
    ledger = evaluation.adapt_nflverse_pbp(plays())
    home = next(r for r in ledger["team_games"] if r["team"] == "BUF")
    assert {k: home[k] for k in ("plays", "designed_runs", "dropbacks", "sacks", "scrambles", "throws", "targeted", "untargeted")} == {
        "plays": 5, "designed_runs": 1, "dropbacks": 4, "sacks": 1, "scrambles": 1, "throws": 2, "targeted": 1, "untargeted": 1}
    assert ledger["audit"]["overtime_accepted_plays"] == 1
    assert ledger["audit"]["raw_pass_attempt_including_sacks"] == 3
    assert next(p for p in ledger["player_games"] if p["canonical_id"] == "q1")["carries"] == 1
    assert home["known_at"] is None


def test_adapter_rejects_duplicate_plays_missing_flags_and_contradictory_partitions():
    frame = plays()
    with pytest.raises(ValueError, match="Duplicate"):
        evaluation.adapt_nflverse_pbp(pd.concat([frame, frame.iloc[[1]]]))
    with pytest.raises(ValueError, match="missing"):
        evaluation.adapt_nflverse_pbp(frame.drop(columns="sack"))
    frame.loc[1, "sack"] = 1; frame.loc[1, "qb_scramble"] = 1
    with pytest.raises(ValueError, match="partition"):
        evaluation.adapt_nflverse_pbp(frame)


def test_later_outcomes_never_change_earlier_tuning_or_forecasts():
    rows, sources = history()
    before = evaluation.evaluate_ledger(rows, sources=sources, tune_from_week=2, tune_through_week=3,
        evaluate_from_week=4, prior_grid=(0, 2, 4), bootstrap_repeats=20)
    changed = deepcopy(rows)
    for row in changed:
        if row["week"] >= 4:
            row["plays"] += 30; row["dropbacks"] += 30; row["throws"] += 30; row["targeted"] += 30
    after = evaluation.evaluate_ledger(changed, sources=sources, tune_from_week=2, tune_through_week=3,
        evaluate_from_week=4, prior_grid=(0, 2, 4), bootstrap_repeats=20)
    assert before["selection"] == after["selection"]
    assert [r for r in before["team_predictions"] if r["week"] == 4] == [
        {**r, "actual_plays": next(x["actual_plays"] for x in before["team_predictions"] if x["week"] == 4 and x["team"] == r["team"]),
         "actual_dropbacks": next(x["actual_dropbacks"] for x in before["team_predictions"] if x["week"] == 4 and x["team"] == r["team"])}
        for r in after["team_predictions"] if r["week"] == 4]
    assert all(all(int(game.rsplit("-", 1)[1]) < r["week"] for game in r["history_game_ids"]) for r in before["team_predictions"])
    assert before["promotion"]["status"] == "research_only"


def test_role_cohort_is_frozen_from_history_and_future_newcomers_stay_residual():
    rows, sources = history()
    touches = [{"game_id": f"game-{w}", "canonical_id": "known", "team": "BUF", "targets": 5,
                "carries": 0, "source_id": "fixture", "known_at": None} for w in range(1, 8)]
    touches.append({"game_id": "game-4", "canonical_id": "future-newcomer", "team": "BUF", "targets": 10,
                    "carries": 0, "source_id": "fixture", "known_at": None})
    report = evaluation.evaluate_ledger(rows, player_games=touches, sources=sources,
        tune_from_week=2, tune_through_week=3, evaluate_from_week=4, prior_grid=(2,), bootstrap_repeats=20)
    first = [r for r in report["role_predictions"] if r["week"] == 4]
    assert {r["canonical_id"] for r in first} == {"known"}
    assert report["role_cohort"].startswith("Prior observed")
    assert report["role_metrics"]["season_count_mean"]["targets"]["rows"] > 0
    assert report["role_coverage"]["unseen_identity_residual_touches"]["targets"] == 10


def test_late_known_counts_cannot_leak_into_league_or_role_baselines():
    rows, sources = history()
    for row in rows:
        if row["week"] == 3:
            row["known_at"] = "2024-09-13T00:00:00Z"
    touches = [{"game_id": f"game-{w}", "canonical_id": "known", "team": "BUF", "targets": 5,
                "carries": 0, "source_id": "fixture", "known_at": None} for w in range(1, 8)]
    touches[1]["known_at"] = "2024-09-13T00:00:00Z"
    report = evaluation.evaluate_ledger(rows, player_games=touches, sources=sources,
        tune_from_week=2, tune_through_week=3, evaluate_from_week=4, prior_grid=(2,), bootstrap_repeats=20)
    first = next(r for r in report["team_predictions"] if r["week"] == 4 and r["team"] == "BUF")
    assert first["league_average"] == pytest.approx((61+51+62+52)/4)
    role = next(r for r in report["role_predictions"] if r["week"] == 4)
    assert role["history_game_ids"] == ["game-1"]
    assert role["season_count_mean_targets"] == 5
