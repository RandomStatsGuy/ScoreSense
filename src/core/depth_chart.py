"""Depth-chart filtering for preseason inference rosters."""

from __future__ import annotations

from collections.abc import Callable

import pandas as pd

from src.core.team_codes import normalize_team_to_mlready

QB_STARTERS_PER_TEAM = 1
RB_STARTERS_PER_TEAM = 2
WR_STARTERS_PER_TEAM = 3

# Deeper pools for auction / preseason boards (handcuffs, rookies, rotation pieces)
DRAFT_QB_PER_TEAM = 2
DRAFT_RB_PER_TEAM = 4
DRAFT_WR_PER_TEAM = 6

_NAME_COLS = ("player_display_name", "player_name", "Player")


def _games_played(mlready_df: pd.DataFrame, feature_season: int) -> dict[str, int]:
    scoped = mlready_df[mlready_df["season"] == feature_season]
    if scoped.empty:
        return {}
    counts = scoped.groupby(scoped["player_id"].astype(str))["week"].nunique()
    return {str(pid): int(n) for pid, n in counts.items()}


def _non_rookie_rank(row: pd.Series) -> int:
    return 0 if bool(row.get("_rookie_estimate", False)) else 1


def _sleeper_depth_sort_key(row: pd.Series) -> tuple[int, int]:
    """Prefer Sleeper depth chart order when present (QB1 before prior-year volume leaders)."""
    dc = row.get("_sleeper_depth_order")
    try:
        if dc is None or (isinstance(dc, float) and pd.isna(dc)):
            return (0, 0)
        dc_i = int(dc)
    except (TypeError, ValueError):
        return (0, 0)
    if dc_i <= 0:
        return (0, 0)
    # reverse=True ⇒ (1, -1) beats (1, -2) beats (0, 0)
    return (1, -dc_i)


def _qb_starter_key(row: pd.Series, games_played: dict[str, int]) -> tuple:
    pid = str(row.get("player_id") or "")
    gp = int(games_played.get(pid, 0))
    has_dc, dc_pri = _sleeper_depth_sort_key(row)
    return (
        has_dc,
        dc_pri,
        gp,
        _non_rookie_rank(row),
        float(row.get("pass_attmpt_avg") or 0),
        float(row.get("passing_yards_avg") or 0),
    )


def _rb_starter_key(row: pd.Series, games_played: dict[str, int]) -> tuple:
    pid = str(row.get("player_id") or "")
    gp = int(games_played.get(pid, 0))
    has_dc, dc_pri = _sleeper_depth_sort_key(row)
    return (
        has_dc,
        dc_pri,
        gp,
        _non_rookie_rank(row),
        float(row.get("carry_share_avg") or 0),
        float(row.get("rush_attmpt_avg") or 0),
        float(row.get("targets_avg") or 0),
    )


def _wr_starter_key(row: pd.Series, games_played: dict[str, int]) -> tuple:
    pid = str(row.get("player_id") or "")
    gp = int(games_played.get(pid, 0))
    has_dc, dc_pri = _sleeper_depth_sort_key(row)
    return (
        has_dc,
        dc_pri,
        gp,
        _non_rookie_rank(row),
        float(row.get("target_share_avg") or 0),
        float(row.get("targets_avg") or 0),
        float(row.get("receptions_avg") or 0),
    )


def _player_label(row: pd.Series, columns: pd.Index) -> str:
    name_col = next((c for c in _NAME_COLS if c in columns), None)
    if name_col:
        return str(row[name_col])
    return str(row.get("player_id") or "")


def _sole_rookie_qb_group(group: pd.DataFrame, games_played: dict[str, int]) -> bool:
    """True when every QB on the team is a rookie stub with zero feature-season starts."""
    if group.empty:
        return False
    for _, row in group.iterrows():
        pid = str(row.get("player_id") or "")
        if int(games_played.get(pid, 0)) > 0:
            return False
        if not bool(row.get("_rookie_estimate", False)):
            return False
    return True


