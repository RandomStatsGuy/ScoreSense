"""Walk-forward backtesting with baseline comparisons.

Plot helpers lazy-import matplotlib/seaborn so `compute_metrics` /
`top_n_accuracy` can load in GitHub CI (`requirements-ci.txt` omits them).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

from src.config import BACKTEST_DIR, DEFAULT_TEST_SEASONS, PREDICTION_QUANTILES, PROCESSED_DATA_DIR
from src.core.features import (
    last_game_baseline,
    prepare_feature_matrix,
    season_average_baseline,
)
from src.ml.quantile import interval_coverage, predict_quantiles, train_quantile_models


def walk_forward_backtest(
    position: str,
    data_dir: Path | None = None,
    test_seasons: list[int] | None = None,
) -> pd.DataFrame:
    data_dir = data_dir or PROCESSED_DATA_DIR
    test_seasons = test_seasons or DEFAULT_TEST_SEASONS

    path = data_dir / f"{position}_mlready.parquet"
    if not path.exists():
        path = data_dir / f"{position}_mlready.csv"
    df = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)
    df = df.sort_values(["season", "week"])

    test_df = df[df["season"].isin(test_seasons)].copy()
    train_df = df[~df["season"].isin(test_seasons)].copy()

    X_train = prepare_feature_matrix(train_df, position)
    quantile_models = train_quantile_models(
        X_train, train_df["Fpts"].values, PREDICTION_QUANTILES
    )

    test_df = test_df.copy()
    qpreds = predict_quantiles(quantile_models, prepare_feature_matrix(test_df, position))
    test_df["model_pred"] = qpreds["q50"]
    test_df["model_p10"] = qpreds["q10"]
    test_df["model_p90"] = qpreds["q90"]
    test_df["season_avg_baseline"] = season_average_baseline(test_df)
    test_df["last_game_baseline"] = last_game_baseline(test_df)

    for col in ("season_avg_baseline", "last_game_baseline"):
        test_df[col] = test_df[col].fillna(test_df.groupby("season")["Fpts"].transform("mean"))

    return test_df


def compute_metrics(actual: pd.Series, predicted: pd.Series) -> dict[str, float]:
    mask = actual.notna() & predicted.notna()
    y = actual[mask]
    p = predicted[mask]
    if len(y) == 0:
        return {"mae": float("nan"), "rmse": float("nan"), "spearman": float("nan")}
    spearman = y.corr(p, method="spearman")
    return {
        "mae": float(mean_absolute_error(y, p)),
        "rmse": float(np.sqrt(mean_squared_error(y, p))),
        "spearman": float(spearman) if spearman is not None else float("nan"),
        "n": int(len(y)),
    }


def top_n_accuracy(
    df: pd.DataFrame,
    pred_col: str,
    n: int = 12,
) -> float:
    """Fraction of weeks where predicted top-N overlaps actual top-N by player."""
    hits = []
    for (_, week), group in df.groupby(["season", "week"]):
        if len(group) < n:
            continue
        actual_top = set(group.nlargest(n, "Fpts")["player_id"])
        pred_top = set(group.nlargest(n, pred_col)["player_id"])
        hits.append(len(actual_top & pred_top) / n)
    return float(np.mean(hits)) if hits else float("nan")


def run_backtest(
    position: str,
    data_dir: Path | None = None,
    test_seasons: list[int] | None = None,
    output_dir: Path | None = None,
) -> dict:
    output_dir = output_dir or BACKTEST_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    results_df = walk_forward_backtest(position, data_dir, test_seasons)

    metrics = {
        "position": position,
        "test_seasons": test_seasons or DEFAULT_TEST_SEASONS,
        "model": compute_metrics(results_df["Fpts"], results_df["model_pred"]),
        "season_avg_baseline": compute_metrics(
            results_df["Fpts"], results_df["season_avg_baseline"]
        ),
        "last_game_baseline": compute_metrics(
            results_df["Fpts"], results_df["last_game_baseline"]
        ),
        "top12_model": top_n_accuracy(results_df, "model_pred", 12),
        "top12_season_avg": top_n_accuracy(results_df, "season_avg_baseline", 12),
        "interval_coverage_p10_p90": float(
            interval_coverage(results_df["Fpts"], results_df["model_p10"], results_df["model_p90"])
        ),
    }

    results_df.to_csv(output_dir / f"{position}_backtest_predictions.csv", index=False)

    weekly = (
        results_df.groupby(["season", "week"], group_keys=False)
        .apply(
            lambda g: pd.Series(
                {
                    "model_mae": mean_absolute_error(g["Fpts"], g["model_pred"]),
                    "baseline_mae": mean_absolute_error(
                        g["Fpts"], g["season_avg_baseline"]
                    ),
                }
            ),
            include_groups=False,
        )
        .reset_index()
    )
    weekly.to_csv(output_dir / f"{position}_weekly_mae.csv", index=False)

    _plot_weekly_mae(weekly, position, output_dir)
    _plot_mae_comparison(metrics, position, output_dir)

    metrics_path = output_dir / f"{position}_backtest_metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))
    return metrics


def _plot_weekly_mae(weekly: pd.DataFrame, position: str, output_dir: Path) -> None:
    import matplotlib.pyplot as plt

    plt.figure(figsize=(10, 4))
    weekly["game_index"] = range(len(weekly))
    plt.plot(weekly["game_index"], weekly["model_mae"], label="ScoreSense model")
    plt.plot(weekly["game_index"], weekly["baseline_mae"], label="Season avg baseline")
    plt.xlabel("Test week index")
    plt.ylabel("MAE")
    plt.title(f"{position.upper()} walk-forward weekly MAE")
    plt.legend()
    plt.tight_layout()
    plt.savefig(output_dir / f"{position}_weekly_mae.png", dpi=150)
    plt.close()


def _plot_mae_comparison(metrics: dict, position: str, output_dir: Path) -> None:
    import matplotlib.pyplot as plt
    import seaborn as sns

    labels = ["Model", "Season Avg", "Last Game"]
    maes = [
        metrics["model"]["mae"],
        metrics["season_avg_baseline"]["mae"],
        metrics["last_game_baseline"]["mae"],
    ]
    plt.figure(figsize=(6, 4))
    sns.barplot(x=labels, y=maes, hue=labels, palette="Blues_d", legend=False)
    plt.ylabel("MAE (fantasy points)")
    plt.title(f"{position.upper()} backtest MAE comparison")
    plt.tight_layout()
    plt.savefig(output_dir / f"{position}_mae_comparison.png", dpi=150)
    plt.close()


def run_all_backtests(
    data_dir: Path | None = None,
    test_seasons: list[int] | None = None,
    output_dir: Path | None = None,
) -> dict[str, dict]:
    all_metrics = {}
    for position in ("qb", "rb", "wr"):
        all_metrics[position] = run_backtest(
            position, data_dir, test_seasons, output_dir
        )
    summary_path = (output_dir or BACKTEST_DIR) / "backtest_summary.json"
    summary_path.write_text(json.dumps(all_metrics, indent=2))
    return all_metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Walk-forward backtest")
    parser.add_argument("--position", choices=["qb", "rb", "wr", "all"], default="all")
    parser.add_argument("--data-dir", type=Path, default=PROCESSED_DATA_DIR)
    parser.add_argument("--output-dir", type=Path, default=BACKTEST_DIR)
    parser.add_argument(
        "--test-seasons",
        type=int,
        nargs="+",
        default=DEFAULT_TEST_SEASONS,
    )
    args = parser.parse_args()

    if args.position == "all":
        run_all_backtests(args.data_dir, args.test_seasons, args.output_dir)
    else:
        run_backtest(args.position, args.data_dir, args.test_seasons, args.output_dir)


if __name__ == "__main__":
    main()
