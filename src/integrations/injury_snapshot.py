"""Frozen injury / availability snapshots for SCORE-23 player-context builds.

Build jobs materialize a versioned snapshot from the on-disk Sleeper players
cache (or an optional forced refresh). Serve paths must never call this module.

SCORE-31: material team diffs ignore punctuation-only note noise and
``updated_at`` bumps so overlay recompute stays team-scoped.
"""

from __future__ import annotations

import hashlib
import json
import re
import string
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.config import INJURY_SNAPSHOTS_DIR
from src.integrations.sleeper import PLAYERS_CACHE, load_sleeper_players

# Strip punctuation / collapse whitespace for note equality (SCORE-31).
_NOTE_PUNCT_RE = re.compile(
    f"[{re.escape(string.punctuation)}]+"
    r"|[\u2010-\u2015\u2212\u00b7\u2022\u2026]"
)
_NOTE_SPACE_RE = re.compile(r"\s+")


def _norm_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_injury_note(value: Any) -> str:
    """Normalize injury note text so punctuation-only edits compare equal."""
    text = _norm_str(value).lower()
    if not text:
        return ""
    text = _NOTE_PUNCT_RE.sub(" ", text)
    text = _NOTE_SPACE_RE.sub(" ", text).strip()
    return text


def material_player_state(row: dict[str, Any]) -> tuple[Any, ...]:
    """Material availability key used for team-scoped overlay diffs.

    Excludes ``updated_at`` (timestamp-only noise) and uses normalized notes so
    punctuation-only edits do not trigger recompute.
    """
    pid = _norm_str(row.get("gsis_id")) or _norm_str(row.get("sleeper_id"))
    return (
        pid,
        _norm_str(row.get("team")).upper(),
        _norm_str(row.get("position")).upper(),
        _norm_str(row.get("status")).lower(),
        _norm_str(row.get("practice")).lower(),
        _norm_str(row.get("injury_body_part")).lower(),
        normalize_injury_note(row.get("injury_notes") or row.get("injury_note")),
    )


