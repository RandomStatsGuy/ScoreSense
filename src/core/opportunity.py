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


def _roster_usage_share(
    team_df: pd.DataFrame,
    *,
    name_col: str,
    share_col: str,
    player_name: str,
) -> float:
    """Return projected usage share for an injured teammate, or 0 if not on roster.

    SCORE-47: players absent from the projection roster (backups filtered by
    depth chart, zero/unknown snap share) contribute no vacated usage. Never
    invent a default share for off-roster injuries.
    """
    match = team_df[team_df[name_col].str.lower() == str(player_name).lower()]
    if match.empty:
        return DEFAULT_OFF_ROSTER_SHARE
    raw = match.iloc[0].get(share_col, 0.0)
    try:
        share = float(raw)
    except (TypeError, ValueError):
        return 0.0
    if pd.isna(share) or share <= 0.0:
        return 0.0
    return share


def compute_vacated_usage(
    roster_df: pd.DataFrame,
    injured_df: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Estimate per-player opportunity boost when teammates are injured.

    Only injuries that map to a positive projected usage share on the current
    roster vacate opportunity. Off-roster backups (common for Questionable
    depth QBs on a one-starter slate) do not inflate the incumbent.
    """
    injured_df = injured_df if injured_df is not None else injured_players()
    out = roster_df.copy()
    out["injury_opportunity_boost"] = 0.0
    out["injury_note"] = ""

    share_col = next(
        (c for c in ("target_share_avg", "carry_share_avg", "targets_avg") if c in out.columns),
        None,
    )
    if share_col is None or "team" not in out.columns:
        return out

    name_col = _name_col(out)

    for team, team_df in out.groupby("team"):
        team_injured = injured_df[injured_df["team"] == team]
        if team_injured.empty:
            continue

        vacated = 0.0
        notes: list[str] = []
        injured_names: set[str] = set()

        for _, inj in team_injured.iterrows():
            weight = STATUS_WEIGHT.get(inj.injury_status, 0.5)
            injured_names.add(str(inj.full_name).lower())
            share = _roster_usage_share(
                team_df,
                name_col=name_col,
                share_col=share_col,
                player_name=inj.full_name,
            )
            contribution = share * weight
            if contribution <= 0.0:
                continue
            vacated += contribution
            notes.append(f"{inj.full_name} ({inj.injury_status})")

        if vacated <= 0:
            continue

        active = team_df[~team_df[name_col].str.lower().isin(injured_names)]
        if active.empty:
            continue

        weights = active[share_col].clip(lower=0.01)
        total_weight = float(weights.sum()) or float(len(active))
        boost_alloc = vacated * (weights / total_weight)
        note = "; ".join(notes[:3])
        for idx, boost in boost_alloc.items():
            out.loc[idx, "injury_opportunity_boost"] = float(boost)
            out.loc[idx, "injury_note"] = note

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
