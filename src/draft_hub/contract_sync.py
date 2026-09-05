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
from src.draft_hub.sourced_checkpoints import (
    checkpoint_for_season,
    collect_workbook_quarantines,
    list_checkpoint_specs,
    summarize_row_quarantines,
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


def default_snapshot_phases() -> dict[int, str]:
    """Season → phase defaults from sourced checkpoint catalog (SCORE-44)."""
    return {
        int(spec["season_year"]): str(spec["phase"])
        for spec in list_checkpoint_specs()
        if spec
    }


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
        season_stale = bool(file_seasons and file_fp and imp_fp and imp_fp != content_fp)
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
