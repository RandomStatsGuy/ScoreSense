"""Orchestrate commissioner cap sheet import, movement inference, and Sleeper reconcile."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from src.config import OLD_LEAGUE_FILES_DIR
from src.draft_hub import storage
from src.draft_hub.legacy_contract_history import import_legacy_files
from src.draft_hub.legacy_contract_import import process_league_history, rows_for_storage
from src.draft_hub.legacy_contract_reconcile import (
    infer_all_season_movements,
    reconcile_movements_with_sleeper,
)

VALID_SNAPSHOT_PHASES = frozenset({
    "pre_draft",
    "post_draft",
    "midseason",
    "end_of_season",
    "unknown",
})


def commissioner_files_fingerprint(data_dir: Path | None = None) -> str:
    """Hash commissioner source files for staleness detection."""
    base = data_dir or OLD_LEAGUE_FILES_DIR
    if not base.exists():
        return ""
    parts: list[str] = []
    for path in sorted(base.rglob("*")):
        if path.is_file() and path.suffix.lower() in {".xlsx", ".xls", ".pdf", ".csv"}:
            stat = path.stat()
            parts.append(f"{path.name}:{stat.st_mtime_ns}:{stat.st_size}")
    if not parts:
        return ""
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def parsed_content_fingerprint(data_dir: Path | None = None) -> str:
    """Hash parsed commissioner row content."""
    base = data_dir or OLD_LEAGUE_FILES_DIR
    df = process_league_history(base)
    if df.empty:
        return ""
    grouped = rows_for_storage(df)
    parts = [f"{season}:{len(rows)}" for season, rows in sorted(grouped.items())]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def commissioner_sync_status(league_id: str) -> dict[str, Any]:
    """Compare commissioner files to last DB import."""
    file_fp = commissioner_files_fingerprint()
    content_fp = parsed_content_fingerprint()
    imports = storage.list_legacy_imports(league_id)
    import_by_season = {int(r["season_year"]): r for r in imports}

    df = process_league_history(OLD_LEAGUE_FILES_DIR)
    file_seasons: set[int] = set()
    if not df.empty:
        file_seasons = set(int(s) for s in rows_for_storage(df).keys())

    db_seasons = set(storage.list_league_contract_seasons(league_id))
    seasons_detail: list[dict[str, Any]] = []
    stale = False

    for yr in sorted(file_seasons | db_seasons):
        imp = import_by_season.get(yr)
        imp_fp = str(imp.get("source_fingerprint") or "") if imp else ""
        season_stale = bool(file_fp and imp_fp and imp_fp != content_fp)
        if file_seasons and yr in file_seasons and (not imp or season_stale):
            stale = True
        seasons_detail.append(
            {
                "season_year": yr,
                "in_files": yr in file_seasons,
                "in_database": yr in db_seasons,
                "last_imported_at": imp.get("imported_at") if imp else None,
                "snapshot_phase": imp.get("snapshot_phase") if imp else None,
                "stale": season_stale or (yr in file_seasons and not imp),
            }
        )

    if file_seasons and not db_seasons:
        stale = True

    return {
        "stale": stale,
        "file_fingerprint": file_fp,
        "content_fingerprint": content_fp,
        "seasons": seasons_detail,
        "has_commissioner_files": bool(file_seasons),
    }


def sync_commissioner_sheets(
    league_id: str,
    *,
    imported_by_sub: str | None = None,
    reconcile_sleeper: bool = True,
    snapshot_phases: dict[int, str] | None = None,
    data_dir: Path | None = None,
) -> dict[str, Any]:
    """Import commissioner files, infer movements, optionally reconcile Sleeper."""
    content_fp = parsed_content_fingerprint(data_dir)
    import_result = import_legacy_files(
        league_id,
        data_dir=data_dir,
        imported_by_sub=imported_by_sub,
        export_parquet=True,
    )

    phases = snapshot_phases or {}
    for season in import_result.get("seasons") or []:
        phase = phases.get(int(season), "unknown")
        if phase not in VALID_SNAPSHOT_PHASES:
            phase = "unknown"
        storage.update_legacy_import_metadata(
            league_id,
            int(season),
            snapshot_phase=phase,
            source_fingerprint=content_fp,
        )

    movement_count = infer_all_season_movements(league_id)

    sleeper_results: list[dict[str, Any]] = []
    if reconcile_sleeper:
        league = storage.get_league(league_id) or {}
        sleeper_lid = str(league.get("sleeper_league_id") or "")
        if sleeper_lid:
            for yr in storage.list_league_contract_seasons(league_id):
                if yr < 2022:
                    continue
                sleeper_results.append(
                    reconcile_movements_with_sleeper(
                        league_id,
                        sleeper_lid,
                        season_year=yr,
                    )
                )

    from src.draft_hub.insights_cache import invalidate_cap_cache

    invalidate_cap_cache(league_id)

    return {
        **import_result,
        "movements_inferred": movement_count,
        "sleeper_reconcile": sleeper_results,
        "sync_status": commissioner_sync_status(league_id),
    }
