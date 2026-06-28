"""Map projection rank to dollar bands on a salary cap scale."""

from __future__ import annotations

from typing import Any

import pandas as pd

from src.draft_hub.auction_values import (
    auction_relevant_count,
    build_player_values,
    tier_label,
)
from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.schemas import LeagueRules


def generate_tiers(
    pool: pd.DataFrame,
    rules: LeagueRules,
    *,
    team_count: int = 12,
    proj_col: str = "Season Proj",
    pos_col: str = "Position",
    values: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Derive min/max salary ranges from league-aware projection rank."""
    rows: list[dict[str, Any]] = []
    if pool.empty:
        return rows

    if values is None:
        values = build_player_values(pool, rules, team_count=team_count, proj_col=proj_col, pos_col=pos_col)
    df = pool.copy()
    if pos_col not in df.columns:
        df[pos_col] = "UNK"
    if proj_col not in df.columns:
        df[proj_col] = 0.0

    for pos, group in df.groupby(df[pos_col].astype(str).str.upper()):
        pos = normalize_position(str(pos))
        g = group.sort_values(proj_col, ascending=False).reset_index(drop=True)
        n_rel = auction_relevant_count(pos, team_count, rules)
        for i, (_, row) in enumerate(g.iterrows()):
            pid = str(row.get("player_id") or row.get("Player") or "")
            if not pid:
                continue
            mv = values.get(pid) or {}
            rows.append(
                {
                    "player_id": pid,
                    "player_name": str(row.get("Player") or ""),
                    "team": str(row.get("Team") or ""),
                    "position": pos,
                    "min_sal": float(mv.get("min_sal") or rules.auction.min_bid),
                    "max_sal": float(mv.get("max_sal") or rules.auction.min_bid),
                    "source": "model",
                    "tier": mv.get("tier") or tier_label(i, n_rel),
                    "model_mid": float(mv.get("fair_value") or rules.auction.min_bid),
                }
            )
    return rows
