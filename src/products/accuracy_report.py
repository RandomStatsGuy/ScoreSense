"""Multi-season accuracy report vs external projection sources."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error

from src.pipeline.backtest import compute_metrics, top_n_accuracy
from src.pipeline.backtest_checkpoint import predict_walk_forward_season, walk_forward_split
from src.config import BACKTEST_DIR, DEFAULT_ACCURACY_SEASONS, PROCESSED_DATA_DIR
from src.core.memory_utils import release_memory
from src.core.features import (
    last_game_baseline,
    season_average_baseline,
)
from src.integrations.external_projections import (
    espn_is_fair_weekly_benchmark,
    merge_external_projections,
)
from src.integrations.fantasypros import fantasypros_is_fair_benchmark

ACCURACY_REPORT_PATH = BACKTEST_DIR / "yearly_accuracy.json"
ACCURACY_CSV_PATH = BACKTEST_DIR / "yearly_accuracy.csv"

SOURCE_COLUMNS = {
    "scoresense": "model_pred",
    "season_avg": "season_avg_baseline",
    "last_game": "last_game_baseline",
    "ffopportunity": "ffopportunity_proj",
    "espn": "espn_proj",
    "fantasypros": "fantasypros_proj",
    "site_composite": "site_composite_proj",
}

REGULAR_WEEKS = range(1, 19)


def _load_position_df(position: str, data_dir: Path) -> pd.DataFrame:
    path = data_dir / f"{position}_mlready.parquet"
    if not path.exists():
        path = data_dir / f"{position}_mlready.csv"
    return pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)


def backtest_one_season(
    position: str,
    test_season: int,
    data_dir: Path,
    include_espn: bool = True,
    df: pd.DataFrame | None = None,
) -> pd.DataFrame:
    if df is None:
        df = _load_position_df(position, data_dir).sort_values(["season", "week"])
    train_df, test_df = walk_forward_split(df, test_season)

    if train_df.empty or test_df.empty:
        del train_df, test_df
        return pd.DataFrame()

    qpreds, cache_hit = predict_walk_forward_season(
        train_df, test_df, position, test_season
    )
    if not cache_hit:
        print(f"  {position} {test_season}: trained (cache miss)")
    else:
        print(f"  {position} {test_season}: cache hit")

    del train_df

    test_df = test_df.copy()
    test_df["model_pred"] = qpreds["q50"]
    test_df["season_avg_baseline"] = season_average_baseline(test_df)
    test_df["last_game_baseline"] = last_game_baseline(test_df)
    test_df["season_avg_baseline"] = test_df["season_avg_baseline"].fillna(
        test_df.groupby("season")["Fpts"].transform("mean")
    )
    test_df["last_game_baseline"] = test_df["last_game_baseline"].fillna(
        test_df["season_avg_baseline"]
    )

    test_df = merge_external_projections(test_df, test_season, include_espn=include_espn)
    # Simple forecast composite until validated weekly site feeds are available.
    test_df["site_composite_proj"] = test_df[
        ["season_avg_baseline", "last_game_baseline"]
    ].mean(axis=1)
    return test_df


def _optimize_blend(
    df: pd.DataFrame,
    model_col: str = "model_pred",
    composite_col: str = "site_composite_proj",
) -> float:
    mask = df[model_col].notna() & df[composite_col].notna() & df["Fpts"].notna()
    if mask.sum() < 50:
        return 1.0
    y = df.loc[mask, "Fpts"].values
    model = df.loc[mask, model_col].values
    composite = df.loc[mask, composite_col].values

    best_alpha = 1.0
    best_mae = float("inf")
    for alpha in np.linspace(0.0, 1.0, 21):
        pred = alpha * model + (1.0 - alpha) * composite
        mae = mean_absolute_error(y, pred)
        if mae < best_mae:
            best_mae = mae
            best_alpha = float(alpha)
    return best_alpha


def build_yearly_accuracy_report(
    position: str = "qb",
    test_seasons: list[int] | None = None,
    data_dir: Path | None = None,
    output_path: Path | None = None,
    include_espn: bool = True,
) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    output_path = output_path or ACCURACY_REPORT_PATH
    test_seasons = test_seasons or DEFAULT_ACCURACY_SEASONS

    base_df = _load_position_df(position, data_dir).sort_values(["season", "week"])

    season_frames = []
    for season in test_seasons:
        frame = backtest_one_season(
            position, season, data_dir, include_espn=include_espn, df=base_df
        )
        if not frame.empty:
            season_frames.append(frame)
        del frame
        release_memory()

    if not season_frames:
        raise ValueError(f"No backtest data generated for {position}")

    all_results = pd.concat(season_frames, ignore_index=True)
    del season_frames
    release_memory()

    # Tune blend weight on the most recent season with external data
    tune_season = max(test_seasons)
    tune_df = all_results[all_results["season"] == tune_season]
    blend_alpha = _optimize_blend(tune_df)
    all_results["model_blended_proj"] = (
        blend_alpha * all_results["model_pred"]
        + (1.0 - blend_alpha) * all_results["site_composite_proj"]
    )

    source_cols = {**SOURCE_COLUMNS, "model_blended": "model_blended_proj"}
    rows = []
    series: dict[str, list[float | None]] = {k: [] for k in source_cols}
    seasons_out: list[int] = []

    for season in test_seasons:
        sdf = all_results[all_results["season"] == season]
        if sdf.empty:
            continue
        seasons_out.append(season)
        row = {"season": season, "position": position, "n": int(len(sdf))}
        for label, col in source_cols.items():
            metrics = compute_metrics(sdf["Fpts"], sdf[col])
            mae = metrics.get("mae")
            row[f"{label}_mae"] = mae
            series[label].append(round(mae, 3) if mae == mae else None)
        rows.append(row)

    detail = pd.DataFrame(rows)
    detail.to_csv(ACCURACY_CSV_PATH if position == "qb" else BACKTEST_DIR / f"yearly_accuracy_{position}.csv", index=False)

    # Headline comparisons
    ss_mae = detail["scoresense_mae"].mean()
    comp_mae = detail["site_composite_mae"].mean()
    blend_mae = detail["model_blended_mae"].mean()
    espn_mae = detail["espn_mae"].mean() if detail["espn_mae"].notna().any() else None
    fp_mae = (
        detail["fantasypros_mae"].mean()
        if "fantasypros_mae" in detail.columns and detail["fantasypros_mae"].notna().any()
        else None
    )

    fp_coverage = (
        float(all_results["fantasypros_proj"].notna().mean())
        if "fantasypros_proj" in all_results.columns
        else 0.0
    )
    fp_fair = fantasypros_is_fair_benchmark(fp_mae, fp_coverage)

    beats_composite_seasons = int((detail["scoresense_mae"] < detail["site_composite_mae"]).sum())
    beats_fp_seasons = 0
    if fp_fair and "fantasypros_mae" in detail.columns:
        beats_fp_seasons = int(
            (detail["scoresense_mae"] < detail["fantasypros_mae"]).sum()
        )
    total_seasons = len(detail)

    espn_fair = espn_is_fair_weekly_benchmark(espn_mae, ss_mae)
    forecast_keys = ["scoresense", "site_composite", "model_blended", "season_avg", "last_game"]
    diagnostic_keys = ["ffopportunity"]
    if espn_fair:
        forecast_keys.append("espn")
    else:
        diagnostic_keys.append("espn")
    if fp_fair:
        forecast_keys.append("fantasypros")
    else:
        diagnostic_keys.append("fantasypros")

    espn_label = "ESPN weekly" if espn_fair else "ESPN (season-level)"

    report = {
        "position": position,
        "seasons": seasons_out,
        "series": series,
        "blend_alpha": round(blend_alpha, 2),
        "forecast_keys": forecast_keys,
        "diagnostic_keys": diagnostic_keys,
        "espn_is_weekly_benchmark": espn_fair,
        "fantasypros_is_benchmark": fp_fair,
        "fantasypros_coverage_rate": round(fp_coverage, 3),
        "summary": {
            "scoresense_avg_mae": round(ss_mae, 3),
            "site_composite_avg_mae": round(comp_mae, 3),
            "model_blended_avg_mae": round(blend_mae, 3),
            "espn_avg_mae": round(espn_mae, 3) if pd.notna(espn_mae) else None,
            "fantasypros_avg_mae": round(fp_mae, 3) if pd.notna(fp_mae) else None,
            "ffopportunity_avg_mae": round(detail["ffopportunity_mae"].mean(), 3),
            "season_avg_mae": round(detail["season_avg_mae"].mean(), 3),
            "scoresense_beats_composite_seasons": beats_composite_seasons,
            "scoresense_beats_fantasypros_seasons": beats_fp_seasons,
            "total_seasons": total_seasons,
            "blend_beats_scoresense": bool(blend_mae < ss_mae),
            "recommended_use": (
                "blend_with_composite"
                if blend_mae < ss_mae
                else "scoresense_standalone"
            ),
        },
        "labels": {
            "scoresense": "ScoreSense",
            "season_avg": "Season Average",
            "last_game": "Last Game",
            "ffopportunity": "Usage EP (post-hoc, ffverse)",
            "espn": espn_label,
            "fantasypros": "FantasyPros consensus (PPR)",
            "site_composite": "Simple guess (avg + last game)",
            "model_blended": f"Blended ({int(blend_alpha*100)}% model)",
        },
        "notes": (
            "Simple guess averages season-to-date and last-game baselines. "
            "ffverse Usage EP reflects expected points given actual weekly opportunity "
            "(not a pre-game projection). "
            + (
                "ESPN weekly projections are included as an open external benchmark."
                if espn_fair
                else "ESPN values appear season-level and are shown as diagnostic only."
            )
            + (
                " FantasyPros consensus PPR projections are the primary paid benchmark when cached."
                if fp_fair
                else ""
            )
            + " FANTASYPROS_USE_AS_FEATURE defaults to false so FP is not leaked into the model during backtests."
        ),
    }

    # Save combined report per position
    if output_path.exists():
        existing = json.loads(output_path.read_text())
    else:
        existing = {}
    existing[position] = report
    output_path.write_text(json.dumps(existing, indent=2))
    del all_results, detail, tune_df, base_df
    release_memory()
    return report


def build_all_positions_report(
    test_seasons: list[int] | None = None,
    include_espn: bool = True,
) -> dict:
    reports = {}
    for position in ("qb", "rb", "wr"):
        print(f"Building yearly accuracy for {position}...")
        reports[position] = build_yearly_accuracy_report(
            position, test_seasons=test_seasons, include_espn=include_espn
        )
        release_memory()
    return reports


def load_accuracy_report() -> dict:
    if ACCURACY_REPORT_PATH.exists():
        return json.loads(ACCURACY_REPORT_PATH.read_text())
    return {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build yearly accuracy comparison report")
    parser.add_argument("--position", choices=["qb", "rb", "wr", "all"], default="all")
    parser.add_argument("--skip-espn", action="store_true")
    parser.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=DEFAULT_ACCURACY_SEASONS,
    )
    args = parser.parse_args()

    if args.position == "all":
        build_all_positions_report(args.seasons, include_espn=not args.skip_espn)
    else:
        report = build_yearly_accuracy_report(
            args.position,
            test_seasons=args.seasons,
            include_espn=not args.skip_espn,
        )
        print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    main()
