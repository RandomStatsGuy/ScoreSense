"""Screen league-wide fantasy YouTube channels for predictive signal."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from src.analytics.candidate_etl import merge_candidates_into_mlready
from src.analytics.feature_screen import core_feature_cols, run_metrics_for_feature_set
from src.analytics.historical_injury import add_historical_injury_features
from src.config import ANALYTICS_DIR, PROCESSED_DATA_DIR, CANDIDATE_DATA_DIR
from src.sentiment.fantasy_aggregate import build_fantasy_channel_features
from src.sentiment.merge import sentiment_feature_columns

REPORT_PATH = ANALYTICS_DIR / "fantasy_channel_screen.json"
MIN_MENTION_ROWS = 30


def _load_base(position: str) -> pd.DataFrame:
    try:
        df = merge_candidates_into_mlready(position, PROCESSED_DATA_DIR, CANDIDATE_DATA_DIR)
    except FileNotFoundError:
        df = pd.read_parquet(PROCESSED_DATA_DIR / f"{position}_mlready.parquet")
    return add_historical_injury_features(df)


def _spearman_pvalue(rho: float, n: int) -> float:
    if n < 3 or math.isnan(rho):
        return float("nan")
    if abs(rho) >= 1.0:
        return 0.0
    t_stat = rho * math.sqrt((n - 2) / (1 - rho * rho))
    # Two-tailed normal approximation for large n
    from math import erf, sqrt

    z = abs(t_stat)
    p = 2 * (1 - 0.5 * (1 + erf(z / sqrt(2))))
    return min(1.0, max(0.0, p))


def correlation_stats(merged: pd.DataFrame, seasons: list[int]) -> dict:
    scoped = merged[merged["season"].isin(seasons)].copy()
    scoped = scoped[scoped["yt_mention_count"].fillna(0) > 0]
    if "Fpts" not in scoped.columns or scoped.empty:
        return {"n": 0, "spearman_rho": None, "p_value": None}

    valid = scoped.dropna(subset=["Fpts", "yt_sentiment_score"])
    n = len(valid)
    if n < MIN_MENTION_ROWS:
        return {"n": n, "spearman_rho": None, "p_value": None}

    rho = float(valid["yt_sentiment_score"].corr(valid["Fpts"], method="spearman"))
    hype_rho = float(valid["yt_role_hype_flag"].corr(valid["Fpts"], method="spearman"))
    injury_rho = float(valid["yt_injury_flag"].corr(valid["Fpts"], method="spearman"))
    return {
        "n": n,
        "spearman_rho": round(rho, 4),
        "role_hype_rho": round(hype_rho, 4),
        "injury_rho": round(injury_rho, 4),
        "p_value": round(_spearman_pvalue(rho, n), 4),
    }


def projection_lift(position: str, merged: pd.DataFrame, seasons: list[int]) -> dict:
    sentiment_cols = [c for c in sentiment_feature_columns() if c in merged.columns]
    if not sentiment_cols:
        return {"seasons_tested": 0, "seasons_improved": 0, "avg_composite_delta": None}

    core = core_feature_cols(position)
    base_metrics = run_metrics_for_feature_set(position, seasons, merged, core)
    sent_metrics = run_metrics_for_feature_set(position, seasons, merged, core + sentiment_cols)

    deltas = []
    improved = 0
    for season in seasons:
        if season not in base_metrics:
            continue
        base_m = base_metrics[season]
        sent_m = sent_metrics.get(season, {})
        delta = float(sent_m.get("composite_score", float("nan")) - base_m.get("composite_score", float("nan")))
        if not math.isnan(delta):
            deltas.append(delta)
            if delta < 0:
                improved += 1

    return {
        "seasons_tested": len(deltas),
        "seasons_improved": improved,
        "avg_composite_delta": round(float(np.mean(deltas)), 4) if deltas else None,
        "mention_coverage": round(
            float((merged[merged["season"].isin(seasons)]["yt_mention_count"].fillna(0) > 0).mean()),
            4,
        ),
    }


def evaluate_channel(
    channel_id: str,
    network: str,
    label: str,
    seasons: list[int],
) -> dict:
    positions = ("qb", "rb", "wr")
    position_results: dict[str, dict] = {}
    all_feats: list[pd.DataFrame] = []
    for season in seasons:
        part = build_fantasy_channel_features(season, channel_id)
        if not part.empty:
            all_feats.append(part)
    feats = pd.concat(all_feats, ignore_index=True) if all_feats else pd.DataFrame()

    for position in positions:
        if feats.empty:
            position_results[position] = {
                "correlation": {"n": 0},
                "projection": {"seasons_tested": 0},
            }
            continue

        pos_upper = position.upper()
        if pos_upper == "WR":
            pos_feats = feats[feats["position"].isin(["WR", "TE"])]
        else:
            pos_feats = feats[feats["position"] == pos_upper]
        if pos_feats.empty:
            position_results[position] = {
                "correlation": {"n": 0},
                "projection": {"seasons_tested": 0},
            }
            continue

        base = _load_base(position)
        feat_cols = [c for c in sentiment_feature_columns() if c in feats.columns]
        merged = base.merge(
            pos_feats[["player_id", "season", "week", *feat_cols]],
            on=["player_id", "season", "week"],
            how="left",
        )
        for col in feat_cols:
            if col != "yt_top_snippet":
                merged[col] = pd.to_numeric(merged[col], errors="coerce").fillna(0.0)

        position_results[position] = {
            "correlation": correlation_stats(merged, seasons),
            "projection": projection_lift(position, merged, seasons),
        }

    # Channel-level score
    sig_positions = 0
    helpful_positions = 0
    total_mention_rows = 0
    for pos, res in position_results.items():
        corr = res.get("correlation") or {}
        proj = res.get("projection") or {}
        total_mention_rows += int(corr.get("n") or 0)
        p = corr.get("p_value")
        rho = corr.get("spearman_rho")
        if p is not None and rho is not None and p < 0.10 and abs(rho) >= 0.05:
            sig_positions += 1
        if proj.get("avg_composite_delta") is not None and proj["avg_composite_delta"] < -0.01:
            helpful_positions += 1

    recommend = (
        helpful_positions >= 2
        or (helpful_positions >= 1 and sig_positions >= 1)
        or (sig_positions >= 2 and total_mention_rows >= 100)
    )

    return {
        "channel_id": channel_id,
        "network": network,
        "label": label,
        "positions": position_results,
        "sig_positions": sig_positions,
        "helpful_positions": helpful_positions,
        "total_mention_rows": total_mention_rows,
        "recommend_incorporate": recommend,
    }


def run_screen(
    channels: list[dict],
    seasons: list[int] | None = None,
    report_path: Path | None = None,
) -> dict:
    seasons = seasons or [2024, 2025]
    results = [
        evaluate_channel(row["channel_id"], row["network"], row["label"], seasons)
        for row in channels
    ]
    approved = [r for r in results if r["recommend_incorporate"]]
    report = {
        "test_seasons": seasons,
        "channels_tested": len(results),
        "channels_recommended": len(approved),
        "results": results,
        "approved_networks": [r["network"] for r in approved],
    }
    out = report_path or REPORT_PATH
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> int:
    import argparse

    from src.sentiment.fantasy_channels import load_fantasy_channels

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", type=int, nargs="+", default=[2024, 2025])
    parser.add_argument("--report-path", default=None)
    args = parser.parse_args()

    channels = [
        {"channel_id": c.channel_id, "network": c.network, "label": c.label}
        for c in load_fantasy_channels()
        if not c.needs_resolution()
    ]
    report = run_screen(channels, args.seasons, Path(args.report_path) if args.report_path else None)
    print(json.dumps(
        {
            "recommended": report["approved_networks"],
            "summary": [
                {
                    "label": r["label"],
                    "recommend": r["recommend_incorporate"],
                    "mention_rows": r["total_mention_rows"],
                }
                for r in report["results"]
            ],
        },
        indent=2,
    ))
    print(f"\nWrote {args.report_path or REPORT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
