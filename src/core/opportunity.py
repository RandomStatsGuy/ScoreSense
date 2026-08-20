"""Teammate-availability opportunity adjustments for projections.

Product/API language: **Opportunity adjustment** (points or fraction delta driven
by teammate availability). Internal feature column remains
``injury_opportunity_boost``; prediction table columns use the display name
``Opportunity Adjustment`` with a temporary ``Injury Boost`` compat alias.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

import pandas as pd

from src.integrations.sleeper import injured_players

STATUS_WEIGHT = {
    "Out": 1.0,
    "IR": 1.0,
    "PUP": 0.9,
    "Doubtful": 0.75,
    "Questionable": 0.35,
}

# Do not invent usage for injured players missing from the projection roster
# (e.g. Questionable backup QBs omitted from the one-QB-per-team slate).
DEFAULT_OFF_ROSTER_SHARE = 0.0

# Only fantasy-relevant offensive skill positions vacate usage. Defensive /
# ST / OL injuries (CB, DT, DE, LB, K, …) must not boost skill-position
# projections — a Questionable corner does not create RB carries.
SKILL_OPPORTUNITY_POSITIONS = frozenset({"QB", "RB", "FB", "WR", "TE", "REC"})
_OPPORTUNITY_GROUP_BY_POS = {
    "QB": "qb",
    "RB": "rb",
    "FB": "rb",
    "WR": "pass",
    "TE": "pass",
    "REC": "pass",
}
# Share-fraction columns (0–1). Raw count columns like targets_avg are last
# resort and rejected when the value is not a share.
_SHARE_COLS_BY_GROUP: dict[str, tuple[str, ...]] = {
    "qb": ("target_share_avg", "carry_share_avg"),
    "rb": ("carry_share_avg", "target_share_avg"),
    "pass": ("target_share_avg", "carry_share_avg"),
    "all": ("target_share_avg", "carry_share_avg", "targets_avg"),
}

# ROS near-term horizons (weeks) aligned with data/injury/return_heuristics.yaml
# defaults (weeks_max / mid-window). Current-week opportunity must not be
# multiplied across every remaining game for short-lived tags like Questionable.
ROS_OPPORTUNITY_HORIZON_WEEKS: dict[str, int] = {
    "Out": 1,
    "IR": 6,
    "PUP": 9,
    "Doubtful": 2,
    "Questionable": 1,
}
DEFAULT_ROS_OPPORTUNITY_HORIZON_WEEKS = 1

_NOTE_STATUS_RE = re.compile(
    r"^\s*(?P<name>.+?)\s*(?:\((?P<status>[^)]*)\))?\s*$"
)

# Canonical prediction-frame column (API records / CSV / parquet).
OPPORTUNITY_ADJUSTMENT_COL = "Opportunity Adjustment"
# Temporary read/write alias while clients migrate off the old name.
OPPORTUNITY_ADJUSTMENT_LEGACY_COL = "Injury Boost"
OPPORTUNITY_ADJUSTMENT_KEYS: tuple[str, ...] = (
    OPPORTUNITY_ADJUSTMENT_COL,
    "opportunity_adjustment",
    OPPORTUNITY_ADJUSTMENT_LEGACY_COL,
    "injury_boost",
)


def _name_col(df: pd.DataFrame) -> str:
    if "player_display_name" in df.columns:
        return "player_display_name"
    if "player_name" in df.columns:
        return "player_name"
    return "Player"


def parse_injury_note_statuses(injury_note: str | None) -> list[str]:
    """Extract injury status labels from an ``Injury Note`` string.

    Notes look like ``\"Ja'Marr Chase (Questionable); Other (Out)\"``.
    """
    note = str(injury_note or "").strip()
    if not note:
        return []
    statuses: list[str] = []
    for segment in note.split(";"):
        segment = segment.strip()
        if not segment:
            continue
        match = _NOTE_STATUS_RE.match(segment)
        if not match:
            continue
        status = (match.group("status") or "").strip()
        if status:
            statuses.append(status)
    return statuses


def ros_opportunity_horizon_weeks(
    statuses: Iterable[str] | None = None,
    *,
    injury_note: str | None = None,
    has_opportunity: bool = False,
) -> int:
    """Return-window horizon (weeks) for applying current opportunity to ROS.

    Uses the max status horizon from ``ROS_OPPORTUNITY_HORIZON_WEEKS``. When a
    boost is present but statuses are unknown, defaults to
    ``DEFAULT_ROS_OPPORTUNITY_HORIZON_WEEKS`` (Questionable-scale).
    """
    resolved = list(statuses or [])
    if not resolved and injury_note:
        resolved = parse_injury_note_statuses(injury_note)
    if not resolved:
        return DEFAULT_ROS_OPPORTUNITY_HORIZON_WEEKS if has_opportunity else 0
    return max(
        ROS_OPPORTUNITY_HORIZON_WEEKS.get(str(status).strip(), DEFAULT_ROS_OPPORTUNITY_HORIZON_WEEKS)
        for status in resolved
    )


def ros_opportunity_decay_factors(horizon_weeks: int, weeks_remaining: int) -> list[float]:
    """Per-offset decay factors for current-week opportunity over remaining weeks.

    Linear decay to zero by ``horizon_weeks``:

    * ``factor[k] = max(0, 1 - k / horizon_weeks)`` for ``k`` in ``0 .. weeks_remaining-1``
    * Questionable (horizon=1) → ``[1.0, 0, 0, ...]`` — this week only
    * Doubtful (horizon=2) → ``[1.0, 0.5, 0, ...]``

    Weekly single-week projections are unchanged; only ROS aggregation uses these
    factors so short-lived designations do not inflate season-long totals.
    """
    remaining = max(0, int(weeks_remaining))
    horizon = max(0, int(horizon_weeks))
    if remaining <= 0 or horizon <= 0:
        return [0.0] * remaining
    return [max(0.0, 1.0 - (k / float(horizon))) for k in range(remaining)]


def effective_ros_opportunity_weeks(horizon_weeks: int, weeks_remaining: int) -> float:
    """Sum of decay factors — effective weeks of current opportunity credited to ROS."""
    return float(sum(ros_opportunity_decay_factors(horizon_weeks, weeks_remaining)))


def _normalize_pos(value: Any) -> str:
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value).strip().upper()


def skill_opportunity_group(position: Any) -> str | None:
    """Return qb/rb/pass for fantasy skill positions; None for defense/ST/OL."""
    pos = _normalize_pos(position)
    if pos not in SKILL_OPPORTUNITY_POSITIONS:
        return None
    return _OPPORTUNITY_GROUP_BY_POS.get(pos)


def _position_col(df: pd.DataFrame) -> str | None:
    for col in ("position", "Position"):
        if col in df.columns:
            return col
    return None


def _row_value(row: pd.Series, *keys: str) -> Any:
    for key in keys:
        if key not in row.index:
            continue
        value = row[key]
        if value is None:
            continue
        try:
            if pd.isna(value):
                continue
        except (TypeError, ValueError):
            pass
        text = str(value).strip()
        if text and text.lower() != "nan":
            return value
    return None


def _share_col_for_group(columns: Iterable[str], group: str) -> str | None:
    preferred = _SHARE_COLS_BY_GROUP.get(group, _SHARE_COLS_BY_GROUP["all"])
    col_set = set(columns)
    return next((c for c in preferred if c in col_set), None)


def _roster_match(
    team_df: pd.DataFrame,
    *,
    name_col: str,
    player_name: str,
    player_id: Any = None,
) -> pd.DataFrame:
    """Match an injured teammate to a roster row (id first, then name)."""
    pid = str(player_id or "").strip()
    if pid and "player_id" in team_df.columns:
        ids = team_df["player_id"].astype(str)
        match = team_df[ids == pid]
        if not match.empty:
            return match
    names = team_df[name_col].astype(str).str.lower()
    return team_df[names == str(player_name or "").strip().lower()]


def _roster_usage_share(
    team_df: pd.DataFrame,
    *,
    name_col: str,
    share_col: str,
    player_name: str,
    player_id: Any = None,
) -> float:
    """Return projected usage share for an injured teammate, or 0 if not on roster.

    SCORE-47: players absent from the projection roster (backups filtered by
    depth chart, zero/unknown snap share) contribute no vacated usage. Never
    invent a default share for off-roster injuries.
    """
    match = _roster_match(
        team_df,
        name_col=name_col,
        player_name=player_name,
        player_id=player_id,
    )
    if match.empty:
        return DEFAULT_OFF_ROSTER_SHARE
    raw = match.iloc[0].get(share_col, 0.0)
    try:
        share = float(raw)
    except (TypeError, ValueError):
        return 0.0
    if pd.isna(share) or share <= 0.0:
        return 0.0
    # Count columns (targets_avg, attempts) are not shares; ignore them.
    if share > 1.0:
        return 0.0
    return share


def _injured_skill_group(
    inj: pd.Series,
    match: pd.DataFrame,
    pos_col: str | None,
) -> str | None:
    """Resolve opportunity group from injury position, then roster position.

    Defensive / non-skill labels always win: a CB who leaked onto an offensive
    feature row still must not vacate RB/WR usage.
    """
    inj_pos = _row_value(inj, "position", "Position")
    inj_group = skill_opportunity_group(inj_pos)
    if _normalize_pos(inj_pos) and inj_group is None:
        return None
    if inj_group:
        return inj_group
    if pos_col and not match.empty:
        return skill_opportunity_group(match.iloc[0].get(pos_col))
    return None


def compute_vacated_usage(
    roster_df: pd.DataFrame,
    injured_df: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Estimate per-player opportunity boost when teammates are injured.

    Only *offensive skill-position* injuries that map to a positive projected
    usage share on the current roster vacate opportunity. Off-roster backups
    (SCORE-47) and defensive / ST / OL injuries do not inflate skill players.

    Vacated usage is allocated within the same opportunity group (QB, RB,
    pass-catcher) so a WR injury does not splash onto QBs/RBs and vice versa.
    """
    injured_df = injured_df if injured_df is not None else injured_players()
    out = roster_df.copy()
    out["injury_opportunity_boost"] = 0.0
    out["injury_note"] = ""

    if "team" not in out.columns:
        return out
    if _share_col_for_group(out.columns, "all") is None:
        return out

    name_col = _name_col(out)
    pos_col = _position_col(out)

    for team, team_df in out.groupby("team"):
        team_injured = injured_df[injured_df["team"] == team]
        if team_injured.empty:
            continue

        vacated_by_group: dict[str, float] = {}
        notes_by_group: dict[str, list[str]] = {}
        injured_names: set[str] = set()

        for _, inj in team_injured.iterrows():
            injured_names.add(str(inj.full_name).lower())
            lookup_id = _row_value(inj, "gsis_id", "player_id")
            match = _roster_match(
                team_df,
                name_col=name_col,
                player_name=inj.full_name,
                player_id=lookup_id,
            )
            driver_group = _injured_skill_group(inj, match, pos_col)
            if driver_group is None:
                continue
            alloc_group = driver_group if pos_col else "all"
            share_col = _share_col_for_group(out.columns, alloc_group)
            if share_col is None:
                continue
            weight = STATUS_WEIGHT.get(inj.injury_status, 0.5)
            share = _roster_usage_share(
                team_df,
                name_col=name_col,
                share_col=share_col,
                player_name=inj.full_name,
                player_id=lookup_id,
            )
            contribution = share * weight
            if contribution <= 0.0:
                continue
            vacated_by_group[alloc_group] = (
                vacated_by_group.get(alloc_group, 0.0) + contribution
            )
            notes_by_group.setdefault(alloc_group, []).append(
                f"{inj.full_name} ({inj.injury_status})"
            )

        if not vacated_by_group:
            continue

        healthy = team_df[~team_df[name_col].astype(str).str.lower().isin(injured_names)]
        if healthy.empty:
            continue

        for alloc_group, vacated in vacated_by_group.items():
            share_col = _share_col_for_group(out.columns, alloc_group)
            if share_col is None:
                continue
            active = healthy
            if pos_col and alloc_group != "all":
                groups = active[pos_col].map(skill_opportunity_group)
                active = active[groups == alloc_group]
            if active.empty:
                continue
            weights = pd.to_numeric(active[share_col], errors="coerce").fillna(0.0).clip(
                lower=0.01
            )
            total_weight = float(weights.sum()) or float(len(active))
            boost_alloc = vacated * (weights / total_weight)
            note = "; ".join(notes_by_group.get(alloc_group, [])[:3])
            for idx, boost in boost_alloc.items():
                prev = float(out.loc[idx, "injury_opportunity_boost"] or 0.0)
                out.loc[idx, "injury_opportunity_boost"] = prev + float(boost)
                if note:
                    existing_note = str(out.loc[idx, "injury_note"] or "")
                    out.loc[idx, "injury_note"] = (
                        f"{existing_note}; {note}" if existing_note else note
                    )

    return out


