"""Walk-forward test: do YouTube sentiment features improve weekly projections?"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from src.analytics.candidate_etl import merge_candidates_into_mlready
from src.analytics.feature_screen import core_feature_cols, run_metrics_for_feature_set
from src.analytics.historical_injury import add_historical_injury_features
from src.analytics.upside_eval import composite_score
from src.config import ANALYTICS_DIR, CANDIDATE_DATA_DIR, PROCESSED_DATA_DIR, SENTIMENT_FEATURES_PATH
from src.sentiment.merge import merge_sentiment_into_mlready, sentiment_feature_columns


REPORT_PATH = ANALYTICS_DIR / "sentiment_projection_eval.json"


def _load_base(position: str) -> pd.DataFrame:
    try:
        df = merge_candidates_into_mlready(position, PROCESSED_DATA_DIR, CANDIDATE_DATA_DIR)
    except FileNotFoundError:
        df = pd.read_parquet(PROCESSED_DATA_DIR / f"{position}_mlready.parquet")
    return add_historical_injury_features(df)


def evaluate_position(
    position: str,
    test_seasons: list[int],
    *,
    team: str | None = None,
    sentiment_path: Path | None = None,
) -> dict:
    base = _load_base(position)
    with_sentiment = merge_sentiment_into_mlready(
        position,
        mlready_dir=PROCESSED_DATA_DIR,
        sentiment_path=sentiment_path,
    )

    if team:
        team = team.upper()
        if "team" in base.columns:
            base = base[base["team"].astype(str).str.upper() == team]
        if "team" in with_sentiment.columns:
            with_sentiment = with_sentiment[with_sentiment["team"].astype(str).str.upper() == team]

    sentiment_cols = [c for c in sentiment_feature_columns() if c in with_sentiment.columns]
    coverage = 0.0
    if sentiment_cols:
        scoped = with_sentiment[with_sentiment["season"].isin(test_seasons)]
        if not scoped.empty:
            coverage = float((scoped["yt_mention_count"].fillna(0) > 0).mean())

    core = core_feature_cols(position)
    core_metrics = run_metrics_for_feature_set(position, test_seasons, base, core)
    sentiment_metrics = (
        run_metrics_for_feature_set(position, test_seasons, with_sentiment, core + sentiment_cols)
        if sentiment_cols
        else {}
    )

    season_rows = []
    for season in test_seasons:
        if season not in core_metrics:
            continue
        base_m = core_metrics[season]
        sent_m = sentiment_metrics.get(season, {})
        delta_mae = float(sent_m.get("mae", float("nan")) - base_m.get("mae", float("nan")))
        delta_boom = float(sent_m.get("boom_recall", float("nan")) - base_m.get("boom_recall", float("nan")))
        delta_comp = float(sent_m.get("composite_score", float("nan")) - base_m.get("composite_score", float("nan")))
        season_rows.append(
            {
                "season": season,
                "baseline_mae": base_m.get("mae"),
                "sentiment_mae": sent_m.get("mae"),
                "mae_delta": round(delta_mae, 4),
                "baseline_boom_recall": base_m.get("boom_recall"),
                "sentiment_boom_recall": sent_m.get("boom_recall"),
                "boom_recall_delta": round(delta_boom, 4),
                "baseline_composite": base_m.get("composite_score"),
                "sentiment_composite": sent_m.get("composite_score"),
                "composite_delta": round(delta_comp, 4),
                "sentiment_helped": delta_comp < 0,
            }
        )

    improved = sum(1 for row in season_rows if row.get("sentiment_helped"))
    return {
        "position": position,
        "team_filter": team,
        "test_seasons": test_seasons,
        "sentiment_columns": sentiment_cols,
        "mention_coverage": round(coverage, 4),
        "seasons_improved": improved,
        "seasons_tested": len(season_rows),
        "recommendation": (
            "promising"
            if improved >= max(2, len(season_rows) // 2)
            else "inconclusive"
            if season_rows
            else "no_data"
        ),
        "season_detail": season_rows,
    }


def run_eval(
    positions: list[str] | None = None,
    test_seasons: list[int] | None = None,
    *,
    team: str | None = None,
    sentiment_path: Path | None = None,
    report_path: Path | None = None,
) -> dict:
    positions = positions or ["qb", "rb", "wr"]
    test_seasons = test_seasons or [2023, 2024]
    results = {
        pos: evaluate_position(
            pos,
            test_seasons,
            team=team,
            sentiment_path=sentiment_path,
        )
        for pos in positions
    }
    report = {
        "test_seasons": test_seasons,
        "team_filter": team,
        "sentiment_path": str(sentiment_path) if sentiment_path else str(SENTIMENT_FEATURES_PATH),
        "positions": results,
        "summary": {
            pos: {
                "recommendation": results[pos]["recommendation"],
                "mention_coverage": results[pos]["mention_coverage"],
                "seasons_improved": results[pos]["seasons_improved"],
            }
            for pos in positions
        },
    }
    ANALYTICS_DIR.mkdir(parents=True, exist_ok=True)
    out = report_path or REPORT_PATH
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--position", choices=["qb", "rb", "wr", "all"], default="all")
    parser.add_argument("--seasons", type=int, nargs="+", default=[2023, 2024])
    parser.add_argument("--team", default=None, help="Filter eval to one team, e.g. LV")
    parser.add_argument("--sentiment-path", default=None, help="Override sentiment_features.parquet path")
    parser.add_argument("--report-path", default=None, help="Override output JSON path")
    args = parser.parse_args()

    positions = ["qb", "rb", "wr"] if args.position == "all" else [args.position]
    sentiment_path = Path(args.sentiment_path) if args.sentiment_path else None
    report_path = Path(args.report_path) if args.report_path else None
    report = run_eval(
        positions,
        args.seasons,
        team=args.team,
        sentiment_path=sentiment_path,
        report_path=report_path,
    )
    print(json.dumps(report["summary"], indent=2))
    out = report_path or REPORT_PATH
    print(f"\nWrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
