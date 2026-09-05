"""Orchestrate commissioner cap sheet import, movement inference, and Sleeper reconcile."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

from src.config import OLD_LEAGUE_FILES_DIR
from src.draft_hub import storage
from src.draft_hub.legacy_contract_history import import_legacy_files
from src.draft_hub.legacy_contract_import import (
    YEAR_FILES,
    process_league_history,
    rows_for_storage,
)
from src.draft_hub.legacy_contract_reconcile import (
    infer_all_season_movements,
    reconcile_movements_with_sleeper,
)
from src.draft_hub.sourced_checkpoints import (
    checkpoint_for_season,
    collect_workbook_quarantines,
    list_checkpoint_specs,
    summarize_row_quarantines,
)

_HISTORY_CACHE: tuple[str, Any] | None = None

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


def commissioner_source_seasons(data_dir: Path | None = None) -> set[int]:
    """Years that have a commissioner source file on disk — no parse."""
    base = data_dir or OLD_LEAGUE_FILES_DIR
    seasons: set[int] = set()
    if not base.exists():
        return seasons
    if (base / "2021 Fantasy Draft Results.pdf").exists():
        seasons.add(2021)
    for year, fname in YEAR_FILES.items():
        if (base / fname).exists():
            seasons.add(int(year))
    return seasons


def clear_history_cache() -> None:
    """Drop the in-process workbook cache. Tests must call this before mocks."""
    global _HISTORY_CACHE
    _HISTORY_CACHE = None


def cached_league_history(data_dir: Path | None = None):
    """Parse commissioner workbooks once per file fingerprint (office / sync only)."""
    global _HISTORY_CACHE
    base = data_dir or OLD_LEAGUE_FILES_DIR
    fp = commissioner_files_fingerprint(base)
    if _HISTORY_CACHE and _HISTORY_CACHE[0] == fp:
        return _HISTORY_CACHE[1]
    df = process_league_history(base)
    _HISTORY_CACHE = (fp, df)
    return df


def parsed_content_fingerprint(data_dir: Path | None = None) -> str:
    """Hash parsed commissioner row content."""
    df = cached_league_history(data_dir)
    if df.empty:
        return ""
    grouped = rows_for_storage(df)
    parts = [f"{season}:{len(rows)}" for season, rows in sorted(grouped.items())]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def default_snapshot_phases() -> dict[int, str]:
    """Season → phase defaults from sourced checkpoint catalog (SCORE-44)."""
    return {
        int(spec["season_year"]): str(spec["phase"])
        for spec in list_checkpoint_specs()
        if spec
    }


def commissioner_read_status(league_id: str) -> dict[str, Any]:
    """Cap-sheet freshness for GET paths — file mtimes + SQLite only. Never parses workbooks."""
    file_fp = commissioner_files_fingerprint()
    imports = storage.list_legacy_imports(league_id)
    import_by_season = {int(r["season_year"]): r for r in imports}
    file_seasons = commissioner_source_seasons()
    db_seasons = set(storage.list_league_contract_seasons(league_id))
    stored_file_fp = next(
        (str(row.get("file_fingerprint") or "") for row in imports if row.get("file_fingerprint")),
        "",
    )
    stale = False
    if file_seasons and not db_seasons and not imports:
        stale = True
    elif file_fp and stored_file_fp and stored_file_fp != file_fp:
        stale = True
    elif file_seasons:
        for yr in file_seasons:
            if yr not in import_by_season and yr not in db_seasons:
                stale = True
                break

    seasons_detail: list[dict[str, Any]] = []
    for yr in sorted(file_seasons | db_seasons):
        imp = import_by_season.get(yr)
        season_stale = bool(
            (file_fp and stored_file_fp and stored_file_fp != file_fp)
            or (yr in file_seasons and not imp)
        )
        ck = checkpoint_for_season(yr) or {}
        seasons_detail.append(
            {
                "season_year": yr,
                "in_files": yr in file_seasons,
                "in_database": yr in db_seasons,
                "last_imported_at": imp.get("imported_at") if imp else None,
                "snapshot_phase": (imp.get("snapshot_phase") if imp else None) or ck.get("phase"),
                "as_of": (imp.get("as_of") if imp else None) or ck.get("as_of"),
                "ruleset_version": (imp.get("ruleset_version") if imp else None)
                or ck.get("ruleset_version"),
                "salary_cap": (imp.get("salary_cap") if imp else None) or ck.get("salary_cap"),
                "stale": season_stale,
            }
        )

    quarantine_rows = storage.list_league_import_quarantine(league_id)
    return {
        "stale": stale,
        "file_fingerprint": file_fp,
        "content_fingerprint": stored_file_fp or None,
        "seasons": seasons_detail,
        "checkpoints": list_checkpoint_specs(),
        "quarantine_count": len(quarantine_rows),
        "has_commissioner_files": bool(file_seasons),
        "parsed": False,
    }


def commissioner_sync_status(league_id: str, *, parse: bool = True) -> dict[str, Any]:
    """Compare commissioner files to last DB import.

    GET / freshness / home must use `parse=False` (or `commissioner_read_status`).
    Office sync may parse once; the workbook frame is cached by file fingerprint.
    """
    if not parse:
        return commissioner_read_status(league_id)

    file_fp = commissioner_files_fingerprint()
    content_fp = parsed_content_fingerprint()
    imports = storage.list_legacy_imports(league_id)
    import_by_season = {int(r["season_year"]): r for r in imports}

    df = cached_league_history(OLD_LEAGUE_FILES_DIR)
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
        ck = checkpoint_for_season(yr) or {}
        seasons_detail.append(
            {
                "season_year": yr,
                "in_files": yr in file_seasons,
                "in_database": yr in db_seasons,
                "last_imported_at": imp.get("imported_at") if imp else None,
                "snapshot_phase": (imp.get("snapshot_phase") if imp else None) or ck.get("phase"),
                "as_of": (imp.get("as_of") if imp else None) or ck.get("as_of"),
                "ruleset_version": (imp.get("ruleset_version") if imp else None)
                or ck.get("ruleset_version"),
                "salary_cap": (imp.get("salary_cap") if imp else None) or ck.get("salary_cap"),
                "stale": season_stale or (yr in file_seasons and not imp),
            }
        )

    if file_seasons and not db_seasons:
        stale = True

    quarantine_rows = storage.list_league_import_quarantine(league_id)
    return {
        "stale": stale,
        "file_fingerprint": file_fp,
        "content_fingerprint": content_fp,
        "seasons": seasons_detail,
        "checkpoints": list_checkpoint_specs(),
        "quarantine_count": len(quarantine_rows),
        "has_commissioner_files": bool(file_seasons),
        "parsed": True,
    }


def sync_commissioner_sheets(
    league_id: str,
    *,
    imported_by_sub: str | None = None,
    reconcile_sleeper: bool = True,
    snapshot_phases: dict[int, str] | None = None,
    data_dir: Path | None = None,
) -> dict[str, Any]:
    """Import commissioner files as sourced checkpoints; quarantine ambiguous blocks."""
    base = data_dir or OLD_LEAGUE_FILES_DIR
    content_fp = parsed_content_fingerprint(base)
    import_result = import_legacy_files(
        league_id,
        data_dir=base,
        imported_by_sub=imported_by_sub,
        export_parquet=True,
    )

    phases = dict(default_snapshot_phases())
    if snapshot_phases:
        phases.update({int(k): str(v) for k, v in snapshot_phases.items()})

    for season in import_result.get("seasons") or []:
        yr = int(season)
        ck = checkpoint_for_season(yr) or {}
        phase = phases.get(yr, ck.get("phase") or "unknown")
        if phase not in VALID_SNAPSHOT_PHASES:
            phase = "unknown"
        storage.update_legacy_import_metadata(
            league_id,
            yr,
            snapshot_phase=str(phase),
            source_fingerprint=content_fp,
            file_fingerprint=commissioner_files_fingerprint(base),
            as_of=ck.get("as_of"),
            ruleset_version=ck.get("ruleset_version"),
            salary_cap=ck.get("salary_cap"),
        )
        if ck.get("salary_cap") is not None:
            storage.upsert_season_salary_cap(league_id, yr, float(ck["salary_cap"]))

    # Block-level quarantines + per-row quarantine inventory.
    block_hits = collect_workbook_quarantines(base)
    row_hits: list[dict[str, Any]] = []
    for yr in storage.list_league_contract_seasons(league_id):
        rows = storage.list_league_contract_rows(league_id, season_year=yr)
        summary = summarize_row_quarantines([{**r, "season_year": yr} for r in rows])
        row_hits.extend(summary.get("items") or [])
    quarantine_items = block_hits + row_hits
    storage.replace_league_import_quarantine(league_id, quarantine_items)

    movement_count = infer_all_season_movements(league_id)

    from src.draft_hub.contract_history_audit import normalize_league_cut_dead_caps

    dead_cap_fix = normalize_league_cut_dead_caps(league_id)

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
        "dead_cap_normalized": dead_cap_fix,
        "sleeper_reconcile": sleeper_results,
        "quarantine": {
            "count": len(quarantine_items),
            "block_count": len(block_hits),
            "row_count": len(row_hits),
        },
        "checkpoints": list_checkpoint_specs(),
        "sync_status": commissioner_sync_status(league_id),
    }