def _filter_by_team_rank(
    roster: pd.DataFrame,
    mlready_df: pd.DataFrame,
    feature_season: int,
    key_fn: Callable[[pd.Series, dict[str, int]], tuple],
    keep_n: int,
    *,
    sole_rookie_qb: bool = False,
    always_keep_rookie_estimates: bool = False,
) -> tuple[pd.DataFrame, dict]:
    if roster.empty or "team" not in roster.columns:
        return roster.copy(), {"applied": False, "removed": 0}

    games_played = _games_played(mlready_df, feature_season)
    roster = roster.copy()
    roster["_team_norm"] = roster["team"].astype(str).map(normalize_team_to_mlready)

    keep_rows: list[pd.Series] = []
    removed_players: list[str] = []
    sole_rookie_teams: list[str] = []

    for team, group in roster.groupby("_team_norm", sort=False):
        if len(group) <= keep_n:
            keep_rows.extend(row for _, row in group.iterrows())
            if sole_rookie_qb and _sole_rookie_qb_group(group, games_played):
                sole_rookie_teams.append(str(team))
            continue

        ranked = sorted(
            (row for _, row in group.iterrows()),
            key=lambda row: key_fn(row, games_played),
            reverse=True,
        )
        if sole_rookie_qb and _sole_rookie_qb_group(group, games_played):
            sole_rookie_teams.append(str(team))
            keep_count = max(1, keep_n)
        else:
            keep_count = keep_n

        keep_rows.extend(ranked[:keep_count])
        kept_labels = {_player_label(row, group.columns) for row in ranked[:keep_count]}
        if always_keep_rookie_estimates:
            for _, row in group.iterrows():
                if not bool(row.get("_rookie_estimate", False)):
                    continue
                label = _player_label(row, group.columns)
                if label in kept_labels:
                    continue
                keep_rows.append(row)
                kept_labels.add(label)
        for row in ranked[keep_count:]:
            if always_keep_rookie_estimates and bool(row.get("_rookie_estimate", False)):
                continue
            removed_players.append(_player_label(row, group.columns))

    out = pd.DataFrame(keep_rows).drop(columns=["_team_norm"], errors="ignore")
    meta: dict = {
        "applied": True,
        "removed": len(removed_players),
        "removed_players": removed_players,
        "keep_per_team": keep_n,
    }
    if sole_rookie_teams:
        meta["sole_rookie_teams"] = sole_rookie_teams
    return out.reset_index(drop=True), meta


def filter_qb_depth_chart(
    roster: pd.DataFrame,
    mlready_df: pd.DataFrame,
    feature_season: int,
) -> tuple[pd.DataFrame, dict]:
    """Keep one QB per team based on recent pass volume and games started."""
    return _filter_by_team_rank(
        roster,
        mlready_df,
        feature_season,
        _qb_starter_key,
        QB_STARTERS_PER_TEAM,
        sole_rookie_qb=True,
    )


def filter_rb_depth_chart(
    roster: pd.DataFrame,
    mlready_df: pd.DataFrame,
    feature_season: int,
) -> tuple[pd.DataFrame, dict]:
    """Keep top RBs per team by carry share and rush volume."""
    return _filter_by_team_rank(
        roster,
        mlready_df,
        feature_season,
        _rb_starter_key,
        RB_STARTERS_PER_TEAM,
    )


def filter_wr_depth_chart(
    roster: pd.DataFrame,
    mlready_df: pd.DataFrame,
    feature_season: int,
) -> tuple[pd.DataFrame, dict]:
    """Keep top WR/TE per team by target share."""
    return _filter_by_team_rank(
        roster,
        mlready_df,
        feature_season,
        _wr_starter_key,
        WR_STARTERS_PER_TEAM,
    )


def depth_chart_note_suffix(position: str, depth: dict) -> str:
    """Human-readable depth-chart note for projection responses."""
    if not depth.get("applied") or int(depth.get("removed") or 0) <= 0:
        return ""
    keep = int(depth.get("keep_per_team") or 1)
    removed = int(depth["removed"])
    labels = {"qb": "QB", "rb": "RB", "wr": "WR/TE"}
    label = labels.get(position.lower(), position.upper())
    if keep == 1:
        return f" One {label} per team for preseason ({removed} backups omitted)."
    return f" Top {keep} {label} per team for preseason ({removed} omitted)."


def filter_depth_chart_starters(
    roster: pd.DataFrame,
    position: str,
    mlready_df: pd.DataFrame,
    feature_season: int,
    *,
    depth_mode: str = "starter",
) -> tuple[pd.DataFrame, dict]:
    keep_map = {
        "draft": {"qb": DRAFT_QB_PER_TEAM, "rb": DRAFT_RB_PER_TEAM, "wr": DRAFT_WR_PER_TEAM},
        "starter": {"qb": QB_STARTERS_PER_TEAM, "rb": RB_STARTERS_PER_TEAM, "wr": WR_STARTERS_PER_TEAM},
    }
    keep_n = keep_map.get(depth_mode, keep_map["starter"]).get(position.lower())
    dispatch = {
        "qb": (filter_qb_depth_chart, keep_n or QB_STARTERS_PER_TEAM),
        "rb": (filter_rb_depth_chart, keep_n or RB_STARTERS_PER_TEAM),
        "wr": (filter_wr_depth_chart, keep_n or WR_STARTERS_PER_TEAM),
    }
    entry = dispatch.get(position.lower())
    if entry is None:
        return roster, {"applied": False, "removed": 0}
    fn, n = entry
    if depth_mode == "draft":
        return _filter_by_team_rank(
            roster,
            mlready_df,
            feature_season,
            {"qb": _qb_starter_key, "rb": _rb_starter_key, "wr": _wr_starter_key}[position.lower()],
            n,
            sole_rookie_qb=position.lower() == "qb",
            always_keep_rookie_estimates=True,
        )
    return fn(roster, mlready_df, feature_season)
