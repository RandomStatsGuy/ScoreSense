"""Audit sentiment coverage vs fantasy-relevant rosters by position and team."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from src.config import PROCESSED_DATA_DIR, SENTIMENT_FEATURES_PATH
from src.integrations.youtube import load_raw_content_cache
from src.sentiment.channels import TEAM_FRANCHISE_NAMES, load_channels
from src.sentiment.chat_sports_channels import load_chat_sports_channels
from src.sentiment.fantasy_channels import load_fantasy_channels
from src.sentiment.player_link import _name_col, load_season_roster
from src.sentiment.readout import build_sentiment_response

ALL_TEAMS = sorted(TEAM_FRANCHISE_NAMES.keys())

POSITION_GROUPS = {
    "qb": {"positions": ["QB"], "min_snaps_proxy": None},
    "rb": {"positions": ["RB"], "min_snaps_proxy": None},
    "wr": {"positions": ["WR", "TE"], "min_snaps_proxy": None},
}


def _relevant_players(season: int, week: int) -> pd.DataFrame:
    """Players with a projection row for season/week (fantasy-relevant universe)."""
    frames: list[pd.DataFrame] = []
    for pos_file, positions in (("qb", ["QB"]), ("rb", ["RB"]), ("wr", ["WR", "TE"])):
        path = PROCESSED_DATA_DIR / f"{pos_file}_mlready.parquet"
        if not path.exists():
            continue
        df = pd.read_parquet(path)
        df = df[(df["season"] == season) & (df["week"] == week)].copy()
        if df.empty:
            continue
        name_col = _name_col(df)
        pos_col = "position" if "position" in df.columns else None
        if pos_col:
            df = df[df[pos_col].isin(positions)]
        else:
            df["position"] = positions[0]
        frames.append(
            df[["player_id", "team", "position", name_col]].rename(columns={name_col: "player_name"})
        )
    if not frames:
        return pd.DataFrame(columns=["player_id", "team", "position", "player_name"])
    out = pd.concat(frames, ignore_index=True)
    out["player_id"] = out["player_id"].astype(str)
    out["team"] = out["team"].astype(str).str.upper()
    return out.drop_duplicates(subset=["player_id"])


def _sentiment_mentioned(season: int, week: int) -> pd.DataFrame:
    if not SENTIMENT_FEATURES_PATH.exists():
        return pd.DataFrame()
    df = pd.read_parquet(SENTIMENT_FEATURES_PATH)
    df = df[(df["season"] == season) & (df["week"] == week)]
    df = df[df["yt_mention_count"].fillna(0) > 0].copy()
    df["player_id"] = df["player_id"].astype(str)
    df["team"] = df["team"].astype(str).str.upper()
    return df


def _channel_gaps() -> dict:
    team_channels = load_channels(active_only=True)
    by_team: dict[str, set[str]] = {t: set() for t in ALL_TEAMS}
    for c in team_channels:
        if c.network in ("locked_on", "sb_nation", "chat_sports"):
            by_team.setdefault(c.team, set()).add(c.network)

    cs = {c.team: c for c in load_chat_sports_channels(active_only=True)}
    gaps = []
    for team in ALL_TEAMS:
        nets = by_team.get(team, set())
        missing = []
        if "locked_on" not in nets:
            missing.append("locked_on")
        if "sb_nation" not in nets:
            missing.append("sb_nation")
        cs_entry = cs.get(team)
        if not cs_entry or not cs_entry.active or cs_entry.needs_resolution():
            missing.append("chat_sports")
        if missing:
            gaps.append({"team": team, "missing_networks": missing, "chat_sports_label": getattr(cs_entry, "label", None)})
    return {"teams_with_gaps": gaps, "teams_full": len(ALL_TEAMS) - len(gaps)}


def _raw_video_teams(season: int | None = None) -> dict:
    raw = load_raw_content_cache()
    if raw.empty:
        return {"video_count": 0, "teams": [], "by_network": {}}
    if season and "published_at" in raw.columns:
        pub = pd.to_datetime(raw["published_at"], errors="coerce")
        raw = raw[pub.dt.year == season]
    teams = sorted(raw["team"].astype(str).str.upper().unique()) if "team" in raw.columns else []
    by_net = raw["network"].value_counts().to_dict() if "network" in raw.columns else {}
    return {
        "video_count": len(raw),
        "teams_with_videos": teams,
        "teams_missing": sorted(set(ALL_TEAMS) - set(teams)),
        "by_network": by_net,
    }


def audit(season: int, week: int, *, with_api: bool = False) -> dict:
    roster = _relevant_players(season, week)
    sentiment = _sentiment_mentioned(season, week)

    merged = roster.merge(
        sentiment[["player_id", "yt_mention_count", "yt_sentiment_score", "narrative_source_count"]],
        on="player_id",
        how="left",
    )
    merged["has_sentiment"] = merged["yt_mention_count"].fillna(0) > 0

    by_group: dict[str, dict] = {}
    for group, cfg in POSITION_GROUPS.items():
        scoped = merged[merged["position"].isin(cfg["positions"])]
        mentioned = scoped[scoped["has_sentiment"]]
        by_team = (
            scoped.groupby("team")
            .agg(total=("player_id", "count"), with_sentiment=("has_sentiment", "sum"))
            .reset_index()
        )
        by_team["pct"] = (by_team["with_sentiment"] / by_team["total"] * 100).round(1)
        teams_zero = by_team[by_team["with_sentiment"] == 0]["team"].tolist()
        by_group[group] = {
            "total_players": int(len(scoped)),
            "with_sentiment": int(mentioned["player_id"].nunique()),
            "coverage_pct": round(100 * mentioned["player_id"].nunique() / max(len(scoped), 1), 1),
            "teams_with_zero": teams_zero,
            "teams_all_have_some": len(teams_zero) == 0,
            "by_team": by_team.sort_values("pct").to_dict(orient="records"),
            "unmentioned_sample": scoped[~scoped["has_sentiment"]]["player_name"].head(15).tolist(),
        }

    api = {}
    if with_api:
        for pos in ("qb", "rb", "wr"):
            resp = build_sentiment_response(pos, season, week)
            api[pos] = {
                "count": resp["count"],
                "channels_active": resp["meta"]["channels_active"],
                "data_coverage": resp["meta"].get("data_coverage"),
            }

    return {
        "season": season,
        "week": week,
        "channel_gaps": _channel_gaps(),
        "raw_videos": _raw_video_teams(season),
        "fantasy_channels": len(load_fantasy_channels(active_only=True)),
        "position_groups": by_group,
        "api_readout": api,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--season", type=int, default=2025)
    parser.add_argument("--week", type=int, default=19)
    parser.add_argument("--with-api", action="store_true", help="Include slow per-player API readout")
    parser.add_argument("--json-out", type=Path, default=None)
    args = parser.parse_args()

    report = audit(args.season, args.week, with_api=args.with_api)
    text = json.dumps(report, indent=2)
    print(text)
    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
