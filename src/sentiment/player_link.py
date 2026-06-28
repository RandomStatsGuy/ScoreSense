"""Link extracted player names to nflverse player_id using season roster."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from src.config import PROCESSED_DATA_DIR
from src.integrations.external_projections import _normalize_name


def _name_col(df: pd.DataFrame) -> str:
    for col in ("player_display_name", "player_name", "Player"):
        if col in df.columns:
            return col
    return "player_display_name"


def _roster_position(row: pd.Series, position_file: str) -> str:
    """Map mlready file key to roster position; preserve WR vs TE from nflverse."""
    if position_file == "wr" and "position" in row.index:
        pos = str(row.get("position") or "WR").upper()
        if pos in ("WR", "TE"):
            return pos
    return position_file.upper()


def _append_roster_frame(frames: list[pd.DataFrame], df: pd.DataFrame, position_file: str) -> None:
    name_col = _name_col(df)
    scoped = df.copy()
    scoped["position"] = scoped.apply(lambda row: _roster_position(row, position_file), axis=1)
    scoped["name_key"] = scoped[name_col].map(_normalize_name)
    scoped["display_name"] = scoped[name_col].astype(str)
    frames.append(
        scoped.sort_values("week").groupby("player_id", as_index=False).tail(1)[
            ["player_id", "team", "position", "name_key", "display_name"]
        ]
    )


def load_season_roster(season: int, data_dir: Path | None = None) -> pd.DataFrame:
    """Latest row per player for the season across QB/RB/WR mlready files."""
    data_dir = data_dir or PROCESSED_DATA_DIR
    frames: list[pd.DataFrame] = []
    for position in ("qb", "rb", "wr"):
        path = data_dir / f"{position}_mlready.parquet"
        if not path.exists():
            continue
        df = pd.read_parquet(path)
        df = df[df["season"] == season].copy()
        if df.empty:
            continue
        _append_roster_frame(frames, df, position)
    if frames:
        roster = pd.concat(frames, ignore_index=True)
        return roster.drop_duplicates(subset=["name_key", "team"], keep="last")

    # Future season: build from prior-year mlready + Sleeper overlay per position.
    from src.core.projection_context import build_inference_roster

    combined: list[pd.DataFrame] = []
    for position in ("qb", "rb", "wr"):
        path = data_dir / f"{position}_mlready.parquet"
        if not path.exists():
            continue
        df = pd.read_parquet(path)
        roster, _ = build_inference_roster(df, position, season, target_week=1)
        _append_roster_frame(combined, roster, position)
    if not combined:
        return pd.DataFrame(columns=["player_id", "team", "position", "name_key", "display_name"])
    roster = pd.concat(combined, ignore_index=True)
    return roster.drop_duplicates(subset=["name_key", "team"], keep="last")


def build_team_roster_lookup(roster: pd.DataFrame, team: str) -> dict[str, dict]:
    """Lowercase display name -> player row for one team."""
    team = str(team).upper()
    scoped = roster[roster["team"].astype(str).str.upper() == team]
    lookup: dict[str, dict] = {}
    for _, row in scoped.iterrows():
        lookup[str(row["display_name"]).lower()] = row.to_dict()
        lookup[str(row["name_key"]).lower()] = row.to_dict()
    return lookup


def roster_display_names(roster: pd.DataFrame, team: str) -> list[str]:
    team = str(team).upper()
    scoped = roster[roster["team"].astype(str).str.upper() == team]
    return scoped["display_name"].dropna().astype(str).tolist()


def roster_display_names_all(roster: pd.DataFrame) -> list[str]:
    return roster["display_name"].dropna().astype(str).tolist()


def link_mention(player_name: str, team: str, roster: pd.DataFrame) -> dict | None:
    lookup = build_team_roster_lookup(roster, team)
    key = player_name.strip().lower()
    if key in lookup:
        return lookup[key]
    name_key = _normalize_name(player_name)
    if name_key in lookup:
        return lookup[name_key]
    last = player_name.split()[-1].lower() if " " in player_name else key
    matches = [v for k, v in lookup.items() if k.endswith(last) or last in k]
    if len(matches) == 1:
        return matches[0]
    return None


def link_mention_league(player_name: str, roster: pd.DataFrame) -> dict | None:
    """Resolve a mention against the full-season roster (all teams)."""
    matches: list[dict] = []
    seen: set[str] = set()
    for team in roster["team"].astype(str).str.upper().unique():
        linked = link_mention(player_name, team, roster)
        if linked is None:
            continue
        pid = str(linked.get("player_id") or "")
        if pid and pid not in seen:
            seen.add(pid)
            matches.append(linked)
    if len(matches) == 1:
        return matches[0]
    return None
