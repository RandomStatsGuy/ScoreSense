"""Aggregate league data freshness for Hub UI strip."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from src.draft_hub import storage
from src.draft_hub.contract_sync import commissioner_read_status
from src.draft_hub.draft_pool_cache import _artifact_paths, pool_fingerprint


def _max_iso_timestamp(values: list[str | None]) -> str | None:
    best: str | None = None
    for raw in values:
        if not raw:
            continue
        if best is None or str(raw) > str(best):
            best = str(raw)
    return best


def _draft_pool_status(season: int) -> dict[str, Any]:
    parquet_path, meta_path = _artifact_paths(season)
    fp = pool_fingerprint()
    if not parquet_path.exists() or not meta_path.exists():
        return {
            "season": season,
            "available": False,
            "built_at": None,
            "stale": True,
            "fingerprint": fp,
        }
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        meta = {}
    meta_fp = meta.get("fingerprint")
    stale = meta_fp != fp
    built_at = meta.get("built_at")
    if not built_at and parquet_path.exists():
        built_at = datetime.fromtimestamp(
            parquet_path.stat().st_mtime,
            tz=timezone.utc,
        ).isoformat()
    return {
        "season": season,
        "available": True,
        "built_at": built_at,
        "stale": stale,
        "fingerprint": fp,
        "artifact_fingerprint": meta_fp,
    }


def league_data_freshness(league_id: str, *, include_contract_detail: bool = True) -> dict[str, Any]:
    """Summarize sync timestamps for Sleeper, scoring, cap sheets, and draft pool."""
    league = storage.get_league(league_id)
    if not league:
        return {"available": False}

    teams = storage.list_league_teams(league_id)
    sleeper_synced_at = _max_iso_timestamp([t.get("sleeper_synced_at") for t in teams])

    sleeper_league_id = str(league.get("sleeper_league_id") or "").strip()
    scoring_synced_at = None
    if sleeper_league_id:
        cached = storage.get_sleeper_scoring_cache(sleeper_league_id)
        if cached:
            scoring_synced_at = cached.get("synced_at")

    planning_season = int(league.get("season") or 0)
    pool_status = _draft_pool_status(planning_season) if planning_season else {
        "available": False,
        "built_at": None,
        "stale": True,
    }

    imports = storage.list_legacy_imports(league_id)
    cap_last_imported_at = _max_iso_timestamp([r.get("imported_at") for r in imports])

    # File mtimes + SQLite only — never parse commissioner workbooks on GET.
    contract_sync = commissioner_read_status(league_id)
    computed_at = datetime.now(timezone.utc).isoformat()

    out: dict[str, Any] = {
        "available": True,
        "league_id": league_id,
        "planning_season": planning_season,
        "stale_as_of": computed_at,
        "computed_at": computed_at,
        "sleeper": {
            "synced_at": sleeper_synced_at,
            "linked": bool(sleeper_league_id),
        },
        "scoring": {
            "synced_at": scoring_synced_at,
            "linked": bool(sleeper_league_id),
        },
        "cap_sheets": {
            "stale": contract_sync.get("stale", False),
            "last_imported_at": cap_last_imported_at,
            "has_commissioner_files": contract_sync.get("has_commissioner_files", False),
        },
        "projections": {
            "built_at": pool_status.get("built_at"),
            "stale": pool_status.get("stale", False),
            "available": pool_status.get("available", False),
            "season": pool_status.get("season"),
        },
        "insights_version": storage.insights_source_version(league_id),
        **storage.league_cache_revisions(league_id),
    }

    if include_contract_detail:
        out["cap_sheets"]["seasons"] = contract_sync.get("seasons") or []
        out["cap_sheets"]["imports"] = imports

    return out
