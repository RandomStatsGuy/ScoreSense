"""Historical component replay of the derived-usage serving fix.

Fit only on seasons before each test season. Hold all inputs and fitted heads
fixed except the declared trend/volatility columns copied from the last observed
game. This measures the timing fix, not the complete live forecast pipeline or
contest returns. No production model, data, cache or routing is written.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from src.analytics.forecast_validation import forecast_metrics, paired_week_bootstrap
from src.core.features import (
    completed_game_profiles, feature_completeness, get_position_features,
    last_game_baseline, prepare_feature_matrix, season_average_baseline,
)
from src.ml.quantile import predict_quantiles, train_quantile_models, training_specification
from src.ml.training_config import RB_P90_BOOM_WEIGHT_3, WR_P90_BOOM_WEIGHT_3
from src.projections.temporal_inputs import (
    RECENT_MEDIAN_POLICY, feature_digest, policy_feature_cols,
    quantile_feature_subsets, training_inputs,
)

VERSION = "dfs_serving_derived_usage_replay_v1"
CONFIGS = {"rb": RB_P90_BOOM_WEIGHT_3, "wr": WR_P90_BOOM_WEIGHT_3}
KEYS = ["player_id", "season", "week"]


def validate_history(data: pd.DataFrame) -> pd.DataFrame:
    required = {*KEYS, "Fpts", "position"}
    if not required.issubset(data):
        raise ValueError(f"Historical replay requires {sorted(required)}")
    if data.empty or data.player_id.isna().any() or data.player_id.astype(str).str.strip().eq("").any():
        raise ValueError("Historical replay requires nonempty canonical player identities")
    for col in ("season", "week", "Fpts"):
        if not pd.api.types.is_numeric_dtype(data[col]) or not np.isfinite(data[col].to_numpy(dtype=float)).all():
            raise ValueError(f"Historical replay requires finite numeric {col}")
    if not data.season.between(2000, 2200).all() or not data.season.eq(data.season.astype(int)).all():
        raise ValueError("Historical replay requires integer seasons in the supported range")
    final_week = np.where(data.season.lt(2021), 17, 18)
    if not ((data.week >= 1) & (data.week <= final_week) & data.week.eq(data.week.astype(int))).all():
        raise ValueError("Supply regular-season games only")
    if "season_type" in data and not data.season_type.eq("REG").all():
        raise ValueError("Supply regular-season games only")
    if data.duplicated(KEYS).any():
        raise ValueError("Resolve duplicate player games explicitly before evaluation")
    return data.sort_values(KEYS).reset_index(drop=True)


def replay_inputs(data: pd.DataFrame, position: str) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Replay only prior-observation derivatives, with training-row parity audit.

    The target game's completed profile is never used for its own prediction.
    Advancing the complete history and then shifting by player is equivalent to
    taking the latest profile from strictly earlier games. A future appearance
    cannot change an earlier target's features.
    """
    if position not in CONFIGS:
        raise ValueError("Derived-usage replay supports RB and WR/TE")
    data = validate_history(data)
    expected_positions = {"RB", "FB"} if position == "rb" else {"WR", "TE", "REC"}
    if not data.position.str.upper().isin(expected_positions).all():
        raise ValueError("Observed position does not match the requested model")
    cols = policy_feature_cols(position, list(get_position_features(position).feature_cols), RECENT_MEDIAN_POLICY)
    derived = [c for c in cols if c.endswith(("_avg_trend", "_avg_volatility"))]
    if not derived or not set(derived).issubset(data):
        raise ValueError("Historical data lacks the trained derived-usage inputs")
    corrected = training_inputs(data, position, RECENT_MEDIAN_POLICY)
    advanced = completed_game_profiles(data)
    served = advanced.groupby("player_id")[derived].shift()
    parity = {}
    for col in derived:
        same = np.isclose(corrected[col], served[col], rtol=1e-10, atol=1e-12, equal_nan=True)
        parity[col] = {"rows": len(data), "matched": int(same.sum()), "mismatched": int((~same).sum())}
        if not same.all():
            raise ValueError(f"Corrected serving does not match target-row training inputs for {col}")
    stale = corrected.copy()
    for col in derived:
        stale[col] = data.groupby("player_id")[col].shift()
    return stale, corrected, {"columns": derived, "training_parity": parity,
        "raw_input_changes": {col: int((~np.isclose(stale[col], corrected[col], rtol=1e-10, atol=1e-12, equal_nan=True)).sum()) for col in derived}}


