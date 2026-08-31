"""Depth-chart filtering for preseason inference rosters."""

from __future__ import annotations

from collections.abc import Callable

import pandas as pd

from src.core.team_codes import normalize_team_to_mlready

# Weekly "starter" keep_n is the floor for newcomers (rookies / no GP).
# Established vets (feature-season games) are always kept on top of this.
QB_STARTERS_PER_TEAM = 2
RB_STARTERS_PER_TEAM = 3
WR_STARTERS_PER_TEAM = 4
TE_STARTERS_PER_TEAM = 2

# Deeper pools for auction / preseason boards (handcuffs, rookies, rotation pieces)
DRAFT_QB_PER_TEAM = 2
DRAFT_RB_PER_TEAM = 4
DRAFT_WR_PER_TEAM = 6
DRAFT_TE_PER_TEAM = 3

# Any player who appeared in the feature-season mlready is fantasy-relevant
# even if Sleeper has no depth_chart_order (injured stars, missing DC).
MIN_FEATURE_GAMES_ALWAYS_KEEP = 1

_NAME_COLS = ("player_display_name", "player_name", "Player")


def _safe_player_id(val: object) -> str:
    """Stringify a player_id. Pandas NA/NaN become '' instead of the literal 'nan'."""
    if val is None:
        return ""
    try:
        if pd.isna(val):
            return ""
    except (TypeError, ValueError):
        pass
    text = str(val).strip()
    if not text or text.lower() in {"nan", "none", "<na>"}:
        return ""
    return text


def _games_played(mlready_df: pd.DataFrame, feature_season: int) -> dict[str, int]:
    scoped = mlready_df[mlready_df["season"] == feature_season]
    if scoped.empty:
        return {}
    pids = scoped["player_id"].map(_safe_player_id)
    scoped = scoped.loc[pids.ne("")]
    if scoped.empty:
        return {}
    counts = scoped.groupby(pids.loc[scoped.index])["week"].nunique()
    return {str(pid): int(n) for pid, n in counts.items()}


def _non_rookie_rank(row: pd.Series) -> int:
    return 0 if bool(row.get("_rookie_estimate", False)) else 1


def _sleeper_depth_order(row: pd.Series) -> int | None:
    dc = row.get("_sleeper_depth_order")
    try:
        if dc is None or (isinstance(dc, float) and pd.isna(dc)):
            return None
        dc_i = int(dc)
    except (TypeError, ValueError):
        return None
    return dc_i if dc_i > 0 else None


def _sleeper_depth_sort_key(row: pd.Series) -> tuple[int, int]:
    """Sleeper depth among listed players (QB1 before QB2). Missing sorts last."""
    dc_i = _sleeper_depth_order(row)
    if dc_i is None:
        return (0, -99)
    return (1, -dc_i)


def _is_established_vet(row: pd.Series, games_played: dict[str, int]) -> bool:
    if bool(row.get("_rookie_estimate", False)):
        return False
    pid = _safe_player_id(row.get("player_id"))
    if not pid:
        return False
    return int(games_played.get(pid, 0)) >= MIN_FEATURE_GAMES_ALWAYS_KEEP


def _starter_signal(row: pd.Series, games_played: dict[str, int]) -> int:
    """Keep fantasy-relevant players ahead of camp bodies with a Sleeper DC slot.

    A listed backup (depth_order=1) used to beat an unranked starter because
    ``has_dc`` was the primary sort key. Established vets and listed QB1/RB1/WR1-2
    share the top band; everyone else ranks below.
    """
    if _is_established_vet(row, games_played):
        return 1
    dc_i = _sleeper_depth_order(row)
    if dc_i is not None and dc_i <= 2:
        return 1
    return 0


def _qb_starter_key(row: pd.Series, games_played: dict[str, int]) -> tuple:
    pid = _safe_player_id(row.get("player_id"))
    gp = int(games_played.get(pid, 0))
    has_dc, dc_pri = _sleeper_depth_sort_key(row)
    return (
        _starter_signal(row, games_played),
        has_dc,
        dc_pri,
        gp,
        _non_rookie_rank(row),
        float(row.get("pass_attmpt_avg") or 0),
        float(row.get("passing_yards_avg") or 0),
    )


def _rb_starter_key(row: pd.Series, games_played: dict[str, int]) -> tuple:
    pid = _safe_player_id(row.get("player_id"))
    gp = int(games_played.get(pid, 0))
    has_dc, dc_pri = _sleeper_depth_sort_key(row)
    return (
        _starter_signal(row, games_played),
        has_dc,
        dc_pri,
        gp,
        _non_rookie_rank(row),
        float(row.get("carry_share_avg") or 0),
        float(row.get("rush_attmpt_avg") or 0),
        float(row.get("targets_avg") or 0),
    )


def _wr_starter_key(row: pd.Series, games_played: dict[str, int]) -> tuple:
    pid = _safe_player_id(row.get("player_id"))
    gp = int(games_played.get(pid, 0))
    has_dc, dc_pri = _sleeper_depth_sort_key(row)
    return (
        _starter_signal(row, games_played),
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
    return _safe_player_id(row.get("player_id"))


def _sole_rookie_qb_group(group: pd.DataFrame, games_played: dict[str, int]) -> bool:
    """True when every QB on the team is a rookie stub with zero feature-season starts."""
    if group.empty:
        return False
    for _, row in group.iterrows():
        pid = _safe_player_id(row.get("player_id"))
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
    always_keep_established: bool = False,
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
        if always_keep_established:
            for _, row in group.iterrows():
                if not _is_established_vet(row, games_played):
                    continue
                label = _player_label(row, group.columns)
                if label in kept_labels:
                    continue
                keep_rows.append(row)
                kept_labels.add(label)
        for row in ranked[keep_count:]:
            if always_keep_rookie_estimates and bool(row.get("_rookie_estimate", False)):
                continue
            if always_keep_established and _is_established_vet(row, games_played):
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
    *,
    always_keep_established: bool = False,
) -> tuple[pd.DataFrame, dict]:
    """Keep starting QBs per team; optionally retain every vet with feature-season games."""
    return _filter_by_team_rank(
        roster,
        mlready_df,
        feature_season,
        _qb_starter_key,
        QB_STARTERS_PER_TEAM,
        sole_rookie_qb=True,
        always_keep_established=always_keep_established,
    )


