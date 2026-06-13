"""Legacy PFF CSV preprocessing for backward-compatible desktop inference."""

from __future__ import annotations

import pandas as pd

from src.config import LEGACY_PFF_DIR, PROJECT_ROOT


def detect_position_from_path(filepath: str) -> str:
    lower = filepath.lower()
    if "passing" in lower:
        return "qb"
    if "rushing" in lower:
        return "rb"
    return "wr"


def preprocess_pff_csv(filepath: str, position: str) -> pd.DataFrame:
    """Convert legacy PFF export into feature rows compatible with v1 models."""
    df = pd.read_csv(filepath)

    if position == "qb":
        df3 = df.iloc[:, 3:].div(df.games, axis=0)
        df3["pname"] = df.player
        drop_cols = [
            "dropbacks", "drops", "comDrop", "passYds300Games", "depthAim",
            "td40s", "td50s", "ezAtt", "ezTds", "ezInts", "ezPct", "ezTdPct",
            "rushTd40s", "rzRushCarries", "rzRushTds", "rzRushPct",
            "i5RushCarries", "i5RushTds", "i5RushPct", "patConversions",
            "patAttempts", "fantasyPts", "ptsPerDb", "sks",
        ]
        df3 = df3.drop(columns=[c for c in drop_cols if c in df3.columns])
        feature_cols = [
            "yds", "tds", "ints", "comp", "att",
            "rushCarries", "rushYds", "rushTds", "fumbles",
        ]
    elif position == "rb":
        df3 = df.iloc[:, 4:].div(df.games, axis=0)
        df3["pname"] = df.player
        drop_cols = [
            "recRec40s", "recTd40s", "recYds100Games", "recDrops", "catch",
            "depth", "ypt", "ypr", "rac", "rzRecTarg", "rzRecRec", "rzRecTds",
            "rzRecTargPct", "rzRecRecPct", "rzRecTdPct", "ezRecTarg", "ezRecTds",
            "ezRecTargPct", "ezRecRecPct", "ezRecTdPct", "rush40s",
            "rushYds100Games", "rushTd40s", "ypc", "yac", "rushTa", "tat",
            "rzRushCarries", "rzRushTds", "rzRushPct", "rzRushTdPct",
            "i5RushCarries", "i5RushTds", "i5RushPct", "i5RushTdPct",
            "patConversions", "patAttempts", "fantasyPts", "ptsPerSnap", "ptsPerTouch",
        ]
        df3 = df3.drop(columns=[c for c in drop_cols if c in df3.columns])
        feature_cols = [
            "recYds", "recTds", "recRec", "recTarg",
            "rushCarries", "rushYds", "rushTds", "fumbles",
        ]
    else:
        df3 = df.iloc[:, 4:].div(df.games, axis=0)
        df3["pname"] = df.player
        drop_cols = [
            "recRec40s", "recTd40s", "recYds100Games", "recDrops", "catch",
            "depth", "ypt", "ypr", "rac", "rzRecTarg", "rzRecRec", "rzRecTds",
            "rzRecTargPct", "rzRecRecPct", "rzRecTdPct", "ezRecTarg", "ezRecTds",
            "ezRecTargPct", "ezRecRecPct", "ezRecTdPct", "rushCarries", "rush40s",
            "rushYds100Games", "rushTd40s", "ypc", "yac", "rushTa", "tat",
            "rzRushCarries", "rzRushTds", "rzRushPct", "rzRushTdPct",
            "i5RushCarries", "i5RushTds", "i5RushPct", "i5RushTdPct",
            "patConversions", "patAttempts", "fantasyPts", "ptsPerSnap", "ptsPerTouch",
        ]
        df3 = df3.drop(columns=[c for c in drop_cols if c in df3.columns])
        feature_cols = ["recYds", "recTds", "recRec", "recTarg", "fumbles"]

    available = ["pname"] + [c for c in feature_cols if c in df3.columns]
    return df3[available]


def default_pff_directory() -> str:
    return str(LEGACY_PFF_DIR if LEGACY_PFF_DIR.exists() else PROJECT_ROOT / "PFFData")
