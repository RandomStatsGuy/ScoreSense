"""Frozen injury / availability snapshots for SCORE-23 player-context builds.

Build jobs materialize a versioned snapshot from the on-disk Sleeper players
cache (or an optional forced refresh). Serve paths must never call this module.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.config import INJURY_SNAPSHOTS_DIR
from src.integrations.sleeper import PLAYERS_CACHE, load_sleeper_players


def _norm_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _player_availability_row(sleeper_id: str, info: dict[str, Any]) -> dict[str, Any] | None:
    """Return a compact availability row when status/practice/news exist."""
    status = _norm_str(info.get("injury_status")) or None
    practice = (
        _norm_str(info.get("practice_participation"))
        or _norm_str(info.get("practice_description"))
        or None
    )
    news_updated = info.get("news_updated")
    updated_at: str | None
    if news_updated is None or news_updated == "":
        updated_at = None
    else:
        try:
            # Sleeper news_updated is epoch ms.
            ts = float(news_updated)
            if ts > 1e12:
                ts = ts / 1000.0
            updated_at = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        except (TypeError, ValueError, OSError, OverflowError):
            updated_at = _norm_str(news_updated) or None

    if not status and not practice and not updated_at:
        return None

    gsis_id = _norm_str(info.get("gsis_id")) or None
    return {
        "sleeper_id": str(sleeper_id),
        "gsis_id": gsis_id,
        "full_name": _norm_str(info.get("full_name")) or None,
        "team": _norm_str(info.get("team")).upper() or None,
        "position": _norm_str(info.get("position")).upper() or None,
        "status": status,
        "practice": practice,
        "injury_body_part": _norm_str(info.get("injury_body_part")) or None,
        "updated_at": updated_at,
    }


def _fingerprint_rows(rows: list[dict[str, Any]]) -> str:
    payload = json.dumps(rows, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def load_players_cache_disk_only() -> dict[str, Any]:
    """Read ``sleeper_players.json`` without network refresh (build-safe)."""
    if not PLAYERS_CACHE.exists():
        return {}
    try:
        raw = json.loads(PLAYERS_CACHE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return raw if isinstance(raw, dict) else {}


def build_injury_snapshot(
    *,
    season: int,
    week: int,
    force_refresh: bool = False,
    players: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a normalized injury snapshot dict (not yet written to disk)."""
    if players is None:
        if force_refresh:
            players = load_sleeper_players(force_refresh=True)
        else:
            players = load_players_cache_disk_only()
            if not players:
                # Job fallback: allow cache-or-fetch when disk is cold.
                players = load_sleeper_players(force_refresh=False)

    rows: list[dict[str, Any]] = []
    for sleeper_id, info in (players or {}).items():
        if not isinstance(info, dict):
            continue
        row = _player_availability_row(str(sleeper_id), info)
        if row is not None:
            rows.append(row)

    rows.sort(key=lambda r: (r.get("gsis_id") or "", r.get("sleeper_id") or ""))
    digest = _fingerprint_rows(rows)
    snapshot_id = f"inj_{int(season)}w{int(week)}_{digest}"
    built_at = datetime.now(timezone.utc).isoformat()
    return {
        "injury_snapshot_id": snapshot_id,
        "season": int(season),
        "week": int(week),
        "built_at": built_at,
        "source": "sleeper_players_cache",
        "source_path": str(PLAYERS_CACHE),
        "player_count": len(rows),
        "players": rows,
    }


def save_injury_snapshot(snapshot: dict[str, Any]) -> Path:
    """Persist snapshot JSON under ``data/cache/injury_snapshots/``."""
    INJURY_SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    snapshot_id = str(snapshot["injury_snapshot_id"])
    path = INJURY_SNAPSHOTS_DIR / f"{snapshot_id}.json"
    path.write_text(json.dumps(snapshot, indent=2, default=str), encoding="utf-8")
    latest = INJURY_SNAPSHOTS_DIR / f"latest_{snapshot['season']}_w{snapshot['week']}.json"
    latest.write_text(
        json.dumps(
            {
                "injury_snapshot_id": snapshot_id,
                "path": str(path),
                "built_at": snapshot.get("built_at"),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def write_injury_snapshot(
    season: int,
    week: int,
    *,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Build + persist an injury snapshot for a season/week."""
    snapshot = build_injury_snapshot(
        season=season,
        week=week,
        force_refresh=force_refresh,
    )
    save_injury_snapshot(snapshot)
    return snapshot


def index_availability_by_player_id(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Map gsis_id and sleeper_id → availability fields for join."""
    index: dict[str, dict[str, Any]] = {}
    for row in snapshot.get("players") or []:
        avail = {
            "status": row.get("status"),
            "practice": row.get("practice"),
            "updated_at": row.get("updated_at"),
        }
        for key in ("gsis_id", "sleeper_id"):
            pid = row.get(key)
            if pid:
                index[str(pid)] = avail
    return index


def name_to_player_ids(snapshot: dict[str, Any]) -> dict[str, str]:
    """Lowercased full_name → preferred player_id (gsis, else sleeper)."""
    out: dict[str, str] = {}
    for row in snapshot.get("players") or []:
        name = _norm_str(row.get("full_name")).lower()
        if not name:
            continue
        pid = _norm_str(row.get("gsis_id")) or _norm_str(row.get("sleeper_id"))
        if pid:
            out[name] = pid
    return out
