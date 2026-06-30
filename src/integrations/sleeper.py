"""Sleeper API integration for injuries and roster context."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

import pandas as pd
import requests

from src.config import CACHE_DIR

SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
SLEEPER_STATE_URL = "https://api.sleeper.app/v1/state/nfl"
STATE_CACHE = CACHE_DIR / "sleeper_nfl_state.json"
STATE_CACHE_TTL_SECONDS = 300
PLAYERS_CACHE = CACHE_DIR / "sleeper_players.json"
PLAYERS_CACHE_TTL_SECONDS = 86400

INJURY_STATUSES = {"Out", "Doubtful", "Questionable", "IR", "PUP"}
EXCLUDED_SLEEPER_STATUSES = {"Inactive", "Retired"}

SLEEPER_POSITIONS: dict[str, frozenset[str]] = {
    "qb": frozenset({"QB"}),
    "rb": frozenset({"RB", "FB"}),
    "wr": frozenset({"WR", "TE"}),
}


def _fetch_json(url: str) -> dict | list:
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    return response.json()


def get_nfl_state(use_cache: bool = True) -> dict:
    """Sleeper NFL calendar state — cached locally to avoid blocking every meta request."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if use_cache and STATE_CACHE.exists():
        age = time.time() - STATE_CACHE.stat().st_mtime
        if age < STATE_CACHE_TTL_SECONDS:
            try:
                return json.loads(STATE_CACHE.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
    state = _fetch_json(SLEEPER_STATE_URL)
    STATE_CACHE.write_text(json.dumps(state), encoding="utf-8")
    return state


def load_sleeper_players(force_refresh: bool = False) -> dict:
    """Load Sleeper player dictionary, cached locally for 24h."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if (
        not force_refresh
        and PLAYERS_CACHE.exists()
        and (time.time() - PLAYERS_CACHE.stat().st_mtime) < PLAYERS_CACHE_TTL_SECONDS
    ):
        return json.loads(PLAYERS_CACHE.read_text(encoding="utf-8"))

    players = _fetch_json(SLEEPER_PLAYERS_URL)
    PLAYERS_CACHE.write_text(json.dumps(players), encoding="utf-8")
    return players


def players_dataframe(force_refresh: bool = False) -> pd.DataFrame:
    raw = load_sleeper_players(force_refresh=force_refresh)
    rows = []
    for player_id, info in raw.items():
        if not info:
            continue
        rows.append(
            {
                "sleeper_id": player_id,
                "full_name": info.get("full_name") or "",
                "first_name": info.get("first_name") or "",
                "last_name": info.get("last_name") or "",
                "team": info.get("team") or "",
                "position": info.get("position") or "",
                "injury_status": info.get("injury_status") or "",
                "injury_body_part": info.get("injury_body_part") or "",
                "injury_notes": info.get("injury_notes") or "",
                "injury_start_date": info.get("injury_start_date"),
                "practice_participation": info.get("practice_participation") or "",
                "practice_description": info.get("practice_description") or "",
                "news_updated": info.get("news_updated"),
                "status": info.get("status") or "",
                "gsis_id": info.get("gsis_id") or "",
                "espn_id": info.get("espn_id") or "",
                "years_exp": info.get("years_exp"),
                "depth_chart_order": info.get("depth_chart_order"),
                "depth_chart_position": info.get("depth_chart_position") or "",
                "search_rank": info.get("search_rank"),
                "college": info.get("college") or "",
            }
        )
    return pd.DataFrame(rows)


def injured_players(force_refresh: bool = False) -> pd.DataFrame:
    df = players_dataframe(force_refresh=force_refresh)
    df = df[df["injury_status"].isin(INJURY_STATUSES)].copy()
    df = df[df["team"].astype(bool)]
    return df.sort_values(["team", "position", "full_name"]).reset_index(drop=True)


def _player_name_from_row(row: pd.Series) -> str:
    for col in ("player_display_name", "player_name", "Player"):
        if col in row.index and pd.notna(row[col]) and str(row[col]).strip():
            return str(row[col]).strip()
    return ""


def _sleeper_positions_for(position: str) -> frozenset[str]:
    key = position.lower()
    if key not in SLEEPER_POSITIONS:
        raise ValueError(f"Unsupported position for Sleeper overlay: {position}")
    return SLEEPER_POSITIONS[key]


def _build_sleeper_lookups(sleeper_df: pd.DataFrame, position: str) -> tuple[dict[str, pd.Series], dict[str, pd.Series]]:
    """Map gsis_id and lowercased full_name to Sleeper rows for one fantasy position."""
    allowed = _sleeper_positions_for(position)
    scoped = sleeper_df[sleeper_df["position"].isin(allowed)].copy()
    by_gsis: dict[str, pd.Series] = {}
    by_name: dict[str, pd.Series] = {}
    for _, row in scoped.iterrows():
        gsis = str(row.get("gsis_id") or "").strip()
        if gsis:
            by_gsis[gsis] = row
        name = str(row.get("full_name") or "").strip().lower()
        if name and name not in by_name:
            by_name[name] = row
    return by_gsis, by_name


def _lookup_sleeper_row(
    row: pd.Series,
    by_gsis: dict[str, pd.Series],
    by_name: dict[str, pd.Series],
) -> Optional[pd.Series]:
    player_id = str(row.get("player_id") or "").strip()
    if player_id and player_id in by_gsis:
        return by_gsis[player_id]
    name = _player_name_from_row(row).lower()
    if name and name in by_name:
        return by_name[name]
    return None


def _rookie_stub_from_template(
    template: pd.Series,
    sleeper_row: pd.Series,
    *,
    season: int,
    target_week: int,
    position: str,
    medians: pd.Series | None = None,
) -> pd.Series:
    from src.projections.rookie_role import compute_rookie_role, scale_rookie_stub_features

    stub = template.copy()
    stub["player_display_name"] = sleeper_row["full_name"]
    if "player_name" in stub.index:
        stub["player_name"] = sleeper_row["full_name"]
    stub["team"] = sleeper_row["team"]
    stub["position"] = position.upper()
    gsis = str(sleeper_row.get("gsis_id") or "").strip()
    stub["player_id"] = gsis or f"sleeper-{sleeper_row['sleeper_id']}"
    stub["season"] = season
    stub["week"] = target_week
    stub["_rookie_estimate"] = True

    mult, role_label = compute_rookie_role(position, sleeper_row, season=season)
    stub["_rookie_role_mult"] = mult
    stub["_rookie_role_label"] = role_label
    if medians is not None and mult != 1.0:
        stub = scale_rookie_stub_features(stub, medians, mult)
    return stub


def apply_sleeper_roster_overlay(
    roster_df: pd.DataFrame,
    position: str,
    *,
    season: int | None = None,
    target_week: int = 1,
    sleeper_df: Optional[pd.DataFrame] = None,
    add_rookies: bool = True,
    add_emerging: bool = False,
) -> tuple[pd.DataFrame, dict]:
    """
    Refresh team assignments from Sleeper for upcoming-season draft rosters.

    Updates team when a player changed teams since the feature season.
    Drops players Sleeper marks as free agents or inactive/retired.
    Optionally appends rookie rows (years_exp == 0) using a median feature template.
    When ``add_emerging`` is True, also adds 1st–2nd year players missing from the pool.
    """
    if roster_df.empty:
        return roster_df.copy(), {"applied": False, "teams_updated": 0, "removed_unrostered": 0, "rookies_added": 0}

    sleeper_df = sleeper_df if sleeper_df is not None else players_dataframe()
    by_gsis, by_name = _build_sleeper_lookups(sleeper_df, position)

    out = roster_df.copy()
    if "_rookie_estimate" not in out.columns:
        out["_rookie_estimate"] = False

    keep_mask: list[bool] = []
    teams_updated = 0
    removed_unrostered = 0
    matched_names: set[str] = set()
    matched_ids: set[str] = set()

    for idx, row in out.iterrows():
        sleeper_row = _lookup_sleeper_row(row, by_gsis, by_name)
        if sleeper_row is None:
            keep_mask.append(True)
            continue

        matched_names.add(str(sleeper_row["full_name"]).strip().lower())
        player_id = str(row.get("player_id") or "").strip()
        if player_id:
            matched_ids.add(player_id)

        sleeper_team = str(sleeper_row.get("team") or "").strip().upper()
        sleeper_status = str(sleeper_row.get("status") or "").strip()
        if not sleeper_team or sleeper_status in EXCLUDED_SLEEPER_STATUSES:
            keep_mask.append(False)
            removed_unrostered += 1
            continue

        from src.core.team_codes import normalize_team_to_mlready

        sleeper_team = normalize_team_to_mlready(sleeper_team)
        current_team = normalize_team_to_mlready(str(row.get("team") or "").strip().upper())
        if current_team != sleeper_team:
            out.at[idx, "team"] = sleeper_team
            teams_updated += 1
        keep_mask.append(True)

    out = out.loc[keep_mask].reset_index(drop=True)

    rookies_added = 0
    emerging_added = 0
    if (add_rookies or add_emerging) and not out.empty:
        allowed = _sleeper_positions_for(position)
        season_val = int(season or out["season"].iloc[0])
        week_val = int(target_week)
        template = out.drop(columns=["_rookie_estimate"], errors="ignore").iloc[0].copy()
        numeric = out.select_dtypes(include="number").columns
        medians = out[numeric].median(numeric_only=True)
        for col in numeric:
            template[col] = medians[col]

        extra_rows: list[pd.Series] = []
        if "years_exp" in sleeper_df.columns:
            exp = pd.to_numeric(sleeper_df["years_exp"], errors="coerce").fillna(-1)
            rookie_mask = exp == 0
            emerging_mask = exp.between(1, 2, inclusive="both")
        else:
            rookie_mask = pd.Series(False, index=sleeper_df.index)
            emerging_mask = pd.Series(False, index=sleeper_df.index)

        def _append_candidates(mask: pd.Series, *, mark_rookie: bool) -> None:
            nonlocal rookies_added, emerging_added
            candidates = sleeper_df[
                sleeper_df["position"].isin(allowed)
                & sleeper_df["team"].astype(str).str.strip().astype(bool)
                & (~sleeper_df["status"].fillna("").isin(EXCLUDED_SLEEPER_STATUSES))
                & mask
            ]
            for _, sleeper_row in candidates.iterrows():
                name_key = str(sleeper_row["full_name"]).strip().lower()
                gsis = str(sleeper_row.get("gsis_id") or "").strip()
                if name_key in matched_names:
                    continue
                if gsis and gsis in matched_ids:
                    continue
                stub = _rookie_stub_from_template(
                    template,
                    sleeper_row,
                    season=season_val,
                    target_week=week_val,
                    position=position,
                    medians=medians,
                )
                if not mark_rookie:
                    stub["_rookie_estimate"] = False
                extra_rows.append(stub)
                matched_names.add(name_key)
                if mark_rookie:
                    rookies_added += 1
                else:
                    emerging_added += 1

        if add_rookies:
            _append_candidates(rookie_mask, mark_rookie=True)
        if add_emerging:
            _append_candidates(emerging_mask, mark_rookie=False)

        if extra_rows:
            out = pd.concat([out, pd.DataFrame(extra_rows)], ignore_index=True)

    stats = {
        "applied": True,
        "teams_updated": teams_updated,
        "removed_unrostered": removed_unrostered,
        "rookies_added": rookies_added,
        "emerging_added": emerging_added,
    }
    return out, stats


def match_player_to_sleeper(
    name: str,
    team: str,
    position: str,
    sleeper_df: Optional[pd.DataFrame] = None,
) -> Optional[pd.Series]:
    sleeper_df = sleeper_df if sleeper_df is not None else players_dataframe()
    if not name:
        return None

    pos_map = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}
    pos = pos_map.get(position.upper(), position.upper())

    candidates = sleeper_df[
        (sleeper_df["team"] == team) & (sleeper_df["position"] == pos)
    ]
    exact = candidates[candidates["full_name"].str.lower() == name.lower()]
    if not exact.empty:
        return exact.iloc[0]

    last = name.split()[-1].lower() if " " in name else name.lower()
    fuzzy = candidates[candidates["last_name"].str.lower() == last]
    if len(fuzzy) == 1:
        return fuzzy.iloc[0]
    return None