def usage_cohorts(rows: pd.DataFrame, position: str) -> dict[str, pd.Series]:
    """Fixed pregame usage cohorts; never select on candidate ranks or outcomes."""
    targets = rows.recent4_targets_avg
    usage = targets if position == "wr" else targets + rows.recent4_carries_avg
    known = usage.notna() & np.isfinite(usage)
    limit = 2. if position == "wr" else 5.
    return {"all_observed": pd.Series(True, index=rows.index),
            "low_prior_usage": known & usage.le(limit),
            "other_known_usage": known & usage.gt(limit), "unknown_prior_usage": ~known}


def compare_predictions(rows: pd.DataFrame, stale: pd.DataFrame, corrected: pd.DataFrame,
                        position: str, *, repeats: int = 2000) -> dict:
    result = {}
    for name, mask in usage_cohorts(rows, position).items():
        if not mask.any():
            result[name] = {"rows": 0, "metrics": None}
            continue
        selected = rows.loc[mask]
        blocks = len(selected[["season", "week"]].drop_duplicates())
        uncertainty = paired_week_bootstrap(rows, stale, corrected, mask=mask, repeats=repeats) if blocks >= 2 else {
            "mean_mae_delta": float(((corrected.loc[mask].q50-selected.Fpts).abs() - (stale.loc[mask].q50-selected.Fpts).abs()).mean()),
            "week_blocks": blocks, "repeats": 0, "ci95": None, "fraction_delta_below_zero": None,
            "reason": "At least two observed week blocks are required to estimate uncertainty"}
        pair = {"rows": len(selected), "observed_zero_frequency": float(selected.Fpts.eq(0).mean()),
            "stale": forecast_metrics(rows, stale, position, mask=mask),
            "corrected": forecast_metrics(rows, corrected, position, mask=mask),
            "paired_mae": uncertainty}
        for label in ("stale", "corrected"):
            # Mean signed error of a median forecast is not mean-model accuracy.
            pair[label]["median_average_error"] = pair[label].pop("mean_bias")
        for col in ("season_avg_baseline", "last_game_baseline"):
            if col in selected:
                pair[col] = {"mae": float((selected[col] - selected.Fpts).abs().mean()),
                    "cold_start": "training-only target median"}
        result[name] = pair
    return result


