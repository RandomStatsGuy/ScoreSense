"""Compose player card payload for cross-surface deep-dive modal."""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from src.config import PROCESSED_DATA_DIR
from src.core.projection_context import resolve_projection_context
from src.draft_hub.draft_enrichment import build_player_media_batch
from src.integrations.sleeper import injured_players, players_dataframe
from src.projections.ros_cache import load_ros_prediction
from src.projections.weekly_cache import load_weekly_prediction
from src.sentiment.fantasy_readout import build_fantasy_index, build_fantasy_season_response

POSITIONS = ("qb", "rb", "wr")


def _json_safe(value: Any) -> Any:
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    return value


def _row_dict(row: pd.Series) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in row.items():
        out[str(key)] = _json_safe(value)
    return out


def _resolve_context(season: int | None, week: int | None) -> tuple[int, int]:
    path = PROCESSED_DATA_DIR / "qb_mlready.parquet"
    df = pd.read_parquet(path, columns=["season", "week"])
    return resolve_projection_context(df, season, week)


def _find_projection_row(preds: pd.DataFrame, player_id: str) -> dict[str, Any] | None:
    if preds.empty:
        return None
    pid = str(player_id)
    if "player_id" in preds.columns:
        match = preds[preds["player_id"].astype(str) == pid]
        if not match.empty:
            return _row_dict(match.iloc[0])
    if "Player" in preds.columns:
        # Fallback when player_id missing from artifact
        return None
    return None


def _guess_position(player_id: str) -> str | None:
    df = players_dataframe()
    pid = str(player_id)
    id_col = "player_id" if "player_id" in df.columns else "sleeper_id"
    if pid.isdigit():
        hit = df[df[id_col].astype(str) == pid]
        if not hit.empty:
            pos = str(hit.iloc[0].get("position") or "").upper()
            if pos in {"QB"}:
                return "qb"
            if pos in {"RB", "FB"}:
                return "rb"
            if pos in {"WR", "TE"}:
                return "wr"
    return None


def _injury_for_player(player_id: str) -> dict[str, Any] | None:
    pid = str(player_id)
    df = injured_players()
    if df.empty:
        return None
    for col in ("player_id", "sleeper_id", "gsis_id"):
        if col not in df.columns:
            continue
        hit = df[df[col].astype(str) == pid]
        if not hit.empty:
            row = hit.iloc[0]
            return {
                "injury_status": _json_safe(row.get("injury_status")),
                "injury_body_part": _json_safe(row.get("injury_body_part")),
                "team": _json_safe(row.get("team")),
                "position": _json_safe(row.get("position")),
                "full_name": _json_safe(row.get("full_name")),
            }
    return None


def _narrative_for_player(
    player_id: str,
    position: str,
    season: int,
    week: int,
    scope: str,
) -> dict[str, Any] | None:
    pos = position.lower()
    if scope == "season":
        payload = build_fantasy_season_response(pos, season, week)
        for row in payload.get("players") or []:
            if str(row.get("player_id") or "") == str(player_id):
                return row
        return None
    index = build_fantasy_index(season, week)
    return (index.get("players") or {}).get(str(player_id))


def build_player_card(
    player_id: str,
    *,
    season: int | None = None,
    week: int | None = None,
    scope: str = "weekly",
    position: str | None = None,
) -> dict[str, Any]:
    pid = str(player_id or "").strip()
    if not pid:
        raise ValueError("player_id is required")

    resolved_season, resolved_week = _resolve_context(season, week)
    scope_norm = "season" if str(scope).lower() == "season" else "weekly"

    media_batch = build_player_media_batch([{"player_id": pid}])
    media = media_batch.get(pid) or {}

    resolved_pos = (position or _guess_position(pid) or "wr").lower()
    if resolved_pos not in POSITIONS:
        resolved_pos = "wr"

    weekly_projection: dict[str, Any] | None = None
    season_projection: dict[str, Any] | None = None

    positions_to_try = [resolved_pos] + [p for p in POSITIONS if p != resolved_pos]
    for pos in positions_to_try:
        try:
            preds = load_weekly_prediction(
                pos,
                season=resolved_season,
                week=resolved_week,
                apply_injury_adjustments=True,
            )
            row = _find_projection_row(preds, pid)
            if row:
                weekly_projection = row
                resolved_pos = pos
                break
        except FileNotFoundError:
            continue

    try:
        ros = load_ros_prediction(
            resolved_pos,
            season=resolved_season,
            week=resolved_week,
            apply_injury_adjustments=True,
        )
        season_projection = _find_projection_row(ros, pid)
    except FileNotFoundError:
        season_projection = None

    narrative = _narrative_for_player(pid, resolved_pos, resolved_season, resolved_week, scope_norm)
    injury = _injury_for_player(pid)

    name = (
        weekly_projection.get("Player")
        if weekly_projection
        else season_projection.get("Player") if season_projection else None
    ) or (narrative or {}).get("player") or media.get("name")

    return {
        "player_id": pid,
        "player_name": name,
        "position": resolved_pos,
        "team": (
            (weekly_projection or {}).get("Team")
            or (season_projection or {}).get("Team")
            or (narrative or {}).get("team")
            or media.get("team")
        ),
        "media": media,
        "weekly_projection": weekly_projection,
        "season_projection": season_projection,
        "narrative": narrative,
        "injury": injury,
        "meta": {
            "season": resolved_season,
            "week": resolved_week,
            "scope": scope_norm,
        },
    }