def pick_opportunity_adjustment(
    row: dict[str, Any] | pd.Series | None,
    keys: Iterable[str] = OPPORTUNITY_ADJUSTMENT_KEYS,
) -> float | None:
    """Read opportunity adjustment fraction from a row (canonical + legacy aliases)."""
    if row is None:
        return None
    getter = row.get if hasattr(row, "get") else None
    for key in keys:
        raw = getter(key) if getter is not None else (row[key] if key in row.index else None)
        if raw is None or raw == "":
            continue
        try:
            if pd.isna(raw):
                continue
        except (TypeError, ValueError):
            pass
        try:
            return float(raw)
        except (TypeError, ValueError):
            continue
    return None


def attach_opportunity_adjustment(
    frame: pd.DataFrame,
    values: pd.Series | float,
    *,
    include_legacy_alias: bool = True,
) -> pd.DataFrame:
    """Write canonical Opportunity Adjustment (+ optional Injury Boost alias)."""
    result = frame
    series = (
        pd.Series(values, index=result.index, dtype="float64")
        if not isinstance(values, pd.Series)
        else pd.to_numeric(values, errors="coerce")
    )
    series = series.reindex(result.index).fillna(0.0).astype(float)
    result[OPPORTUNITY_ADJUSTMENT_COL] = series
    if include_legacy_alias:
        result[OPPORTUNITY_ADJUSTMENT_LEGACY_COL] = series
    return result


