"""Discover position- and team-specific YouTube channel accuracy niches."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd

from src.analytics.fantasy_channel_eval import (
    MIN_MENTION_ROWS,
    _load_base,
    _spearman_pvalue,
    correlation_stats,
    projection_lift,
)
from src.config import ANALYTICS_DIR
from src.integrations.youtube import load_raw_content_cache
from src.sentiment.channel_features import build_single_channel_features, list_ingested_channels
from src.sentiment.merge import sentiment_feature_columns

REPORT_PATH = ANALYTICS_DIR / "niche_channel_discovery.json"
POSITIONS = ("qb", "rb", "wr")


def _position_mask(feats: pd.DataFrame, position: str) -> pd.DataFrame:
    if feats.empty:
        return feats
    pos = position.upper()
    if pos == "WR":
        return feats[feats["position"].isin(["WR", "TE"])]
    return feats[feats["position"] == pos]


def _merge_channel(position: str, feats: pd.DataFrame, team_filter: str | None) -> pd.DataFrame:
    base = _load_base(position)
    if team_filter:
        team_filter = team_filter.upper()
        base = base[base["team"].astype(str).str.upper() == team_filter]
        feats = feats[feats["team"].astype(str).str.upper() == team_filter]

    feat_cols = [c for c in sentiment_feature_columns() if c in feats.columns]
    if not feat_cols:
        return base

    merged = base.merge(
        feats[["player_id", "season", "week", *feat_cols]],
        on=["player_id", "season", "week"],
        how="left",
    )
    for col in feat_cols:
        if col != "yt_top_snippet":
            merged[col] = pd.to_numeric(merged[col], errors="coerce").fillna(0.0)
    return merged


def _niche_tier(corr: dict, proj: dict) -> str:
    n = int(corr.get("n") or 0)
    p = corr.get("p_value")
    rho = corr.get("spearman_rho")
    delta = proj.get("avg_composite_delta")
    improved = int(proj.get("seasons_improved") or 0)

    if (
        n >= 40
        and p is not None
        and p < 0.05
        and delta is not None
        and delta < -0.01
    ):
        return "strong"
    if delta is not None and delta < -0.02 and improved >= 1 and n >= 30:
        return "lift"
    if n >= MIN_MENTION_ROWS and p is not None and p < 0.05 and rho is not None and abs(rho) >= 0.1:
        return "correlation"
    if n >= MIN_MENTION_ROWS and p is not None and p < 0.10:
        return "watch"
    if delta is not None and delta < -0.005 and improved >= 2:
        return "watch"
    return "none"


def evaluate_niche(
    channel_row: pd.Series,
    position: str,
    seasons: list[int],
    *,
    run_projection: bool,
    feature_cache: dict[tuple[str, int], pd.DataFrame],
) -> dict:
    channel_id = str(channel_row["channel_id"])
    team = str(channel_row["team"]).upper()
    scope_team = None if team == "NFL" else team

    parts: list[pd.DataFrame] = []
    for season in seasons:
        key = (channel_id, season)
        if key not in feature_cache:
            feature_cache[key] = build_single_channel_features(season, channel_id)
        scoped = _position_mask(feature_cache[key], position)
        if not scoped.empty:
            parts.append(scoped)

    if not parts:
        return {
            "position": position,
            "scope_team": scope_team or "league",
            "correlation": {"n": 0},
            "projection": {"seasons_tested": 0},
            "tier": "none",
        }

    feats = pd.concat(parts, ignore_index=True)
    merged = _merge_channel(position, feats, scope_team)
    corr = correlation_stats(merged, seasons)
    proj = (
        projection_lift(position, merged, seasons)
        if run_projection and int(corr.get("n") or 0) >= MIN_MENTION_ROWS
        else {"seasons_tested": 0, "seasons_improved": 0, "avg_composite_delta": None}
    )
    tier = _niche_tier(corr, proj)
    return {
        "position": position,
        "scope_team": scope_team or "league",
        "correlation": corr,
        "projection": proj,
        "tier": tier,
    }


def discover_niches(
    seasons: list[int] | None = None,
    *,
    projection_for_tiers: tuple[str, ...] = ("watch", "correlation", "lift", "strong"),
    min_videos: int = 100,
) -> dict:
    seasons = seasons or [2024, 2025]
    videos = load_raw_content_cache()
    channels = list_ingested_channels(videos)
    channels = channels[channels["video_count"] >= min_videos].reset_index(drop=True)

    feature_cache: dict[tuple[str, int], pd.DataFrame] = {}
    channel_results: list[dict] = []
    all_niches: list[dict] = []

    for _, row in channels.iterrows():
        niches: list[dict] = []
        for position in POSITIONS:
            result = evaluate_niche(
                row,
                position,
                seasons,
                run_projection=False,
                feature_cache=feature_cache,
            )
            corr = result.get("correlation") or {}
            n = int(corr.get("n") or 0)
            p = corr.get("p_value")
            if n >= MIN_MENTION_ROWS and p is not None and p < 0.10:
                result = evaluate_niche(
                    row,
                    position,
                    seasons,
                    run_projection=True,
                    feature_cache=feature_cache,
                )
            result["tier"] = _niche_tier(result.get("correlation") or {}, result.get("projection") or {})
            niches.append(result)
            if result["tier"] != "none":
                all_niches.append(
                    {
                        "channel_id": str(row["channel_id"]),
                        "channel_label": str(row["channel_label"]),
                        "network": str(row["network"]),
                        "team": str(row["team"]).upper(),
                        "video_count": int(row["video_count"]),
                        **result,
                    }
                )

        channel_results.append(
            {
                "channel_id": str(row["channel_id"]),
                "channel_label": str(row["channel_label"]),
                "network": str(row["network"]),
                "team": str(row["team"]).upper(),
                "video_count": int(row["video_count"]),
                "niches": niches,
            }
        )

    tier_rank = {"strong": 0, "lift": 1, "correlation": 2, "watch": 3, "none": 9}

    def _sort_key(item: dict) -> tuple:
        corr = item.get("correlation") or {}
        proj = item.get("projection") or {}
        p = corr.get("p_value")
        p_sort = p if p is not None and not (isinstance(p, float) and math.isnan(p)) else 1.0
        delta = proj.get("avg_composite_delta")
        delta_sort = delta if delta is not None else 0.0
        return (
            tier_rank.get(item.get("tier", "none"), 9),
            p_sort,
            delta_sort,
            -int(corr.get("n") or 0),
        )

    ranked = sorted(all_niches, key=_sort_key)
    coverage = _coverage_matrix(ranked)

    report = {
        "test_seasons": seasons,
        "channels_scanned": len(channel_results),
        "niches_found": len(ranked),
        "ranked_niches": ranked,
        "coverage_matrix": coverage,
        "channel_results": channel_results,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    return report


def _coverage_matrix(ranked: list[dict]) -> dict:
    """Map position -> best known niche channel."""
    matrix: dict[str, dict | None] = {pos: None for pos in POSITIONS}
    team_matrix: dict[str, dict[str, dict | None]] = {}

    for item in ranked:
        pos = item["position"]
        team = item["team"]
        tier = item["tier"]
        if tier in ("none",):
            continue

        if team == "NFL":
            current = matrix.get(pos)
            if current is None or _tier_better(tier, current["tier"]):
                matrix[pos] = {
                    "channel_label": item["channel_label"],
                    "network": item["network"],
                    "tier": tier,
                    "spearman_rho": (item.get("correlation") or {}).get("spearman_rho"),
                    "p_value": (item.get("correlation") or {}).get("p_value"),
                    "avg_composite_delta": (item.get("projection") or {}).get("avg_composite_delta"),
                }
        else:
            team_matrix.setdefault(team, {p: None for p in POSITIONS})
            current = team_matrix[team].get(pos)
            if current is None or _tier_better(tier, current["tier"]):
                team_matrix[team][pos] = {
                    "channel_label": item["channel_label"],
                    "network": item["network"],
                    "tier": tier,
                    "spearman_rho": (item.get("correlation") or {}).get("spearman_rho"),
                    "p_value": (item.get("correlation") or {}).get("p_value"),
                    "avg_composite_delta": (item.get("projection") or {}).get("avg_composite_delta"),
                }

    gaps = {
        "league_positions_missing_strong": [
            pos for pos, entry in matrix.items() if entry is None or entry["tier"] not in ("strong", "lift", "correlation")
        ],
        "teams_without_any_niche": [],
    }

    return {
        "league_wide": matrix,
        "by_team": team_matrix,
        "gaps": gaps,
    }


def _tier_better(new_tier: str, old_tier: str) -> bool:
    order = {"strong": 0, "lift": 1, "correlation": 2, "watch": 3, "none": 9}
    return order.get(new_tier, 9) < order.get(old_tier, 9)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", type=int, nargs="+", default=[2024, 2025])
    parser.add_argument("--min-videos", type=int, default=100)
    parser.add_argument("--report-path", default=None)
    args = parser.parse_args()

    report = discover_niches(args.seasons, min_videos=args.min_videos)
    top = report["ranked_niches"][:15]
    print(json.dumps({"top_niches": top, "coverage": report["coverage_matrix"]["league_wide"]}, indent=2))
    out = Path(args.report_path) if args.report_path else REPORT_PATH
    print(f"\nWrote {out} ({report['niches_found']} niches from {report['channels_scanned']} channels)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