def _models(X: pd.DataFrame, y: pd.Series, position: str, season: int,
            cols: list[str], directory: Path) -> tuple[dict, dict]:
    config = CONFIGS[position]
    subsets = quantile_feature_subsets(position, cols, RECENT_MEDIAN_POLICY)
    specification = training_specification(config, position)
    contract = {"position": position, "test_season": season, "policy": RECENT_MEDIAN_POLICY,
        "matrix_digest": feature_digest(X, y), "specification": specification, "feature_subsets": subsets}
    digest = hashlib.sha256(json.dumps(contract, sort_keys=True).encode()).hexdigest()
    checkpoint = directory / f"{position}_{season}_{digest}.joblib"
    if checkpoint.exists():
        cached = joblib.load(checkpoint)
        if cached.get("contract") != contract:
            raise ValueError("Research checkpoint contract mismatch")
        models = cached["models"]
        for q in (.1, .5, .9):
            expected = subsets.get(q, cols)
            if list(models[q].feature_names_in_) != expected or models[q].get_params() != specification["regressors"][str(q)]:
                raise ValueError("Research checkpoint fitted head mismatch")
    else:
        models = train_quantile_models(X, y.to_numpy(), training_config=config, position=position,
                                      feature_cols_by_alpha=subsets)
        directory.mkdir(parents=True, exist_ok=True)
        joblib.dump({"contract": contract, "models": models}, checkpoint)
    return models, {"contract_digest": digest, "training_matrix_digest": contract["matrix_digest"],
                    "checkpoint_sha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest()}


def evaluate(position: str, data_dir: Path, output_dir: Path, seasons: list[int]) -> dict:
    source = data_dir / f"{position}_mlready.parquet"
    if output_dir.resolve() == data_dir.resolve() or data_dir.resolve() in output_dir.resolve().parents:
        raise ValueError("Keep research outputs separate from the source dataset")
    data = validate_history(pd.read_parquet(source))
    stale_frame, corrected_frame, timing = replay_inputs(data, position)
    cols = policy_feature_cols(position, list(get_position_features(position).feature_cols), RECENT_MEDIAN_POLICY)
    data["season_avg_baseline"] = season_average_baseline(data)
    data["last_game_baseline"] = last_game_baseline(data)
    report = {"schema_version": VERSION, "position": position, "input_policy": RECENT_MEDIAN_POLICY,
        "scope": "historical component replay; only derived-usage timing differs, not the complete serving pipeline",
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "source_rows": len(data),
        "source_seasons": sorted(data.season.unique().tolist()), "feature_cols": cols,
        "training_specification": training_specification(CONFIGS[position], position), "timing": timing,
        "production_models_changed": False, "pregame_publication_verified": False,
        "cohort_definition": "WR/TE low usage: prior-four-game targets <=2; RB/FB: prior-four-game carries+targets <=5. Missing histories separate.",
        "limitations": ["Observed regular-season PPR stat rows; inactive/unrecorded player weeks are not reconstructed.",
            "No salary archives or complete platform-specific scoring; low prior usage is not a cheap-player cohort.",
            "2025 has previously been explored and is not an untouched holdout.",
            "Historical source revisions are not archived pregame inputs; lagged market averages remain closing-line proxies, with no current-game market features.",
            "Cold-start rows isolate compatibility-imputed component inputs, not historical live-roster/template fallback behavior.",
            "Median error, tail scores and input parity do not establish mean accuracy, zero-score probabilities or contest profitability.",
            "Training unchanged heads offline for this experiment does not promote or replace serving models."],
        "comparisons": []}
    manifest = data_dir.parent / "manifest.json"
    if manifest.exists():
        report["source_manifest_sha256"] = hashlib.sha256(manifest.read_bytes()).hexdigest()
    output_dir.mkdir(parents=True, exist_ok=True)
    all_rows, all_stale, all_corrected = [], [], []
    for season in sorted(set(seasons)):
        train, test = data.season.lt(season), data.season.eq(season)
        if not train.any() or not test.any():
            raise ValueError(f"Missing strictly earlier training or test rows for {season}")
        X = prepare_feature_matrix(corrected_frame.loc[train], position, feature_cols_override=cols)
        models, model_evidence = _models(X, data.loc[train, "Fpts"], position, season, cols, output_dir / "checkpoints")
        before = prepare_feature_matrix(stale_frame.loc[test], position, feature_cols_override=cols)
        after = prepare_feature_matrix(corrected_frame.loc[test], position, feature_cols_override=cols)
        stale, corrected = predict_quantiles(models, before), predict_quantiles(models, after)
        rows = data.loc[test].copy()
        for col in ("recent4_targets_avg", "recent4_carries_avg"):
            if col in corrected_frame:
                rows[col] = corrected_frame.loc[test, col]
        fallback = float(data.loc[train, "Fpts"].median())
        for col in ("season_avg_baseline", "last_game_baseline"):
            rows[col] = rows[col].fillna(fallback)
        comparison = {"season": season, "training_max_season": int(data.loc[train, "season"].max()),
            "training_rows": int(train.sum()), **model_evidence,
            "input_quality": feature_completeness(corrected_frame.loc[test], cols),
            "changed_prediction_rows": int((~np.isclose(stale.to_numpy(), corrected.to_numpy(), rtol=1e-10, atol=1e-12)).any(axis=1).sum()),
            "cohorts": compare_predictions(rows, stale, corrected, position)}
        report["comparisons"].append(comparison)
        saved = rows[[*KEYS, "position", "Fpts", "recent4_targets_avg", "season_avg_baseline", "last_game_baseline"]].copy()
        if position == "rb":
            saved["recent4_carries_avg"] = rows.recent4_carries_avg
        for label, predictions in (("stale", stale), ("corrected", corrected)):
            for col in predictions:
                saved[f"{label}_{col}"] = predictions[col]
        saved.to_parquet(output_dir / f"{position}_{season}_rows.parquet", index=False)
        all_rows.append(rows); all_stale.append(stale); all_corrected.append(corrected)
        report["pooled"] = compare_predictions(pd.concat(all_rows), pd.concat(all_stale), pd.concat(all_corrected), position)
        (output_dir / f"{position}_serving_timing.json").write_text(json.dumps(report, indent=2, allow_nan=False)+"\n", encoding="utf-8", newline="\n")
        pair = comparison["cohorts"]["all_observed"]
        print(position, season, "median MAE", round(pair['stale']['mae'], 4), "->", round(pair['corrected']['mae'], 4), flush=True)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--position", choices=tuple(CONFIGS), required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--seasons", type=int, nargs="+", default=list(range(2019, 2026)))
    args = parser.parse_args()
    evaluate(args.position, args.data_dir, args.output_dir, args.seasons)


if __name__ == "__main__":
    main()
