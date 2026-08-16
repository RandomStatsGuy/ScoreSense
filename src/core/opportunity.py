"""Teammate-availability opportunity adjustments for projections.

Product/API language: **Opportunity adjustment** (points or fraction delta driven
by teammate availability). Internal feature column remains
``injury_opportunity_boost``; prediction table columns use the display name
``Opportunity Adjustment`` with a temporary ``Injury Boost`` compat alias.
"""

from __future__ import annotations

from typing import Any, Iterable

import pandas as pd

from src.integrations.sleeper import injured_players, match_player_to_sleeper

STATUS_WEIGHT = {
    "Out": 1.0,
    "IR": 1.0,
    "PUP": 0.9,
    "Doubtful": 0.75,
    "Questionable": 0.35,
}

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


def compute_vacated_usage(
    roster_df: pd.DataFrame,
    injured_df: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Estimate per-player opportunity boost when teammates are injured."""
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
            injured_names.add(inj.full_name.lower())
            match = team_df[team_df[name_col].str.lower() == inj.full_name.lower()]
            if match.empty:
                matched = match_player_to_sleeper(
                    inj.full_name, team, inj.position, injured_df
                )
                share = 0.08 if matched is None else 0.08
            else:
                share = float(match.iloc[0].get(share_col, 0.0))
            vacated += share * weight
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
    return result
