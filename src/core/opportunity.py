"""Injury-driven opportunity adjustments for projections."""

from __future__ import annotations

import pandas as pd

from src.integrations.sleeper import injured_players, match_player_to_sleeper

STATUS_WEIGHT = {
    "Out": 1.0,
    "IR": 1.0,
    "PUP": 0.9,
    "Doubtful": 0.75,
    "Questionable": 0.35,
}


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


def apply_opportunity_to_projections(
    projections: pd.DataFrame,
    roster_df: pd.DataFrame,
) -> pd.DataFrame:
    """Scale projections by injury opportunity boost (used by legacy callers)."""
    roster = compute_vacated_usage(roster_df)
    name_col = _name_col(roster)
    boost = roster.set_index(name_col)["injury_opportunity_boost"]
    result = projections.copy()
    result["Injury Boost"] = result["Player"].map(boost).fillna(0.0)
    multiplier = 1.0 + result["Injury Boost"].clip(0, 0.35)
    for col in ("Projected Points", "Low (P10)", "High (P90)"):
        if col in result.columns:
            result[col] = result[col] * multiplier
    return result
