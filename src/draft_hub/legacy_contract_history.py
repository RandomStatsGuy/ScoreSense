"""Serve imported dynasty contract history for Draft Hub."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from src.config import LEAGUE_CONTRACT_HISTORY_DIR, OLD_LEAGUE_FILES_DIR
from src.draft_hub import storage
from src.draft_hub.legacy_contract_import import (
    VALID_ROSTER_POSITIONS,
    _cell_str,
    _is_blank_name,
    _is_summary_label,
    process_league_history,
    rows_for_storage,
)
from src.draft_hub.player_name_match import is_garbage_player_name
from src.draft_hub.contract_history_audit import _name_key
from src.draft_hub.legacy_contract_reconcile import (
    infer_all_season_movements,
    reconcile_movements_with_sleeper,
)
from src.draft_hub.draft_results_import import (
    draft_source_status,
    draft_sources_meta_light,
    load_draft_wins_by_season,
)
from src.draft_hub.contract_movement_resolve import build_owner_changes_payload


def _displayable_contract_row(row: dict[str, Any]) -> bool:
    if _is_blank_name(row.get("player_name") or ""):
        return False
    if _is_summary_label(row.get("player_name") or ""):
        return False
    if is_garbage_player_name(row.get("player_name") or ""):
        return False
    pos = _cell_str(row.get("position")).upper()
    if not pos or pos in {"NAN", "NONE"} or pos not in VALID_ROSTER_POSITIONS:
        return False
    return True


def _overlayable_contract_row(row: dict[str, Any]) -> bool:
    """Manual/import DB rows usable as salary-sheet overlays (position optional)."""
    if _is_blank_name(row.get("player_name") or ""):
        return False
    if _is_summary_label(row.get("player_name") or ""):
        return False
    if is_garbage_player_name(row.get("player_name") or ""):
        return False
    if str(row.get("source_kind") or "") in {"manual", "import"}:
        return True
    return _displayable_contract_row(row)


def _dedupe_rank(row: dict[str, Any]) -> tuple:
    cap = float(row.get("cap_hit") or row.get("base_salary") or 0)
    return (
        1 if row.get("source_kind") == "manual" else 0,
        1 if str(row.get("roster_status") or "active") == "active" else 0,
        cap,
        int(row.get("id") or 0),
    )


def _dedupe_row_key(row: dict[str, Any]) -> tuple:
    pos = _cell_str(row.get("position")).upper()
    return (
        int(row.get("season_year") or 0),
        str(row.get("owner_label") or ""),
        _name_key(row.get("player_name") or ""),
        pos,
        str(row.get("roster_status") or "active"),
    )


def dedupe_contract_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse duplicate owner/player/season/status rows (keep manual, then highest cap)."""
    best: dict[tuple, dict[str, Any]] = {}
    for row in rows:
        key = _dedupe_row_key(row)
        prev = best.get(key)
        if prev is None or _dedupe_rank(row) > _dedupe_rank(prev):
            best[key] = row
    return sorted(
        best.values(),
        key=lambda r: (
            str(r.get("owner_label") or ""),
            str(r.get("player_name") or "").lower(),
            int(r.get("season_year") or 0),
        ),
    )


def build_player_contract_journey(
    league_id: str,
    player_name: str,
    *,
    editing_season: int | None = None,
    sleeper_league_id: str | None = None,
) -> dict[str, Any]:
    """Multi-season cap/owner timeline for one player (active + cut rows)."""
    key = _name_key(player_name)
    if not key:
        return {"player_name": player_name, "seasons": [], "editing_season": editing_season}
    raw_rows: list[dict[str, Any]] = []
    canonical = player_name.strip()
    for yr in storage.list_league_contract_seasons(league_id):
        for row in storage.list_league_contract_rows(league_id, season_year=yr):
            if _name_key(row.get("player_name") or "") != key:
                continue
            if not _displayable_contract_row(row) and str(row.get("roster_status") or "") != "cut":
                continue
            canonical = row.get("player_name") or canonical
            raw_rows.append({**row, "season_year": int(yr)})
    deduped = dedupe_contract_rows(raw_rows)
    seasons_out: list[dict[str, Any]] = []
    editing_row_id: int | None = None
    for row in deduped:
        yr = int(row.get("season_year") or 0)
        entry = {
            "season_year": yr,
            "row_id": row.get("id"),
            "owner_label": row.get("owner_label"),
            "hub_team_name": row.get("hub_team_name"),
            "cap_hit": row.get("cap_hit"),
            "prior_salary": row.get("prior_salary"),
            "roster_status": row.get("roster_status") or "active",
            "acquisition_type": row.get("acquisition_type"),
            "contract_phase": row.get("contract_phase"),
            "position": row.get("position"),
            "original_draft_year": row.get("original_draft_year"),
            "source_kind": row.get("source_kind"),
            "is_editing_season": editing_season is not None and yr == int(editing_season),
        }
        seasons_out.append(entry)
        if entry["is_editing_season"] and entry.get("row_id"):
            editing_row_id = int(entry["row_id"])
    seasons_out.sort(key=lambda s: (s["season_year"], s.get("roster_status") != "active"))

    from src.draft_hub.sleeper_acquisition_hints import build_player_acquisition_evidence

    evidence = build_player_acquisition_evidence(
        league_id,
        canonical,
        sleeper_league_id=sleeper_league_id,
        editing_season=editing_season,
    )

    return {
        "player_name": canonical,
        "seasons": seasons_out,
        "editing_season": editing_season,
        "editing_row_id": editing_row_id,
        "evidence": evidence.get("events") or [],
        "suggestions": evidence.get("suggestions") or [],
    }


