"""Offline chronological count-profile diagnostic; no fantasy-score calibration.

The empirical profile is a complete recorded home/away count pair. This tests
the effect of retaining game dependence against an independent-side ablation.
It does not reconstruct pre-lock rosters, rare plays, weather or availability.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.analytics.dfs_opportunity_eval import adapt_nflverse_pbp, PBP_SOURCE, LICENSE_SOURCE, DICTIONARY_SOURCE
from src.products.dfs_opportunity import normalize_team_games

FEATURES = ("plays", "dropbacks", "targeted", "carries", "sacks")
VERSION = "dfs_shared_count_retrospective_v1"


def _time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _profiles(team_games):
    rows = normalize_team_games(team_games)
    if len({row["season"] for row in rows}) != 1:
        raise ValueError("Evaluate one historical season at a time.")
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["game_id"]].append(row)
    result = []
    for gid, pair in grouped.items():
        if len(pair) != 2 or sorted(row["is_home"] for row in pair) != [False, True]:
            raise ValueError("Every historical profile requires both exact game sides.")
        home = next(row for row in pair if row["is_home"])
        away = next(row for row in pair if not row["is_home"])
        if home["opponent"] != away["team"] or away["opponent"] != home["team"]:
            raise ValueError("Historical opponent identities do not reconcile.")
        values = [[row[feature] if feature != "carries" else row["designed_runs"] + row["scrambles"]
                   for feature in FEATURES] for row in (home, away)]
        result.append({"game_id": gid, "season": home["season"], "week": home["week"],
                       "kickoff_at": home["kickoff_at"], "ended_at": home["ended_at"],
                       "known_at": max((row["known_at"] for row in pair if row["known_at"]), key=_time, default=None),
                       "values": values})
    return sorted(result, key=lambda row: (row["week"], row["game_id"]))


def _crps(samples, value):
    """Exact empirical CRPS, using sorted order rather than a quadratic matrix."""
    ordered = np.sort(samples)
    size = len(ordered)
    pair_half = np.sum((2 * np.arange(1, size + 1) - size - 1) * ordered) / size**2
    return float(np.mean(np.abs(ordered - value)) - pair_half)


def _forecast(history, actual):
    profiles = np.asarray([row["values"] for row in history], dtype=float)
    outcome = np.asarray(actual["values"], dtype=float)
    marginal, joint = {}, {}
    for feature_index, feature in enumerate(FEATURES):
        marginal[feature] = []
        thresholds = []
        for side in range(2):
            samples, value = profiles[:, side, feature_index], outcome[side, feature_index]
            p10, p50, p90 = np.quantile(samples, [.1, .5, .9])
            zero = float(np.mean(samples == 0))
            marginal[feature].append({"actual": float(value), "mean": float(samples.mean()),
                "p10": float(p10), "p50": float(p50), "p90": float(p90),
                "crps": _crps(samples, value), "zero_probability": zero,
                "zero_brier": float((zero - (value == 0))**2), "covered_p10_p90": bool(p10 <= value <= p90),
                "below_p10": bool(value < p10), "above_p90": bool(value > p90)})
            thresholds.append(p90)
        upper = profiles[:, :, feature_index] > np.asarray(thresholds)
        paired = float(np.mean(upper[:, 0] & upper[:, 1]))
        independent = float(upper[:, 0].mean() * upper[:, 1].mean())
        observed = bool(outcome[0, feature_index] > thresholds[0] and outcome[1, feature_index] > thresholds[1])
        covariance = float(np.cov(profiles[:, 0, feature_index], profiles[:, 1, feature_index], ddof=0)[0, 1])
        joint[feature] = {"threshold_home": float(thresholds[0]), "threshold_away": float(thresholds[1]),
            "observed_joint_upper": observed, "paired_probability": paired, "independent_probability": independent,
            "paired_brier": float((paired - observed)**2), "independent_brier": float((independent - observed)**2),
            "paired_profile_covariance": covariance, "independent_covariance": 0.0}
    return {"marginal": marginal, "joint": joint}


def _block_interval(rows, feature, *, repeats):
    blocks = defaultdict(list)
    for row in rows:
        joint = row["joint"][feature]
        blocks[row["week"]].append(joint["paired_brier"] - joint["independent_brier"])
    groups = np.asarray([[sum(values), len(values)] for values in blocks.values()])
    rng = np.random.default_rng(20261012)
    resampled = groups[rng.integers(0, len(groups), size=(repeats, len(groups)))]
    deltas = resampled[:, :, 0].sum(axis=1) / resampled[:, :, 1].sum(axis=1)
    return {"paired_minus_independent_brier": float(groups[:, 0].sum() / groups[:, 1].sum()),
            "week_block_ci95": np.quantile(deltas, [.025, .975]).tolist(), "week_blocks": len(groups),
            "bootstrap_repeats": repeats}


def evaluate_count_profiles(team_games, *, tune_from_week=4, tune_through_week=9, evaluate_from_week=10,
                            history_windows=(0, 4, 8), bootstrap_repeats=2000):
    """Tune earlier marginal CRPS; freeze the window before later weekly tests.

    Window zero means all completed prior weeks. Home/away profiles are generic
    league draws and do not claim team, personnel or fantasy-score calibration.
    """
    if (type(tune_from_week) is not int or type(tune_through_week) is not int or type(evaluate_from_week) is not int or
            not 2 <= tune_from_week <= tune_through_week < evaluate_from_week <= 22 or not history_windows or
            any(type(window) is not int or not 0 <= window <= 22 for window in history_windows) or
            type(bootstrap_repeats) is not int or not 1 <= bootstrap_repeats <= 10000):
        raise ValueError("Use chronological disjoint tune/evaluation weeks and bounded windows/repeats.")
    profiles = _profiles(team_games)
    windows = sorted(set(history_windows))
    tuning, final, selected = defaultdict(list), [], None
    for week in sorted({row["week"] for row in profiles if row["week"] >= tune_from_week}):
        if week >= evaluate_from_week and selected is None:
            if not all(tuning[window] for window in windows):
                raise ValueError("No earlier tuning block exists; later outcomes cannot select a window.")
            selected = min(windows, key=lambda window: (sum(tuning[window]) / len(tuning[window]), -window))
        current = [row for row in profiles if row["week"] == week]
        cutoff = min(_time(row["kickoff_at"]) for row in current) - timedelta(seconds=1)
        candidates = [row for row in profiles if row["week"] < week and _time(row["ended_at"]) <= cutoff and
                      (not row["known_at"] or _time(row["known_at"]) <= cutoff)]
        if not candidates:
            continue
        active = windows if week <= tune_through_week else [selected] if week >= evaluate_from_week else []
        for window in active:
            history = [row for row in candidates if window == 0 or row["week"] >= week - window]
            if not history:
                raise ValueError("Declared history window has no earlier available profiles.")
            for actual in current:
                forecast = _forecast(history, actual)
                if week <= tune_through_week:
                    tuning[window].append(float(np.mean([item["crps"] for side in forecast["marginal"].values() for item in side])))
                else:
                    final.append({"game_id": actual["game_id"], "season": actual["season"], "week": week,
                                  "cutoff": cutoff.isoformat(), "history_game_ids": [row["game_id"] for row in history],
                                  "history_window": selected, **forecast})
    if not final:
        raise ValueError("No untouched later evaluation block exists.")
    marginal, joint = {}, {}
    for feature in FEATURES:
        observations = [item for row in final for item in row["marginal"][feature]]
        marginal[feature] = {"team_games": len(observations),
            "mae_of_empirical_mean": float(np.mean([abs(item["mean"] - item["actual"]) for item in observations])),
            "crps": float(np.mean([item["crps"] for item in observations])),
            "p10_p90_coverage": float(np.mean([item["covered_p10_p90"] for item in observations])),
            "below_p10_fraction": float(np.mean([item["below_p10"] for item in observations])),
            "above_p90_fraction": float(np.mean([item["above_p90"] for item in observations])),
            "observed_zero_fraction": float(np.mean([item["actual"] == 0 for item in observations])),
            "predicted_zero_fraction": float(np.mean([item["zero_probability"] for item in observations])),
            "zero_brier": float(np.mean([item["zero_brier"] for item in observations]))}
        values = [row["joint"][feature] for row in final]
        actual_pairs = [[row["marginal"][feature][side]["actual"] for side in range(2)] for row in final]
        joint[feature] = {"games": len(values), "tail_definition": "Both game sides strictly exceed their earlier-history empirical P90.",
            "observed_joint_upper_fraction": float(np.mean([item["observed_joint_upper"] for item in values])),
            "paired_predicted_joint_upper_fraction": float(np.mean([item["paired_probability"] for item in values])),
            "independent_predicted_joint_upper_fraction": float(np.mean([item["independent_probability"] for item in values])),
            "paired_brier": float(np.mean([item["paired_brier"] for item in values])),
            "independent_brier": float(np.mean([item["independent_brier"] for item in values])),
            "mean_predicted_profile_covariance": float(np.mean([item["paired_profile_covariance"] for item in values])),
            "observed_later_covariance": float(np.cov(np.asarray(actual_pairs).T, ddof=0)[0, 1]),
            "independent_predicted_covariance": 0.0,
            **_block_interval(final, feature, repeats=bootstrap_repeats)}
    return {"schema_version": VERSION, "evidence_scope": "retrospective", "features": list(FEATURES),
        "selection": {"tune_from_week": tune_from_week, "tune_through_week": tune_through_week,
            "evaluate_from_week": evaluate_from_week, "history_windows": windows, "selected_history_window": selected,
            "criterion": "Earlier-block mean exact empirical CRPS across five count features and both game sides; ties favor longer finite window.",
            "tuning_mean_crps": {str(window): sum(values) / len(values) for window, values in tuning.items()}},
        "coverage": {"evaluation_games": len(final), "evaluation_team_games": 2 * len(final),
            "week_blocks": len({row["week"] for row in final}), "conservation_passed": True},
        "marginal": marginal, "joint": joint, "predictions": final,
        "independent_ablation": "Exact product of marginal tail frequencies; preserves each marginal but removes within-game home/away dependence. No Monte Carlo or shuffled finite-sample noise.",
        "promotion": {"production_changed": False, "calibrated_fantasy_marginals": False, "calibrated_fantasy_joint_tail": False,
            "status": "research_only", "reason": "Generic historical count profiles; corrected source not archived at lock. No player roster/availability, complete rare-event fantasy scoring, weather, ownership or payout reconstruction."}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pbp", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--season", type=int, default=2024)
    args = parser.parse_args()
    raw = args.pbp.read_bytes()
    ledger = adapt_nflverse_pbp(pd.read_parquet(args.pbp), season=args.season)
    report = evaluate_count_profiles(ledger["team_games"])
    report.update(adapter_audit=ledger["audit"], source={"uri": PBP_SOURCE.format(season=args.season),
        "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw), "published_at": None, "known_at": None,
        "retrieved_at": datetime.now(timezone.utc).isoformat(), "provider": "nflverse/nflfastR",
        "license": "CC BY 4.0", "license_source": LICENSE_SOURCE, "dictionary_source": DICTIONARY_SOURCE})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False), encoding="utf-8", newline="\n")
    print(json.dumps({key: report[key] for key in ("selection", "coverage", "marginal", "joint", "promotion")}, indent=2))


if __name__ == "__main__":
    main()