def ensure_opportunity_adjustment_columns(
    frame: pd.DataFrame,
    *,
    include_legacy_alias: bool = True,
) -> pd.DataFrame:
    """Normalize opportunity columns on load so serve paths expose the new name.

    Accepts frames that only have the legacy ``Injury Boost`` column (cold
    artifacts) and dual-writes the canonical name during the alias period.
    """
    if frame is None or frame.empty:
        return frame
    source = None
    for key in OPPORTUNITY_ADJUSTMENT_KEYS:
        if key in frame.columns:
            source = pd.to_numeric(frame[key], errors="coerce").fillna(0.0)
            break
    if source is None:
        return frame
    out = frame.copy()
    return attach_opportunity_adjustment(
        out, source, include_legacy_alias=include_legacy_alias
    )


def apply_opportunity_to_projections(
    projections: pd.DataFrame,
    roster_df: pd.DataFrame,
) -> pd.DataFrame:
    """Scale projections by opportunity adjustment (used by legacy callers)."""
    roster = compute_vacated_usage(roster_df)
    name_col = _name_col(roster)
    boost = roster.set_index(name_col)["injury_opportunity_boost"]
    result = projections.copy()
    mapped = result["Player"].map(boost).fillna(0.0)
    attach_opportunity_adjustment(result, mapped)
    multiplier = 1.0 + result[OPPORTUNITY_ADJUSTMENT_COL].clip(0, 0.35)
    for col in ("Projected Points", "Low (P10)", "High (P90)"):
        if col in result.columns:
            result[col] = result[col] * multiplier
    from src.ml.quantile import repair_projection_quantiles

    return repair_projection_quantiles(
        result,
        column_sets=(("Low (P10)", "Projected Points", "High (P90)"),),
    )
