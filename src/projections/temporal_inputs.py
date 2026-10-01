"""Versioned, identical pre-game inputs for training and inference.

Legacy bundles retain their original input contract. New bundles opt into these
policies explicitly; recent usage is a candidate until its historical gate passes.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pandas as pd

PREGAME_POLICY = "pregame_v1"
RECENT_POLICY = "pregame_recent4_v1"
RECENT_SEASON_POLICY = "pregame_season_recent4_v1"
RECENT_MEDIAN_POLICY = "pregame_season_recent4_p50_v1"
RECENT_POLICIES = (RECENT_POLICY, RECENT_SEASON_POLICY, RECENT_MEDIAN_POLICY)
SEASON_RECENT_POLICIES = (RECENT_SEASON_POLICY, RECENT_MEDIAN_POLICY)
INPUT_POLICIES = (PREGAME_POLICY, *RECENT_POLICIES)
UNAVAILABLE_TRACKING = ("separation_at_throw_avg", "defender_closing_speed_avg")
EPA_COLS = ("opponent_pass_epa_allowed", "opponent_rush_epa_allowed")
RECENT_SOURCES = {
    "qb": ("Fpts", "attempts_lead", "passing_yards_lead", "carries_lead", "rushing_yards_lead"),
    "rb": ("Fpts", "carries_lead", "rushing_yards_lead", "targets_lead", "receptions_lead"),
    "wr": ("Fpts", "targets_lead", "receptions_lead", "receiving_yards_lead", "receiving_air_yards_lead"),
}


def recent_feature_cols(position: str) -> list[str]:
    return [f"recent4_{c.removesuffix('_lead')}_avg" for c in RECENT_SOURCES[position]]


def policy_feature_cols(position: str, base_cols: list[str], policy: str) -> list[str]:
    # The BDB tracking feeds do not cover these historical cohorts. A NGS
    # separation aggregate measures a different thing and cannot stand in for it.
    # Legacy target quality used normalization across future seasons.
    cols = [c for c in base_cols if c not in (*UNAVAILABLE_TRACKING, "target_quality_avg")]
    if position == "wr":
        cols.append("target_quality_raw_avg")
    if policy in RECENT_POLICIES:
        cols.extend(recent_feature_cols(position))
    return list(dict.fromkeys(cols))


def quantile_feature_subsets(position: str, feature_cols: list[str], policy: str) -> dict[float, list[str]] | None:
    if policy != RECENT_MEDIAN_POLICY:
        return None
    tail_cols = [c for c in feature_cols if c not in recent_feature_cols(position)]
    return {.1: tail_cols, .9: tail_cols}


def attach_pregame_defense(rows: pd.DataFrame, history: pd.DataFrame) -> pd.DataFrame:
    """Last eight observed defensive games, strictly before the target week.

    Deduplicate player repetitions of a team's game before averaging. The source
    columns are realized per-game EPA, never already-lagged model inputs. Equal
    game weights match the legacy game-level aggregation, rather than pretending
    these are play-weighted season averages.
    """
    out = rows.copy()
    keys = ["opponent", "season", "week"]
    if not set(keys).issubset(rows) or not set(keys).issubset(history):
        raise ValueError("Pre-game defensive inputs require opponent, season and week")
    out["_target_key"] = out["season"].astype(int) * 100 + out["week"].astype(int)
    for col in EPA_COLS:
        if col not in history:
            raise ValueError(f"Missing defensive source: {col}")
        games = history.groupby(keys, as_index=False)[col].median().sort_values(["season", "week"])
        games["_target_key"] = games["season"].astype(int) * 100 + games["week"].astype(int)
        games[col] = games.groupby("opponent")[col].transform(
            lambda s: s.rolling(8, min_periods=1).mean()
        )
        # asof requires globally sorted time keys; preserve caller row order/index.
        targets = out[["opponent", "_target_key"]].assign(_row_order=np.arange(len(out)))
        valid = targets[targets["opponent"].notna() & targets["opponent"].ne("")]
        values = np.full(len(out), np.nan)
        if not valid.empty and not games.empty:
            matched = pd.merge_asof(
                valid.sort_values("_target_key"),
                games[["opponent", "_target_key", col]].sort_values("_target_key"),
                on="_target_key", by="opponent", direction="backward", allow_exact_matches=False,
            )
            values[matched["_row_order"].to_numpy()] = matched[col].to_numpy()
        out[col] = values
    return out.drop(columns="_target_key")


def recent_usage_frame(history: pd.DataFrame, position: str, *, completed: bool = False, season_bounded: bool = False) -> pd.DataFrame:
    """Four observed games, preserving zero/negative scores and missing values.

    Training excludes each row's own game. Completed profiles include that game
    only after the caller has excluded the target week and all future games.
    This window counts observed appearances, not inactive roster weeks.
    """
    out = history.sort_values(["player_id", "season", "week"]).copy()
    for raw, name in zip(RECENT_SOURCES[position], recent_feature_cols(position)):
        if raw not in out:
            raise ValueError(f"Missing recent-usage source: {raw}")
        values = pd.to_numeric(out[raw], errors="coerce")
        out[name] = values.groupby(out["player_id"]).transform(
            lambda s: (s if completed else s.shift(1)).rolling(4, min_periods=1).mean()
        )
        if season_bounded:
            groups = [out["player_id"], out["season"]]
            current = values.groupby(groups).transform(
                lambda s: (s if completed else s.shift(1)).rolling(4, min_periods=1).mean()
            )
            # Before the opener there is no new-season evidence. After an
            # appearance, let the current season describe the current role.
            first = out.groupby(["player_id", "season"]).cumcount().eq(0) & (not completed)
            out[name] = current.where(~first, out[name])
    return out


def training_inputs(data: pd.DataFrame, position: str, policy: str) -> pd.DataFrame:
    if policy not in INPUT_POLICIES:
        raise ValueError(f"Unknown model input policy: {policy}")
    out = attach_pregame_defense(data, data)
    if position == "wr":
        if "target_quality_raw_lead" not in data:
            raise ValueError("Rebuild raw target quality before a versioned WR model comparison")
        out = out.sort_values(["player_id", "season", "week"])
        out["target_quality_raw_avg"] = out.groupby("player_id")["target_quality_raw_lead"].transform(
            lambda s: s.shift(1).expanding(min_periods=1).mean()
        )
    return recent_usage_frame(out, position, season_bounded=policy in SEASON_RECENT_POLICIES) if policy in RECENT_POLICIES else out


def inference_inputs(rows: pd.DataFrame, history: pd.DataFrame, position: str, policy: str) -> pd.DataFrame:
    if policy not in INPUT_POLICIES:
        raise ValueError(f"Unknown model input policy: {policy}")
    out = attach_pregame_defense(rows, history)
    if rows.empty:
        return out
    contexts = rows[["season", "week"]].drop_duplicates()
    if len(contexts) != 1:
        raise ValueError("Inference rows must share one target season/week")
    season, week = contexts.iloc[0].astype(int)
    prior = history[(history.season < season) | ((history.season == season) & (history.week < week))]
    if position == "wr":
        if "target_quality_raw_lead" not in prior:
            raise ValueError("Rebuild raw target quality before versioned WR inference")
        raw = prior.groupby("player_id")["target_quality_raw_lead"].mean()
        out["target_quality_raw_avg"] = out["player_id"].map(raw)
    if policy not in RECENT_POLICIES:
        return out
    inclusive = recent_usage_frame(prior, position, completed=True, season_bounded=policy in SEASON_RECENT_POLICIES)
    if policy in SEASON_RECENT_POLICIES:
        career = recent_usage_frame(prior, position, completed=True)
        for col in recent_feature_cols(position):
            inclusive[col] = inclusive[col].where(inclusive.season.eq(season), career[col])
    profiles = inclusive.groupby("player_id").tail(1)
    lookup = profiles.set_index("player_id")
    for col in recent_feature_cols(position):
        out[col] = out["player_id"].map(lookup[col])
    # Estimated roster players have no personal recent games. Keep these gaps
    # visible to the audit before compatibility feature imputation.
    return out


def feature_digest(X: pd.DataFrame, y: pd.Series) -> str:
    """Bind evaluation evidence to the actual model matrix and target values."""
    digest = hashlib.sha256("|".join(X.columns).encode())
    digest.update(pd.util.hash_pandas_object(X, index=False).to_numpy().tobytes())
    digest.update(pd.util.hash_pandas_object(y, index=False).to_numpy().tobytes())
    return digest.hexdigest()