def filter_rb_depth_chart(
    roster: pd.DataFrame,
    mlready_df: pd.DataFrame,
    feature_season: int,
    *,
    always_keep_established: bool = False,
) -> tuple[pd.DataFrame, dict]:
    """Keep top RBs per team by carry share and rush volume."""
    return _filter_by_team_rank(
        roster,
        mlready_df,
        feature_season,
        _rb_starter_key,
        RB_STARTERS_PER_TEAM,
        always_keep_established=always_keep_established,
    )


def _split_wr_te(roster: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    if roster.empty or "position" not in roster.columns:
        return roster.copy(), roster.iloc[0:0].copy()
    pos = roster["position"].astype(str).str.upper()
    te = roster[pos.eq("TE")].copy()
    wr = roster[~pos.eq("TE")].copy()
    return wr, te


def filter_wr_depth_chart(
    roster: pd.DataFrame,
    mlready_df: pd.DataFrame,
    feature_season: int,
    *,
    always_keep_established: bool = False,
    always_keep_rookie_estimates: bool = False,
    wr_keep: int | None = None,
    te_keep: int | None = None,
) -> tuple[pd.DataFrame, dict]:
    """Keep top WRs and TEs per team separately so TEs do not crowd out WR2/WR3."""
    wr_keep = WR_STARTERS_PER_TEAM if wr_keep is None else int(wr_keep)
    te_keep = TE_STARTERS_PER_TEAM if te_keep is None else int(te_keep)
    wr_roster, te_roster = _split_wr_te(roster)
    wr_out, wr_meta = _filter_by_team_rank(
        wr_roster,
        mlready_df,
        feature_season,
        _wr_starter_key,
        wr_keep,
        always_keep_established=always_keep_established,
        always_keep_rookie_estimates=always_keep_rookie_estimates,
    )
    if te_roster.empty:
        wr_meta["te_keep_per_team"] = te_keep
        wr_meta["keep_per_team"] = wr_keep
        return wr_out, wr_meta
    te_out, te_meta = _filter_by_team_rank(
        te_roster,
        mlready_df,
        feature_season,
        _wr_starter_key,
        te_keep,
        always_keep_established=always_keep_established,
        always_keep_rookie_estimates=always_keep_rookie_estimates,
    )
    out = pd.concat([wr_out, te_out], ignore_index=True)
    meta = {
        "applied": True,
        "removed": int(wr_meta.get("removed") or 0) + int(te_meta.get("removed") or 0),
        "removed_players": list(wr_meta.get("removed_players") or [])
        + list(te_meta.get("removed_players") or []),
        "keep_per_team": wr_keep,
        "te_keep_per_team": te_keep,
    }
    return out, meta


def depth_chart_note_suffix(position: str, depth: dict) -> str:
    """Human-readable depth-chart note for projection responses."""
    if not depth.get("applied") or int(depth.get("removed") or 0) <= 0:
        return ""
    keep = int(depth.get("keep_per_team") or 1)
    removed = int(depth["removed"])
    labels = {"qb": "QB", "rb": "RB", "wr": "WR/TE"}
    label = labels.get(position.lower(), position.upper())
    te_keep = depth.get("te_keep_per_team")
    if keep == 1:
        note = f" One {label} per team for preseason ({removed} backups omitted)."
    else:
        note = f" Top {keep} {label} per team for preseason ({removed} omitted)."
    if te_keep:
        note = note.replace("WR/TE", f"WR (+ {int(te_keep)} TE)")
    return note


def filter_depth_chart_starters(
    roster: pd.DataFrame,
    position: str,
    mlready_df: pd.DataFrame,
    feature_season: int,
    *,
    depth_mode: str = "starter",
) -> tuple[pd.DataFrame, dict]:
    draft = depth_mode == "draft"
    keep_rookies = draft
    pos = position.lower()
    if pos == "qb":
        return _filter_by_team_rank(
            roster,
            mlready_df,
            feature_season,
            _qb_starter_key,
            DRAFT_QB_PER_TEAM if draft else QB_STARTERS_PER_TEAM,
            sole_rookie_qb=True,
            always_keep_rookie_estimates=keep_rookies,
            always_keep_established=True,
        )
    if pos == "rb":
        return _filter_by_team_rank(
            roster,
            mlready_df,
            feature_season,
            _rb_starter_key,
            DRAFT_RB_PER_TEAM if draft else RB_STARTERS_PER_TEAM,
            always_keep_rookie_estimates=keep_rookies,
            always_keep_established=True,
        )
    if pos == "wr":
        return filter_wr_depth_chart(
            roster,
            mlready_df,
            feature_season,
            always_keep_established=True,
            always_keep_rookie_estimates=keep_rookies,
            wr_keep=DRAFT_WR_PER_TEAM if draft else WR_STARTERS_PER_TEAM,
            te_keep=DRAFT_TE_PER_TEAM if draft else TE_STARTERS_PER_TEAM,
        )
    return roster, {"applied": False, "removed": 0}