def _fingerprint_material_rows(rows: list[dict[str, Any]]) -> str:
    """Fingerprint material state only (stable vs note punctuation / updated_at)."""
    material = [list(material_player_state(r)) for r in rows]
    material.sort(key=lambda item: (item[0], item[1], item[2]))
    payload = json.dumps(material, sort_keys=False, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def team_material_states(snapshot: dict[str, Any] | None) -> dict[str, set[tuple[Any, ...]]]:
    """Map team → set of material player states for that team."""
    out: dict[str, set[tuple[Any, ...]]] = {}
    if not snapshot:
        return out
    for row in snapshot.get("players") or []:
        team = _norm_str(row.get("team")).upper()
        if not team:
            continue
        out.setdefault(team, set()).add(material_player_state(row))
    return out


def diff_injury_snapshots(
    previous: dict[str, Any] | None,
    current: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return teams whose *material* injury state changed (SCORE-31).

    Punctuation-only note edits and ``updated_at`` bumps alone do not count.
    """
    prev_teams = team_material_states(previous)
    curr_teams = team_material_states(current)
    all_teams = set(prev_teams) | set(curr_teams)
    changed: list[str] = []
    unchanged: list[str] = []
    for team in sorted(all_teams):
        if prev_teams.get(team, set()) != curr_teams.get(team, set()):
            changed.append(team)
        else:
            unchanged.append(team)
    return {
        "changed_teams": changed,
        "unchanged_teams": unchanged,
        "material_change": bool(changed),
        "previous_snapshot_id": (previous or {}).get("injury_snapshot_id"),
        "current_snapshot_id": (current or {}).get("injury_snapshot_id"),
    }


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

    injury_notes = (
        _norm_str(info.get("injury_notes"))
        or _norm_str(info.get("injury_note"))
        or None
    )

    if not status and not practice and not updated_at and not injury_notes:
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
        "injury_notes": injury_notes,
        "updated_at": updated_at,
    }


def _fingerprint_rows(rows: list[dict[str, Any]]) -> str:
    """Snapshot id digest from material state (SCORE-31 stable fingerprint)."""
    return _fingerprint_material_rows(rows)


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


def load_injury_snapshot(
    season: int,
    week: int,
    *,
    snapshot_id: str | None = None,
) -> dict[str, Any] | None:
    """Load a persisted injury snapshot (by id or latest pointer)."""
    INJURY_SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    path: Path | None = None
    if snapshot_id:
        path = INJURY_SNAPSHOTS_DIR / f"{snapshot_id}.json"
    else:
        latest = INJURY_SNAPSHOTS_DIR / f"latest_{int(season)}_w{int(week)}.json"
        if latest.exists():
            try:
                pointer = json.loads(latest.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pointer = {}
            sid = pointer.get("injury_snapshot_id")
            if sid:
                path = INJURY_SNAPSHOTS_DIR / f"{sid}.json"
            elif pointer.get("path"):
                path = Path(str(pointer["path"]))
    if path is None or not path.exists():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return raw if isinstance(raw, dict) else None


def injured_players_from_disk() -> "pd.DataFrame":
    """Serve-only injured roster from on-disk Sleeper cache (never networks).

    SCORE-33: browsers / ``GET /api/injuries`` must not trigger Sleeper polling.
    """
    import pandas as pd

    from src.integrations.sleeper import INJURY_STATUSES

    raw = load_players_cache_disk_only()
    rows: list[dict[str, Any]] = []
    for sleeper_id, info in (raw or {}).items():
        if not isinstance(info, dict):
            continue
        status = _norm_str(info.get("injury_status"))
        if status not in INJURY_STATUSES:
            continue
        team = _norm_str(info.get("team")).upper()
        if not team:
            continue
        rows.append(
            {
                "sleeper_id": str(sleeper_id),
                "full_name": _norm_str(info.get("full_name")) or "",
                "first_name": _norm_str(info.get("first_name")) or "",
                "last_name": _norm_str(info.get("last_name")) or "",
                "team": team,
                "position": _norm_str(info.get("position")).upper() or "",
                "injury_status": status,
                "injury_body_part": _norm_str(info.get("injury_body_part")) or "",
                "injury_notes": _norm_str(info.get("injury_notes")) or "",
                "injury_start_date": info.get("injury_start_date"),
                "practice_participation": _norm_str(info.get("practice_participation"))
                or "",
                "practice_description": _norm_str(info.get("practice_description")) or "",
                "news_updated": info.get("news_updated"),
                "status": _norm_str(info.get("status")) or "",
                "gsis_id": _norm_str(info.get("gsis_id")) or "",
                "espn_id": _norm_str(info.get("espn_id")) or "",
            }
        )
    if not rows:
        return pd.DataFrame(
            columns=[
                "sleeper_id",
                "full_name",
                "first_name",
                "last_name",
                "team",
                "position",
                "injury_status",
                "injury_body_part",
                "injury_notes",
                "injury_start_date",
                "practice_participation",
                "practice_description",
                "news_updated",
                "status",
                "gsis_id",
                "espn_id",
            ]
        )
    return (
        pd.DataFrame(rows)
        .sort_values(["team", "position", "full_name"])
        .reset_index(drop=True)
    )


def injured_frame_from_snapshot(snapshot: dict[str, Any] | None) -> "pd.DataFrame":
    """Build an ``injured_players``-compatible frame from a frozen snapshot."""
    import pandas as pd

    from src.integrations.sleeper import INJURY_STATUSES

    rows: list[dict[str, Any]] = []
    for row in (snapshot or {}).get("players") or []:
        status = _norm_str(row.get("status"))
        if status not in INJURY_STATUSES:
            continue
        team = _norm_str(row.get("team")).upper()
        if not team:
            continue
        rows.append(
            {
                "full_name": _norm_str(row.get("full_name")) or "",
                "team": team,
                "position": _norm_str(row.get("position")).upper() or "",
                "injury_status": status,
                "gsis_id": _norm_str(row.get("gsis_id")) or None,
                "sleeper_id": _norm_str(row.get("sleeper_id")) or None,
                "injury_notes": _norm_str(row.get("injury_notes")) or "",
            }
        )
    if not rows:
        return pd.DataFrame(
            columns=[
                "full_name",
                "team",
                "position",
                "injury_status",
                "gsis_id",
                "sleeper_id",
                "injury_notes",
            ]
        )
    return pd.DataFrame(rows)


def index_availability_by_player_id(snapshot: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Map gsis_id and sleeper_id → availability fields for join."""
    index: dict[str, dict[str, Any]] = {}
    for row in snapshot.get("players") or []:
        avail = {
            "status": row.get("status"),
            "practice": row.get("practice"),
            "injury_notes": row.get("injury_notes"),
            "injury_body_part": row.get("injury_body_part"),
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
