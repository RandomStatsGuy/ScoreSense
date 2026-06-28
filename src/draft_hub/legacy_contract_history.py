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
    process_league_history,
    rows_for_storage,
)
from src.draft_hub.player_name_match import is_garbage_player_name
from src.draft_hub.legacy_contract_reconcile import (
    infer_all_season_movements,
    reconcile_movements_with_sleeper,
)


def _displayable_contract_row(row: dict[str, Any]) -> bool:
    if _is_blank_name(row.get("player_name") or ""):
        return False
    if is_garbage_player_name(row.get("player_name") or ""):
        return False
    pos = _cell_str(row.get("position")).upper()
    if not pos or pos in {"NAN", "NONE"} or pos not in VALID_ROSTER_POSITIONS:
        return False
    return True


def build_contract_history_payload(
    league_id: str,
    *,
    season_year: int | None = None,
    owner_label: str | None = None,
) -> dict[str, Any]:
    seasons = storage.list_league_contract_seasons(league_id)
    rows = storage.list_league_contract_rows(
        league_id,
        season_year=season_year,
        owner_label=owner_label,
    )
    rows = [r for r in rows if _displayable_contract_row(r)]
    movements = storage.list_league_movements(league_id, season_year=season_year)
    owners = sorted({r["owner_label"] for r in rows})
    review_count = sum(1 for r in rows if r.get("needs_review"))
    return {
        "available": bool(rows),
        "seasons": seasons,
        "season_year": season_year,
        "owners": owners,
        "row_count": len(rows),
        "needs_review_count": review_count,
        "rows": rows,
        "movements": movements,
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
        import_id = storage.record_legacy_import(
            league_id,
            season,
            source_kind="xlsx_pdf",
            source_path=str(base),
            imported_by_sub=imported_by_sub,
            row_count=len(rows),
        )
        total += storage.replace_league_contract_season(
            league_id,
            season,
            rows,
            import_id=import_id,
        )
        seasons.append(season)

    movement_count = infer_all_season_movements(league_id)

    parquet_path = None
    if export_parquet:
        LEAGUE_CONTRACT_HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        parquet_path = LEAGUE_CONTRACT_HISTORY_DIR / f"{league_id}_contracts.parquet"
        df.to_parquet(parquet_path, index=False)

    return {
        "imported": total,
        "seasons": seasons,
        "movements_inferred": movement_count,
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