def build_contract_history_payload(
    league_id: str,
    *,
    season_year: int | None = None,
    owner_label: str | None = None,
    all_seasons: bool = False,
    view: str = "snapshot",
) -> dict[str, Any]:
    from src.draft_hub.contract_rows_merged import list_merged_contract_rows

    storage.ensure_owner_season_map_seeded(league_id)
    seasons = storage.list_league_contract_seasons(league_id)
    effective_season = season_year
    if effective_season is None and not all_seasons and seasons:
        effective_season = max(seasons)

    if all_seasons:
        rows: list[dict[str, Any]] = []
        for yr in seasons:
            rows.extend(
                list_merged_contract_rows(
                    league_id,
                    season_year=yr,
                    owner_label=owner_label,
                    view=view,
                )
            )
    else:
        rows = list_merged_contract_rows(
            league_id,
            season_year=effective_season,
            owner_label=owner_label,
            view=view,
        )

    from src.draft_hub.legacy_contract_history import _displayable_contract_row

    rows = [r for r in rows if _displayable_contract_row(r)]
    rows = dedupe_contract_rows(rows)
    movements = storage.list_league_movements(
        league_id,
        season_year=None if all_seasons else effective_season,
    )
    owners = sorted({r["owner_label"] for r in rows})
    review_count = sum(1 for r in rows if r.get("needs_review"))
    owner_map_rows = storage.list_owner_season_map(
        league_id,
        season_year=None if all_seasons else effective_season,
    )
    draft_meta = draft_sources_meta_light()
    owner_changes = build_owner_changes_payload(
        movements,
        season_year=effective_season if not all_seasons else None,
    )
    return {
        "available": bool(rows),
        "seasons": seasons,
        "season_year": effective_season if not all_seasons else season_year,
        "all_seasons": all_seasons,
        "owners": owners,
        "row_count": len(rows),
        "needs_review_count": review_count,
        "rows": rows,
        "movements": movements,
        "owner_changes": owner_changes,
        "owner_season_map": owner_map_rows,
        "draft_sources": draft_source_status(draft_meta),
        "draft_wins_loaded": int(draft_meta.get("total_wins") or 0),
    }


def import_legacy_files(
    league_id: str,
    *,
    data_dir: Path | None = None,
    imported_by_sub: str | None = None,
    export_parquet: bool = True,
) -> dict[str, Any]:
    """Parse commissioner files and persist per-season contract snapshots."""
    base = data_dir or OLD_LEAGUE_FILES_DIR
    df = process_league_history(base)
    if df.empty:
        return {"imported": 0, "seasons": [], "reason": "no_rows_parsed"}

    grouped = rows_for_storage(df)
    total = 0
    seasons: list[int] = []
    for season, rows in sorted(grouped.items()):
        for r in rows:
            mapped = storage.resolve_hub_team_name(league_id, season, r["owner_label"])
            if mapped:
                r["hub_team_name"] = mapped
        season_rows = [{**r, "season_year": season} for r in rows]
        deduped = dedupe_contract_rows(season_rows)
        import_id = storage.record_legacy_import(
            league_id,
            season,
            source_kind="xlsx_pdf",
            source_path=str(base),
            imported_by_sub=imported_by_sub,
            row_count=len(deduped),
        )
        total += storage.replace_league_contract_season(
            league_id,
            season,
            deduped,
            import_id=import_id,
        )
        seasons.append(season)

    movement_count = infer_all_season_movements(league_id)

    from src.draft_hub.insights_cache import invalidate_cap_cache

    invalidate_cap_cache(league_id)

    _, draft_meta = load_draft_wins_by_season(base)
    draft_tagged = int((df["acquisition_type"] == "draft").sum()) if not df.empty else 0

    parquet_path = None
    if export_parquet:
        LEAGUE_CONTRACT_HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        parquet_path = LEAGUE_CONTRACT_HISTORY_DIR / f"{league_id}_contracts.parquet"
        df.to_parquet(parquet_path, index=False)

    return {
        "imported": total,
        "seasons": seasons,
        "movements_inferred": movement_count,
        "draft_tags_applied": draft_tagged,
        "draft_sources": draft_source_status(draft_meta),
        "parquet_path": str(parquet_path) if parquet_path else None,
    }


def reconcile_league_with_sleeper(
    league_id: str,
    sleeper_league_id: str,
) -> dict[str, Any]:
    seasons = storage.list_league_contract_seasons(league_id)
    results = []
    for yr in seasons:
        if yr < 2022:
            continue
        results.append(
            reconcile_movements_with_sleeper(league_id, sleeper_league_id, season_year=yr)
        )
    return {"seasons": seasons, "reconcile": results}
