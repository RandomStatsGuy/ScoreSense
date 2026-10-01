"""Research-only pregame role inputs; no production model opts into these."""
from __future__ import annotations

import pandas as pd

ROLE_SOURCES = {
    "rb": ("offense_pct_lead", "carry_share_lead", "target_share_lead", "rz_carries_lead"),
    "wr": ("offense_pct_lead", "target_share_lead", "air_yards_share_lead", "rz_targets_lead"),
}


def role_feature_cols(position: str) -> list[str]:
    if position not in ROLE_SOURCES:
        raise ValueError("Current-role research supports RB and WR/TE only")
    return [f"recent4_{raw.removesuffix('_lead')}_avg" for raw in ROLE_SOURCES[position]]


def role_history(history: pd.DataFrame, position: str, *, completed: bool = False) -> pd.DataFrame:
    """Current-season last four appearances; earlier games only at the opener.

    Missing snap/usage observations stay missing, and a played zero remains zero.
    Callers must filter target/future games before using completed profiles.
    """
    cols = role_feature_cols(position)
    if history.duplicated(["player_id", "season", "week"]).any():
        raise ValueError("Current-role research requires unique player games")
    out = history.sort_values(["player_id", "season", "week"]).copy()
    first = out.groupby(["player_id", "season"]).cumcount().eq(0) & (not completed)
    for raw, name in zip(ROLE_SOURCES[position], cols):
        if raw not in out:
            raise ValueError(f"Missing current-role source: {raw}")
        values = pd.to_numeric(out[raw], errors="coerce")
        def window(s):
            return (s if completed else s.shift()).rolling(4, min_periods=1).mean()
        career = values.groupby(out.player_id).transform(window)
        current = values.groupby([out.player_id, out.season]).transform(window)
        out[name] = current.where(~first, career)
    return out


def attach_position(frame: pd.DataFrame) -> pd.DataFrame:
    if "position" not in frame:
        raise ValueError("WR/TE research requires each row's observed position")
    out = frame.copy()
    position = out.position.astype(str).str.upper()
    if not position.isin(("WR", "TE")).all():
        raise ValueError("Position-indicator research requires explicit WR or TE identities")
    out["is_tight_end"] = position.eq("TE").astype(float)
    return out


def role_inference_inputs(rows: pd.DataFrame, history: pd.DataFrame, position: str) -> pd.DataFrame:
    """Serving-parity probe for candidate research, not production inference."""
    cols = role_feature_cols(position)
    out = rows.copy()
    if out.empty:
        for col in cols:
            out[col] = pd.Series(index=out.index, dtype=float)
        return attach_position(out) if position == "wr" else out
    contexts = rows[["season", "week"]].drop_duplicates()
    if len(contexts) != 1:
        raise ValueError("Role inference requires one target season/week")
    season, week = contexts.iloc[0].astype(int)
    prior = history[(history.season < season) | ((history.season == season) & (history.week < week))]
    profiles = role_history(prior, position, completed=True)
    # If there are no current-season appearances, recover the last four career
    # games, matching the training transformation before a season's first row.
    for raw, col in zip(ROLE_SOURCES[position], cols):
        career = pd.to_numeric(profiles[raw], errors="coerce").groupby(profiles.player_id).transform(
            lambda s: s.rolling(4, min_periods=1).mean())
        profiles[col] = profiles[col].where(profiles.season.eq(season), career)
    lookup = profiles.groupby("player_id").tail(1).set_index("player_id")
    for col in cols:
        out[col] = out.player_id.map(lookup[col])
    return attach_position(out) if position == "wr" else out
