"""Upside-aware evaluation metrics for boom-week detection."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error

from src.products.accuracy_report import _load_position_df
from src.pipeline.backtest_checkpoint import predict_walk_forward_season, walk_forward_split
from src.pipeline.backtest import compute_metrics
from src.config import (
    ANALYTICS_DIR,
    BOOM_THRESHOLDS,
    COMPOSITE_BOOM_WEIGHT,
    COMPOSITE_MAE_WEIGHT,
    DEFAULT_ACCURACY_SEASONS,
    PROCESSED_DATA_DIR,
)
from src.core.memory_utils import release_memory
from src.ml.training_config import CALIBRATION_PRESETS, DEFAULT_TRAINING_CONFIG, TrainingConfig, get_training_config

BASELINE_UPSIDE_PATH = ANALYTICS_DIR / "baseline_upside_report.json"


def boom_threshold(position: str) -> float:
    key = position.lower()
    if key in ("rec", "te", "wr_te"):
        key = "wr"
    return BOOM_THRESHOLDS.get(key, 20.0)


def _is_boom(actual: pd.Series, position: str) -> pd.Series:
    return actual >= boom_threshold(position)


def _top_decile_mask(actual: pd.Series) -> pd.Series:
    threshold = actual.quantile(0.9)
    return actual >= threshold


def boom_recall(
    df: pd.DataFrame,
    position: str,
    pred_p90_col: str = "model_p90",
    pred_p50_col: str = "model_pred",
    top_pct: float = 0.15,
) -> float:
    """Share of boom weeks flagged by P90 >= threshold OR top weekly rank."""
    if df.empty:
        return float("nan")
    threshold = boom_threshold(position)
    hits = []
    for (_, _), group in df.groupby(["season", "week"]):
        booms = group[_is_boom(group["Fpts"], position)]
        if booms.empty:
            continue
        n_top = max(1, int(len(group) * top_pct))
        pred_top = set(group.nlargest(n_top, pred_p50_col)["player_id"])
        for _, row in booms.iterrows():
            flagged = (
                (row[pred_p90_col] >= threshold if pd.notna(row[pred_p90_col]) else False)
                or (row["player_id"] in pred_top)
            )
            hits.append(float(flagged))
    return float(np.mean(hits)) if hits else float("nan")


def ceiling_mae(df: pd.DataFrame, pred_col: str = "model_pred") -> float:
    mask = _top_decile_mask(df["Fpts"]) & df[pred_col].notna()
    if mask.sum() == 0:
        return float("nan")
    return float(mean_absolute_error(df.loc[mask, "Fpts"], df.loc[mask, pred_col]))


def boom_underprediction_bias(df: pd.DataFrame, pred_col: str = "model_pred") -> float:
    mask = _top_decile_mask(df["Fpts"]) & df[pred_col].notna()
    if mask.sum() == 0:
        return float("nan")
    return float((df.loc[mask, "Fpts"] - df.loc[mask, pred_col]).mean())


def p90_calibration(df: pd.DataFrame) -> dict[str, float]:
    """P90 coverage on boom weeks and false-ceiling rate on non-booms."""
    if "model_p90" not in df.columns:
        return {"boom_p90_coverage": float("nan"), "false_ceiling_rate": float("nan")}
    boom = _is_boom(df["Fpts"], "wr")  # placeholder; use row-wise below
    boom_mask = df.apply(
        lambda r: r["Fpts"] >= boom_threshold(
            r.get("position", "wr").lower() if "position" in df.columns else "wr"
        ),
        axis=1,
    )
    if "position" not in df.columns:
        boom_mask = _is_boom(df["Fpts"], "wr")

    valid = df["model_p90"].notna() & df["Fpts"].notna()
    boom_valid = valid & boom_mask
    non_boom_valid = valid & ~boom_mask

    boom_cov = float((df.loc[boom_valid, "Fpts"] <= df.loc[boom_valid, "model_p90"]).mean()) if boom_valid.any() else float("nan")
    false_ceil = float((df.loc[non_boom_valid, "Fpts"] > df.loc[non_boom_valid, "model_p90"]).mean()) if non_boom_valid.any() else float("nan")
    return {"boom_p90_coverage": boom_cov, "false_ceiling_rate": false_ceil}


def p90_calibration_for_position(df: pd.DataFrame, position: str) -> dict[str, float]:
    if "model_p90" not in df.columns:
        return {"boom_p90_coverage": float("nan"), "false_ceiling_rate": float("nan")}
    valid = df["model_p90"].notna() & df["Fpts"].notna()
    boom_mask = _is_boom(df["Fpts"], position) & valid
    non_boom_mask = (~_is_boom(df["Fpts"], position)) & valid
    boom_cov = (
        float((df.loc[boom_mask, "Fpts"] <= df.loc[boom_mask, "model_p90"]).mean())
        if boom_mask.any()
        else float("nan")
    )
    false_ceil = (
        float((df.loc[non_boom_mask, "Fpts"] > df.loc[non_boom_mask, "model_p90"]).mean())
        if non_boom_mask.any()
        else float("nan")
    )
    return {"boom_p90_coverage": boom_cov, "false_ceiling_rate": false_ceil}


def interval_precision_metrics(df: pd.DataFrame, position: str) -> dict[str, float]:
    """
    P90 interval diagnostics: width, level, and false-ceiling rate on non-boom weeks.

    False-ceiling rate = share of non-boom weeks where actual Fpts exceeded P90.
    """
    if df.empty or "model_p90" not in df.columns or "model_p10" not in df.columns:
        return {
            "avg_interval_width": float("nan"),
            "median_interval_width": float("nan"),
            "avg_p90": float("nan"),
            "avg_p90_non_boom": float("nan"),
            "avg_p90_boom": float("nan"),
            "boom_p90_coverage": float("nan"),
            "false_ceiling_rate": float("nan"),
        }
    valid = df["model_p90"].notna() & df["model_p10"].notna() & df["Fpts"].notna()
    sub = df.loc[valid]
    if sub.empty:
        return interval_precision_metrics(pd.DataFrame(), position)

    width = sub["model_p90"] - sub["model_p10"]
    boom_mask = _is_boom(sub["Fpts"], position)
    non_boom_mask = ~boom_mask
    cal = p90_calibration_for_position(sub, position)

    return {
        "avg_interval_width": float(width.mean()),
        "median_interval_width": float(width.median()),
        "avg_p90": float(sub["model_p90"].mean()),
        "avg_p90_non_boom": float(sub.loc[non_boom_mask, "model_p90"].mean())
        if non_boom_mask.any()
        else float("nan"),
        "avg_p90_boom": float(sub.loc[boom_mask, "model_p90"].mean())
        if boom_mask.any()
        else float("nan"),
        **cal,
    }


def top_decile_spearman(df: pd.DataFrame, pred_col: str = "model_pred") -> float:
    mask = _top_decile_mask(df["Fpts"]) & df[pred_col].notna()
    sub = df.loc[mask]
    if len(sub) < 5:
        return float("nan")
    corr = sub["Fpts"].corr(sub[pred_col], method="spearman")
    return float(corr) if corr is not None else float("nan")


def compute_upside_metrics(
    df: pd.DataFrame,
    position: str,
    pred_col: str = "model_pred",
) -> dict[str, float]:
    base = compute_metrics(df["Fpts"], df[pred_col])
    cal = p90_calibration_for_position(df, position)
    return {
        **base,
        "boom_recall": boom_recall(df, position, pred_p50_col=pred_col),
        "ceiling_mae": ceiling_mae(df, pred_col),
        "boom_underprediction_bias": boom_underprediction_bias(df, pred_col),
        "top_decile_spearman": top_decile_spearman(df, pred_col),
        **cal,
        "n_booms": int(_is_boom(df["Fpts"], position).sum()),
    }


def composite_score(
    mae: float,
    boom_recall_val: float,
    mae_ref: float = 6.0,
    boom_ref: float = 0.5,
) -> float:
    """Lower is better. Normalized MAE minus weighted boom recall."""
    if mae != mae or boom_recall_val != boom_recall_val:
        return float("nan")
    norm_mae = mae / mae_ref
    norm_boom = 1.0 - min(max(boom_recall_val, 0.0), 1.0)
    return COMPOSITE_MAE_WEIGHT * norm_mae + COMPOSITE_BOOM_WEIGHT * norm_boom


def _spearman_series(x: pd.Series, y: pd.Series) -> float:
    mask = x.notna() & y.notna()
    if mask.sum() < 5:
        return float("nan")
    corr = x.loc[mask].corr(y.loc[mask], method="spearman")
    return float(corr) if corr is not None else float("nan")


def evaluate_composite_ranking_strategies(
    df: pd.DataFrame,
    pred_p50_col: str = "model_pred",
    pred_p90_col: str = "model_p90",
    actual_col: str = "Fpts",
    w_grid: np.ndarray | None = None,
) -> dict:
    """
    Evaluate post-merge ranking keys against actual Fpts (no retraining).

    Strategy A: (P50 + P90) / 2
    Strategy B: P50 + w * (P90 - P50) with w swept on w_grid (default 0..0.5).
    """
    if df.empty:
        return {"baseline_p50": float("nan"), "mean_composite": float("nan")}

    p50 = df[pred_p50_col]
    p90 = df[pred_p90_col]
    actual = df[actual_col]
    grid = w_grid if w_grid is not None else np.linspace(0.0, 0.5, 11)

    baseline = _spearman_series(p50, actual)
    sort_mean = (p50 + p90) / 2.0
    mean_composite = _spearman_series(sort_mean, actual)

    w_sweep: list[dict[str, float]] = []
    best_w = 0.0
    best_adj = baseline if baseline == baseline else -1.0

    for w in grid:
        sort_adj = p50 + w * (p90 - p50)
        adj_spearman = _spearman_series(sort_adj, actual)
        w_sweep.append({"w": round(float(w), 3), "spearman": round(adj_spearman, 4)})
        if adj_spearman == adj_spearman and adj_spearman > best_adj:
            best_adj = adj_spearman
            best_w = float(w)

    return {
        "baseline_p50": round(baseline, 4) if baseline == baseline else float("nan"),
        "mean_composite": round(mean_composite, 4) if mean_composite == mean_composite else float("nan"),
        "mean_composite_delta": round(mean_composite - baseline, 4)
        if mean_composite == mean_composite and baseline == baseline
        else float("nan"),
        "ceiling_adjusted_best_w": round(best_w, 3),
        "ceiling_adjusted_best_spearman": round(best_adj, 4) if best_adj == best_adj else float("nan"),
        "ceiling_adjusted_delta": round(best_adj - baseline, 4)
        if best_adj == best_adj and baseline == baseline
        else float("nan"),
        "w_sweep": w_sweep,
        "n_rows": int(len(df)),
    }


def backtest_one_season_with_quantiles(
    position: str,
    test_season: int,
    data_dir: Path,
    extra_feature_cols: list[str] | None = None,
    dataset_name: str | None = None,
    df: pd.DataFrame | None = None,
    feature_cols_override: list[str] | None = None,
    use_checkpoint: bool = True,
    training_config: TrainingConfig | None = None,
) -> pd.DataFrame:
    """Walk-forward one season with P10/P50/P90 predictions."""
    if df is None:
        fname = dataset_name or f"{position}_mlready.parquet"
        path = data_dir / fname
        if not path.exists():
            path = data_dir / fname.replace(".parquet", ".csv")
        df = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)
        df = df.sort_values(["season", "week"])

    train_df, test_df = walk_forward_split(df, test_season)
    if train_df.empty or test_df.empty:
        del train_df, test_df
        return pd.DataFrame()

    extra = extra_feature_cols or []
    qpreds, _cache_hit = predict_walk_forward_season(
        train_df,
        test_df,
        position,
        test_season,
        additional_cols=extra if feature_cols_override is None else None,
        feature_cols_override=feature_cols_override,
        use_checkpoint=use_checkpoint,
        training_config=training_config,
    )
    del train_df

    test_df = test_df.copy()
    test_df["model_pred"] = qpreds["q50"]
    test_df["model_p10"] = qpreds["q10"]
    test_df["model_p90"] = qpreds["q90"]
    del qpreds
    return test_df


def build_upside_report(
    position: str,
    test_seasons: list[int] | None = None,
    data_dir: Path | None = None,
    pred_col: str = "model_pred",
    training_config: TrainingConfig | None = None,
) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    test_seasons = test_seasons or DEFAULT_ACCURACY_SEASONS
    cfg = training_config or DEFAULT_TRAINING_CONFIG

    base_df = _load_position_df(position, data_dir).sort_values(["season", "week"])

    season_metrics = []
    series: dict[str, list[float | None]] = {
        "mae": [],
        "boom_recall": [],
        "ceiling_mae": [],
        "composite_score": [],
    }
    seasons_out: list[int] = []

    all_frames = []
    for season in test_seasons:
        frame = backtest_one_season_with_quantiles(
            position,
            season,
            data_dir,
            df=base_df,
            training_config=cfg,
        )
        if frame.empty:
            del frame
            release_memory()
            continue
        all_frames.append(frame)
        m = compute_upside_metrics(frame, position, pred_col)
        cs = composite_score(m["mae"], m["boom_recall"])
        seasons_out.append(season)
        season_metrics.append({"season": season, **m, "composite_score": cs})
        series["mae"].append(round(m["mae"], 3))
        series["boom_recall"].append(round(m["boom_recall"], 3))
        series["ceiling_mae"].append(round(m["ceiling_mae"], 3))
        series["composite_score"].append(round(cs, 3) if cs == cs else None)
        del frame
        release_memory()

    if not season_metrics:
        raise ValueError(f"No upside data for {position}")

    del all_frames, base_df
    release_memory()

    avg_mae = float(np.mean([s["mae"] for s in season_metrics]))
    avg_boom = float(np.mean([s["boom_recall"] for s in season_metrics]))
    avg_composite = composite_score(avg_mae, avg_boom)

    return {
        "position": position,
        "training_config": cfg.name,
        "seasons": seasons_out,
        "series": series,
        "season_detail": season_metrics,
        "summary": {
            "avg_mae": round(avg_mae, 3),
            "avg_boom_recall": round(avg_boom, 3),
            "avg_ceiling_mae": round(float(np.mean([s["ceiling_mae"] for s in season_metrics])), 3),
            "avg_composite_score": round(avg_composite, 3),
            "avg_boom_p90_coverage": round(
                float(np.nanmean([s["boom_p90_coverage"] for s in season_metrics])), 3
            ),
        },
    }


def build_all_upside_reports(
    test_seasons: list[int] | None = None,
    data_dir: Path | None = None,
    output_path: Path | None = None,
) -> dict:
    output_path = output_path or BASELINE_UPSIDE_PATH
    output_path.parent.mkdir(parents=True, exist_ok=True)
    reports = {}
    for position in ("qb", "rb", "wr"):
        print(f"Building upside report for {position}...")
        reports[position] = build_upside_report(position, test_seasons, data_dir)
        release_memory()
    output_path.write_text(json.dumps(reports, indent=2))
    return reports


def load_upside_report() -> dict:
    if BASELINE_UPSIDE_PATH.exists():
        return json.loads(BASELINE_UPSIDE_PATH.read_text())
    return {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build upside-aware baseline report")
    parser.add_argument("--position", choices=["qb", "rb", "wr", "all"], default="all")
    parser.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=DEFAULT_ACCURACY_SEASONS,
    )
    parser.add_argument(
        "--training-config",
        choices=sorted(CALIBRATION_PRESETS.keys()),
        default="default",
        help="Quantile training preset (walk-forward calibration experiments)",
    )
    args = parser.parse_args()
    training_config = get_training_config(args.training_config)

    if args.position == "all":
        reports = build_all_upside_reports(args.seasons)
        print(json.dumps({k: v["summary"] for k, v in reports.items()}, indent=2))
    else:
        report = build_upside_report(args.position, args.seasons, training_config=training_config)
        print(json.dumps(report["summary"], indent=2))
        if not training_config.is_default():
            print(f"\ntraining_config: {training_config.name}")


if __name__ == "__main__":
    main()
