"""Compose player card payload for cross-surface deep-dive modal."""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from src.projections.projection_meta import resolve_cached_context
from src.draft_hub.draft_enrichment import build_player_media_batch
from src.integrations.sleeper import injured_players, players_dataframe
from src.projections.ros_cache import load_ros_prediction
from src.projections.weekly_cache import load_weekly_prediction
from src.projections.player_card_history import recorded_player_history, saved_preseason_forecast
from src.sentiment.fantasy_readout import (
    build_fantasy_season_response,
    build_fantasy_weekly_response,
)

POSITIONS = ("qb", "rb", "wr")


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        num = float(value)
        if math.isnan(num) or math.isinf(num):
            return None
        return num
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, (np.bool_,)):
        return bool(value)
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(k): _sanitize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize(v) for v in value]
    return _json_safe(value)


def _row_dict(row: pd.Series) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in row.items():
        out[str(key)] = _json_safe(value)
    return out


def _resolve_context(season: int | None, week: int | None) -> tuple[int, int]:
    return resolve_cached_context("qb", season, week)


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


def _pos_from_sleeper_row(row) -> str | None:
    pos = str(row.get("position") or "").upper()
    if pos in {"QB"}:
        return "qb"
    if pos in {"RB", "FB"}:
        return "rb"
    if pos in {"WR", "TE"}:
        return "wr"
    return None


def _guess_position(player_id: str) -> str | None:
    df = players_dataframe(allow_refresh=False)
    pid = str(player_id)
    for col in ("gsis_id", "player_id", "sleeper_id"):
        if col not in df.columns:
            continue
        hit = df[df[col].astype(str) == pid]
        if not hit.empty:
            resolved = _pos_from_sleeper_row(hit.iloc[0])
            if resolved:
                return resolved
    return None


def _injury_for_player(player_id: str) -> dict[str, Any] | None:
    pid = str(player_id)
    df = injured_players(allow_refresh=False)
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
                "injury_notes": _json_safe(row.get("injury_notes")),
                "practice_participation": _json_safe(row.get("practice_participation")),
                "team": _json_safe(row.get("team")),
                "position": _json_safe(row.get("position")),
                "full_name": _json_safe(row.get("full_name")),
            }
    return None


def _narrative_meta_from_payload(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "season": payload.get("season"),
        "week": payload.get("week"),
        "requested_season": payload.get("requested_season"),
        "requested_week": payload.get("requested_week"),
        "context_fallback": bool(payload.get("context_fallback")),
        "media_context": payload.get("media_context"),
    }


def _narrative_for_player(
    player_id: str,
    position: str,
    season: int,
    week: int,
    scope: str,
    *,
    include_historical: bool = False,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    pos = position.lower()
    if scope == "season":
        payload = build_fantasy_season_response(pos, season, week, allow_generate=False)
    else:
        payload = build_fantasy_weekly_response(
            pos, season, week, include_historical=include_historical, allow_generate=False
        )
    meta = _narrative_meta_from_payload(payload)
    for row in payload.get("players") or []:
        if str(row.get("player_id") or "") == str(player_id):
            return row, meta
    return None, meta


def build_player_card(
    player_id: str,
    *,
    season: int | None = None,
    week: int | None = None,
    scope: str = "weekly",
    position: str | None = None,
    apply_injury_adjustments: bool = True,
    include_historical: bool = False,
) -> dict[str, Any]:
    pid = str(player_id or "").strip()
    if not pid:
        raise ValueError("player_id is required")

    resolved_season, resolved_week = _resolve_context(season, week)
    scope_norm = "season" if str(scope).lower() == "season" else "weekly"
    apply_injury = bool(apply_injury_adjustments)

    media_batch = build_player_media_batch([{"player_id": pid}], allow_refresh=False)
    media = media_batch.get(pid) or {}

    resolved_pos = (position or _guess_position(pid) or "wr").lower()
    if resolved_pos not in POSITIONS:
        resolved_pos = "wr"

    weekly_projection: dict[str, Any] | None = None
    season_projection: dict[str, Any] | None = None
    weekly_meta: dict[str, Any] = {}

    weekly_frame = pd.DataFrame()
    ros = pd.DataFrame()
    positions_to_try = [resolved_pos] + [p for p in POSITIONS if p != resolved_pos]
    for pos in positions_to_try:
        try:
            preds = load_weekly_prediction(
                pos,
                season=resolved_season,
                week=resolved_week,
                apply_injury_adjustments=apply_injury,
                allow_compute=False,
                allow_stale=True,
            )
            if pos == resolved_pos:
                weekly_frame = preds
            row = _find_projection_row(preds, pid)
            if row:
                weekly_frame = preds
                weekly_projection = row
                weekly_meta = dict(preds.attrs)
                resolved_pos = pos
                break
        except FileNotFoundError:
            continue

    try:
        ros = load_ros_prediction(
            resolved_pos,
            season=resolved_season,
            week=resolved_week,
            apply_injury_adjustments=apply_injury,
            allow_compute=False,
            allow_stale=True,
        )
        season_projection = _find_projection_row(ros, pid)
    except FileNotFoundError:
        season_projection = None

    narrative, narrative_meta = _narrative_for_player(
        pid,
        resolved_pos,
        resolved_season,
        resolved_week,
        scope_norm,
        include_historical=include_historical,
    )
    injury = _injury_for_player(pid)
    preseason = resolved_week <= 1
    history = recorded_player_history(pid, resolved_pos, resolved_season, resolved_week, preseason=preseason)
    preseason_forecast = saved_preseason_forecast(pid, resolved_season)
    ros_row = season_projection or {}
    rest_of_season = {
        "p10": _json_safe(ros_row.get("ROS P10")),
        "p50": _json_safe(ros_row.get("ROS P50")),
        "p90": _json_safe(ros_row.get("ROS P90")),
        "games_remaining": _json_safe(ros_row.get("Games Remaining", ros_row.get("Weeks Remaining"))),
    }

    name = (
        weekly_projection.get("Player")
        if weekly_projection
        else season_projection.get("Player") if season_projection else None
    ) or (narrative or {}).get("player") or media.get("name") or (preseason_forecast.get("preseason_projection") or {}).get("player_name")

    rebuild_kinds = [kind for kind, frame in (("weekly", weekly_frame), ("ros", ros))
                     if frame.empty or frame.attrs.get("projection_stale")]

    return _sanitize({
        "player_id": pid,
        "player_name": name,
        "position": resolved_pos,
        "team": (
            (weekly_projection or {}).get("Team")
            or (season_projection or {}).get("Team")
            or (narrative or {}).get("team")
            or media.get("team")
            or (preseason_forecast.get("preseason_projection") or {}).get("team")
        ),
        "media": media,
        "weekly_projection": weekly_projection,
        "season_projection": season_projection,
        "rest_of_season_projection": rest_of_season,
        **history,
        **preseason_forecast,
        "narrative": narrative,
        "narrative_meta": narrative_meta,
        "injury": injury,
        "meta": {
            "season": resolved_season,
            "week": resolved_week,
            "scope": scope_norm,
            "apply_injury_adjustments": apply_injury,
            "include_historical": bool(include_historical),
            "projection_built_at": {"weekly": weekly_frame.attrs.get("built_at"), "ros": ros.attrs.get("built_at")},
            "projection_stale": {"weekly": bool(weekly_frame.attrs.get("projection_stale")), "ros": bool(ros.attrs.get("projection_stale"))},
            "rebuild_kinds": rebuild_kinds,
            "preseason_mode": preseason,
            "built_at": weekly_meta.get("built_at"),
        },
    })
