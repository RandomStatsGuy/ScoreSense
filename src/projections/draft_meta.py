"""Draft projection metadata for dashboard season selectors."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from src.config import GAMES_PER_SEASON, PROCESSED_DATA_DIR
from src.projections.draft_projections import _feature_season_for_draft
from src.integrations.sleeper import get_nfl_state
from src.projections.projection_meta import get_projection_meta


def get_draft_meta(position: str, data_dir: Path | None = None) -> dict:
    data_dir = data_dir or PROCESSED_DATA_DIR
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise ValueError("position must be qb, rb, or wr")

    base = get_projection_meta(position, data_dir=data_dir)
    path = data_dir / f"{position}_mlready.parquet"
    if path.exists():
        raw = pd.read_parquet(path, columns=["season"])
        max_data_season = int(raw["season"].max())
    else:
        max_data_season = max(s for s in base["seasons"] if s <= base.get("calendar_season", 9999))
    upcoming = max_data_season + 1

    try:
        state = get_nfl_state()
        st_season = int(state.get("season") or state.get("league_season") or upcoming)
        st_type = str(state.get("season_type", "off"))
        if st_type == "off":
            default_season = min(max(st_season, upcoming), upcoming)
        else:
            default_season = min(st_season, upcoming)
    except Exception:
        default_season = upcoming

    draft_seasons = sorted({upcoming, max_data_season}, reverse=True)
    path = data_dir / f"{position}_mlready.parquet"
    df = pd.read_parquet(path, columns=["season", "week"]) if path.exists() else pd.DataFrame()
    feature_season = (
        _feature_season_for_draft(df, default_season, 1) if not df.empty else max_data_season
    )

    return {
        "position": position,
        "seasons": draft_seasons,
        "default_season": int(default_season),
        "games_per_season": GAMES_PER_SEASON,
        "feature_season": int(feature_season),
        "teams": base.get("teams", []),
    }
