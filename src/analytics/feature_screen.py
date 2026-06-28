"""Feature significance screening with upside-aware promotion gate."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.analytics.candidate_etl import merge_candidates_into_mlready
from src.analytics.historical_injury import add_historical_injury_features
from src.sentiment.merge import merge_sentiment_into_mlready, sentiment_feature_columns
from src.analytics.upside_eval import (
    backtest_one_season_with_quantiles,
    boom_threshold,
    composite_score,
    compute_upside_metrics,
)
from src.config import ANALYTICS_DIR, CANDIDATE_DATA_DIR, PROCESSED_DATA_DIR
from src.analytics.promoted_features import save_promoted_features
from src.analytics.usage_features import (
    MIN_FORWARD_COMPOSITE_DELTA,
    MIN_LOO_COMPOSITE_DELTA,
    RELAXED_MIN_SEASONS_IMPROVED,
    select_promoted_from_screen,
)
from src.core.features import get_core_position_features

# Always LOO-test WR intent / depth metrics even if univariate rank is low.
WR_PHASE2_ABLATION: tuple[str, ...] = (
    "adot_avg",
    "team_proe_avg",
    "wopr_avg_volatility",
    "wopr_avg_trend",
    "team_pass_attempts_avg",
    "deep_target_share_avg",
    "def_deep_pass_rate_allowed_avg",
    "ngs_avg_separation_avg",
    "ngs_yac_above_expectation_avg",
)

PROMOTION_MIN_SEASONS = 4
BOOM_RECALL_DROP_LIMIT = 0.02
RELAXED_PROMOTION_MIN_SEASONS = max(2, PROMOTION_MIN_SEASONS - 1)


def _candidate_columns(position: str, candidate_dir: Path) -> list[str]:
    path = candidate_dir / f"candidate_features_{position}.parquet"
    if not path.exists():
        return []
    cand = pd.read_parquet(path)
    skip = {"player_id", "season", "week", "team", "opponent", "position"}
    return [
        c
        for c in cand.columns
        if c not in skip
        and (
            c.endswith("_avg")
            or c.endswith("_volatility")
            or c.endswith("_trend")
        )
    ]


def _load_enriched(
    position: str,
    data_dir: Path,
    candidate_dir: Path,
    *,
    with_sentiment: bool = False,
) -> pd.DataFrame:
    try:
        df = merge_candidates_into_mlready(position, data_dir, candidate_dir)
    except FileNotFoundError:
        path = data_dir / f"{position}_mlready.parquet"
        df = pd.read_parquet(path)
    df = add_historical_injury_features(df)
    if with_sentiment:
        df = merge_sentiment_into_mlready(position, mlready_dir=data_dir)
    return df


def _tmp_enriched_path(position: str) -> Path:
    return ANALYTICS_DIR / f"enriched_{position}.parquet"


def _normalize_position(position: str) -> str:
    key = position.lower()
    if key in ("rec", "te", "wr_te"):
        return "wr"
    return key


def core_feature_cols(position: str) -> list[str]:
    """Skeleton baseline — registry columns only, no USAGE_BUNDLE or promoted gate."""
    return list(get_core_position_features(_normalize_position(position)).feature_cols)


def screen_full_feature_cols(position: str, candidates: list[str], enriched: pd.DataFrame) -> list[str]:
    """Full candidate suite for LOO: core stats + all screenable candidates present in data."""
    usable = [c for c in candidates if c in enriched.columns]
    return list(dict.fromkeys(core_feature_cols(position) + usable))


def univariate_screen(
    position: str,
    feature_col: str,
    test_seasons: list[int],
    enriched: pd.DataFrame,
) -> dict:
    corrs = []
    boom_corrs = []
    threshold = boom_threshold(position)
    for season in test_seasons:
        sdf = enriched[enriched["season"] == season]
        if feature_col not in sdf.columns or len(sdf) < 50:
            continue
        valid = sdf[[feature_col, "Fpts"]].dropna()
        if len(valid) < 30:
            continue
        corrs.append(valid[feature_col].corr(valid["Fpts"]))
        boom = valid[valid["Fpts"] >= threshold]
        if len(boom) >= 10:
            boom_corrs.append(boom[feature_col].corr(boom["Fpts"]))

    return {
        "feature": feature_col,
        "fpts_corr_mean": float(np.nanmean(corrs)) if corrs else float("nan"),
        "boom_corr_mean": float(np.nanmean(boom_corrs)) if boom_corrs else float("nan"),
        "seasons_with_data": len(corrs),
    }


def run_metrics_for_feature_set(
    position: str,
    test_seasons: list[int],
    enriched: pd.DataFrame,
    feature_cols: list[str],
) -> dict[int, dict]:
    """Walk-forward metrics using an explicit feature column list (no production bundle)."""
    metrics: dict[int, dict] = {}
    for season in test_seasons:
        frame = backtest_one_season_with_quantiles(
            position,
            season,
            PROCESSED_DATA_DIR,
            df=enriched,
            feature_cols_override=feature_cols,
            use_checkpoint=True,
        )
        if frame.empty:
            continue
        m = compute_upside_metrics(frame, position)
        m["composite_score"] = composite_score(m["mae"], m["boom_recall"])
        metrics[season] = m
    return metrics


def _summarize_ablation(
    position: str,
    feature_col: str,
    season_results: list[dict],
    reference_metrics: dict[int, dict],
    *,
    positive_delta_means_harm: bool,
) -> dict:
    """
    Summarize season deltas vs reference_metrics.

    LOO (positive_delta_means_harm=True): delta = reduced - full; positive => removal hurt.
    Forward (False): delta = added - skeleton; negative => feature helped.
    """
    if not season_results:
        return {"feature": feature_col, "passes_gate": False, "seasons": []}

    improved = 0
    boom_drop = False
    for s in season_results:
        ref = reference_metrics.get(s["season"], {})
        delta = s["composite_delta"]
        if positive_delta_means_harm:
            if delta > 0:
                improved += 1
        elif delta < 0:
            improved += 1
        if ref and s["boom_recall"] < ref.get("boom_recall", 0) - BOOM_RECALL_DROP_LIMIT:
            boom_drop = True

    avg_delta = float(np.nanmean([s["composite_delta"] for s in season_results]))
    seasons_tested = len(season_results)
    min_improved_strict = min(PROMOTION_MIN_SEASONS, seasons_tested)
    min_improved_relaxed = min(RELAXED_PROMOTION_MIN_SEASONS, seasons_tested)

    if positive_delta_means_harm:
        passes_strict = (
            improved >= min_improved_strict
            and not boom_drop
            and avg_delta >= MIN_LOO_COMPOSITE_DELTA
        )
        passes_relaxed = (
            improved >= min_improved_relaxed
            and not boom_drop
            and avg_delta >= MIN_LOO_COMPOSITE_DELTA
        )
    else:
        passes_strict = (
            improved >= min_improved_strict
            and not boom_drop
            and avg_delta <= MIN_FORWARD_COMPOSITE_DELTA
        )
        passes_relaxed = (
            improved >= min_improved_relaxed
            and not boom_drop
            and avg_delta <= MIN_FORWARD_COMPOSITE_DELTA
        )

    return {
        "feature": feature_col,
        "seasons_tested": seasons_tested,
        "seasons_improved": improved,
        "avg_composite_delta": round(avg_delta, 4),
        "avg_mae": round(float(np.mean([s["mae"] for s in season_results])), 3),
        "avg_boom_recall": round(float(np.mean([s["boom_recall"] for s in season_results])), 3),
        "passes_gate": passes_strict,
        "passes_gate_relaxed": passes_relaxed,
        "season_detail": season_results,
    }


def evaluate_leave_one_out(
    position: str,
    feature_col: str,
    test_seasons: list[int],
    enriched: pd.DataFrame,
    full_cols: list[str],
    full_metrics: dict[int, dict],
) -> dict:
    """Drop one feature from the full suite; positive composite delta => feature matters."""
    if feature_col not in full_cols:
        return {"feature": feature_col, "passes_gate": False, "seasons": []}

    reduced_cols = [c for c in full_cols if c != feature_col]
    reduced_metrics = run_metrics_for_feature_set(position, test_seasons, enriched, reduced_cols)

    season_results = []
    for season in test_seasons:
        if season not in reduced_metrics or season not in full_metrics:
            continue
        full_cs = full_metrics[season]["composite_score"]
        red = reduced_metrics[season]
        red_cs = red["composite_score"]
        season_results.append(
            {
                "season": season,
                **red,
                "composite_score": red_cs,
                "composite_delta": red_cs - full_cs,
            }
        )

    return _summarize_ablation(
        position, feature_col, season_results, full_metrics, positive_delta_means_harm=True
    )


def evaluate_forward_add(
    position: str,
    feature_col: str,
    test_seasons: list[int],
    enriched: pd.DataFrame,
    skeleton_metrics: dict[int, dict],
) -> dict:
    """Add one candidate to skeleton core; negative composite delta => feature helped."""
    core = core_feature_cols(position)
    if feature_col in core:
        return {
            "feature": feature_col,
            "passes_gate": False,
            "passes_gate_relaxed": False,
            "seasons_improved": 0,
            "avg_composite_delta": float("nan"),
            "avg_mae": float("nan"),
            "avg_boom_recall": float("nan"),
            "note": "already_in_core",
        }

    added_cols = list(dict.fromkeys(core + [feature_col]))
    added_metrics = run_metrics_for_feature_set(position, test_seasons, enriched, added_cols)

    season_results = []
    for season in test_seasons:
        if season not in added_metrics or season not in skeleton_metrics:
            continue
        base_cs = skeleton_metrics[season]["composite_score"]
        added = added_metrics[season]
        added_cs = added["composite_score"]
        season_results.append(
            {
                "season": season,
                **added,
                "composite_score": added_cs,
                "composite_delta": added_cs - base_cs,
            }
        )

    return _summarize_ablation(
        position, feature_col, season_results, skeleton_metrics, positive_delta_means_harm=False
    )


def screen_position(
    position: str,
    test_seasons: list[int] | None = None,
    data_dir: Path | None = None,
    candidate_dir: Path | None = None,
    top_n_ablation: int = 12,
    with_sentiment: bool = False,
) -> pd.DataFrame:
    data_dir = data_dir or PROCESSED_DATA_DIR
    candidate_dir = candidate_dir or CANDIDATE_DATA_DIR
    test_seasons = test_seasons or [2019, 2020, 2021, 2022, 2023, 2024]

    enriched = _load_enriched(position, data_dir, candidate_dir, with_sentiment=with_sentiment)
    candidates = _candidate_columns(position, candidate_dir)
    if with_sentiment:
        candidates = list(dict.fromkeys(candidates + sentiment_feature_columns()))
    injury_cols = [
        c
        for c in (
            "injury_opportunity_boost_hist",
            "injury_opportunity_boost_hist_avg",
            "team_vacated_usage",
        )
        if c in enriched.columns
    ]
    candidates = list(dict.fromkeys(candidates + injury_cols))
    full_cols = screen_full_feature_cols(position, candidates, enriched)

    print(f"Screening {position}: core={len(core_feature_cols(position))} cols, full={len(full_cols)} cols")
    print("  (Production USAGE_BUNDLE is excluded from screening baseline.)")

    print(f"Full-suite baseline for {position} (LOO reference)...")
    full_metrics = run_metrics_for_feature_set(position, test_seasons, enriched, full_cols)

    print(f"Skeleton baseline for {position} (forward reference)...")
    skeleton_metrics = run_metrics_for_feature_set(
        position, test_seasons, enriched, core_feature_cols(position)
    )

    uni_rows = []
    for feat in candidates:
        if feat not in enriched.columns:
            continue
        uni_rows.append(univariate_screen(position, feat, test_seasons, enriched))
    uni_df = pd.DataFrame(uni_rows)
    if uni_df.empty:
        return uni_df

    uni_df = uni_df.sort_values("fpts_corr_mean", key=lambda s: s.abs(), ascending=False)
    top_feats = uni_df.head(top_n_ablation)["feature"].tolist()
    if position == "wr":
        priority = [f for f in WR_PHASE2_ABLATION if f in enriched.columns]
        top_feats = list(dict.fromkeys(top_feats + priority))

    loo_rows = []
    forward_rows = []
    for feat in top_feats:
        print(f"  LOO ablation: drop {feat}")
        loo_rows.append(
            evaluate_leave_one_out(position, feat, test_seasons, enriched, full_cols, full_metrics)
        )
        print(f"  Forward +1: {feat} on skeleton")
        forward_rows.append(
            evaluate_forward_add(position, feat, test_seasons, enriched, skeleton_metrics)
        )

    loo_df = pd.DataFrame(
        [
            {
                "feature": r["feature"],
                "passes_gate": r.get("passes_gate", False),
                "passes_gate_relaxed": r.get("passes_gate_relaxed", r.get("passes_gate", False)),
                "seasons_improved": r.get("seasons_improved"),
                "avg_composite_delta": r.get("avg_composite_delta"),
                "avg_mae": r.get("avg_mae"),
                "avg_boom_recall": r.get("avg_boom_recall"),
            }
            for r in loo_rows
        ]
    )
    loo_df = loo_df.rename(
        columns={
            "avg_composite_delta": "loo_avg_composite_delta",
            "seasons_improved": "loo_seasons_improved",
            "avg_mae": "loo_avg_mae",
            "avg_boom_recall": "loo_avg_boom_recall",
            "passes_gate": "loo_passes_gate",
            "passes_gate_relaxed": "loo_passes_gate_relaxed",
        }
    )

    fwd_df = pd.DataFrame(
        [
            {
                "feature": r["feature"],
                "forward_avg_composite_delta": r.get("avg_composite_delta"),
                "forward_seasons_improved": r.get("seasons_improved"),
                "forward_passes_gate": r.get("passes_gate"),
            }
            for r in forward_rows
        ]
    )

    # Promotion uses LOO columns mapped to legacy names for select_promoted_from_screen.
    promote_df = pd.DataFrame(
        [
            {
                "feature": r["feature"],
                "passes_gate": r.get("passes_gate", False),
                "passes_gate_relaxed": r.get("passes_gate_relaxed", False),
                "seasons_improved": r.get("seasons_improved"),
                "avg_composite_delta": r.get("avg_composite_delta"),
                "avg_mae": r.get("avg_mae"),
                "avg_boom_recall": r.get("avg_boom_recall"),
            }
            for r in loo_rows
        ]
    )

    result = uni_df.merge(loo_df, on="feature", how="left").merge(fwd_df, on="feature", how="left")
    out_path = ANALYTICS_DIR / f"feature_screen_{position}.csv"
    result.to_csv(out_path, index=False)
    print(f"Wrote {out_path}")

    promoted = select_promoted_from_screen(promote_df, ablation_mode="loo")
    save_promoted_features(position, promoted)
    print(f"Promoted {position} (LOO gate): {promoted}")
    return result


def screen_ngs_comparison(position: str = "wr", test_seasons: list[int] | None = None) -> dict:
    from src.config import NGS_RAW_DIR

    test_seasons = test_seasons or [2022, 2023, 2024]
    ngs_files = list(NGS_RAW_DIR.glob("*.csv")) + list(NGS_RAW_DIR.glob("*.parquet"))
    has_ngs = len(ngs_files) > 0

    report = {
        "position": position,
        "ngs_data_present": has_ngs,
        "data_source": "ngs" if has_ngs else "pbp_proxy",
        "note": (
            "NGS files found in data/raw/ngs/."
            if has_ngs
            else "No NGS files — using pbp_proxy target quality."
        ),
    }

    ngs_features = ["separation_at_throw_avg", "defender_closing_speed_avg", "target_quality_avg"]
    enriched = _load_enriched(position, PROCESSED_DATA_DIR, CANDIDATE_DATA_DIR)
    available = [f for f in ngs_features if f in enriched.columns]
    if available:
        candidates = _candidate_columns(position, CANDIDATE_DATA_DIR) + available
        full_cols = screen_full_feature_cols(position, candidates, enriched)
        full_metrics = run_metrics_for_feature_set(position, test_seasons, enriched, full_cols)
        ngs_results = []
        for feat in available:
            ngs_results.append(
                evaluate_leave_one_out(position, feat, test_seasons, enriched, full_cols, full_metrics)
            )
        report["feature_results"] = ngs_results
        report["any_passes_gate"] = any(r["passes_gate"] for r in ngs_results)

    out_path = ANALYTICS_DIR / "ngs_screen_report.json"
    out_path.write_text(json.dumps(report, indent=2, default=str))
    return report


def screen_all(test_seasons: list[int] | None = None, with_sentiment: bool = False) -> dict[str, pd.DataFrame]:
    ANALYTICS_DIR.mkdir(parents=True, exist_ok=True)
    results = {}
    for position in ("qb", "rb", "wr"):
        results[position] = screen_position(position, test_seasons, with_sentiment=with_sentiment)
    screen_ngs_comparison("wr", test_seasons)
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Screen candidate features for promotion")
    parser.add_argument("--position", choices=["qb", "rb", "wr", "all"], default="all")
    parser.add_argument(
        "--seasons",
        type=int,
        nargs="+",
        default=[2019, 2020, 2021, 2022, 2023, 2024],
    )
    parser.add_argument("--ngs-only", action="store_true")
    parser.add_argument(
        "--with-sentiment",
        action="store_true",
        help="Include YouTube beat narrative yt_* columns in screening",
    )
    args = parser.parse_args()

    if args.ngs_only:
        report = screen_ngs_comparison("wr", args.seasons)
        print(json.dumps(report, indent=2, default=str))
        return

    if args.position == "all":
        screen_all(args.seasons, with_sentiment=args.with_sentiment)
    else:
        screen_position(args.position, args.seasons, with_sentiment=args.with_sentiment)


if __name__ == "__main__":
    main()
