"""Per-team salary sheets from imported commissioner cap history."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from src.draft_hub import storage
from src.draft_hub.contract_rows_merged import (
    _display_team_name,
    _owner_sort_key,
    _row_sort_key,
    build_merged_contract_rows,
    load_commissioner_rows_by_season,
    load_database_overlay_rows_by_season,
    load_database_rows_by_season,
    merge_owner_roster,
)
from src.draft_hub.historic_insights import (
    ANALYTICS_POSITIONS,
    DEFAULT_SALARY_CAP,
)
from src.draft_hub.legacy_contract_import import _is_summary_label
from src.draft_hub.rules_engine import normalize_position

# Re-export for salary_sheet_audit and tests
_load_commissioner_rows_by_season = load_commissioner_rows_by_season
_load_database_overlay_rows_by_season = load_database_overlay_rows_by_season
_load_database_rows_by_season = load_database_rows_by_season
_merge_owner_roster = merge_owner_roster

_POS_SORT = {p: i for i, p in enumerate(ANALYTICS_POSITIONS)}


def _cap_countable_row(row: dict[str, Any]) -> bool:
    return not _is_summary_label(str(row.get("player_name") or ""))


def _team_totals(
    rows: list[dict[str, Any]],
    *,
    salary_cap: float,
) -> dict[str, float]:
    committed = 0.0
    dead_cap = 0.0
    player_count = 0
    for row in rows:
        if not _cap_countable_row(row):
            continue
        sal = float(row.get("cap_hit") or row.get("base_salary") or 0)
        status = str(row.get("roster_status") or "active")
        if status in {"cut", "traded"}:
            if status == "cut":
                dead_cap += sal
        else:
            committed += sal
            player_count += 1
    unspent = max(0.0, salary_cap - committed - dead_cap)
    return {
        "committed": round(committed, 2),
        "dead_cap": round(dead_cap, 2),
        "unspent": round(unspent, 2),
        "player_count": player_count,
    }


def _cap_for_season(season_caps: dict[int, float], yr: int, default_cap: float) -> float:
    return float(season_caps.get(int(yr), default_cap))


def build_team_salary_sheets_payload(
    league_id: str,
    *,
    season_year: int | None = None,
    salary_cap: float | None = None,
    view: str = "snapshot",
) -> dict[str, Any]:
    """League salary matrix + per-owner roster sheets (commissioner workbook layout)."""
    merged_view = "effective" if view == "effective" else "snapshot"
    merged = build_merged_contract_rows(
        league_id,
        view=merged_view,
        sheet_format=True,
    )
    if not merged.get("available"):
        return {"available": False, "seasons": [], "reason": "no_imported_history"}

    data_source = merged["data_source"]
    seasons = merged["seasons"]
    rows_by_season = merged["rows_by_season"]

    league = storage.get_league(league_id) or {}
    default_cap = float(
        salary_cap
        or (league.get("rules") or {}).get("salary_cap")
        or DEFAULT_SALARY_CAP
    )
    season_caps = storage.list_season_salary_caps(league_id)
    effective_season = season_year if season_year is not None else max(seasons)
    if effective_season not in seasons:
        effective_season = max(seasons)
    prior_season = effective_season - 1 if effective_season - 1 in seasons else None
    salary_caps_by_season = {
        str(yr): _cap_for_season(season_caps, yr, default_cap) for yr in seasons
    }
    eff_cap = _cap_for_season(season_caps, effective_season, default_cap)

    season_rows: dict[int, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    owner_labels: set[str] = set()
    for yr, rows in rows_by_season.items():
        for row in rows:
            owner = str(row.get("owner_label") or "").strip()
            if not owner:
                continue
            owner_labels.add(owner)
            season_rows[yr][owner].append(row)

    ordered_owners = sorted(owner_labels, key=_owner_sort_key)

    summary_matrix: list[dict[str, Any]] = []
    for owner in ordered_owners:
        by_season: dict[str, dict[str, float]] = {}
        team_name = owner
        eff_rows = season_rows[effective_season].get(owner) or []
        if eff_rows:
            team_name = _display_team_name(league_id, eff_rows[0], season_year=effective_season)
        for yr in seasons:
            rows = season_rows.get(yr, {}).get(owner) or []
            yr_cap = _cap_for_season(season_caps, yr, default_cap)
            totals = _team_totals(rows, salary_cap=yr_cap)
            by_season[str(yr)] = totals
        summary_matrix.append(
            {
                "owner_label": owner,
                "team_name": team_name,
                "seasons": by_season,
            }
        )

    team_sheets: list[dict[str, Any]] = []
    for owner in ordered_owners:
        rows = list(season_rows[effective_season].get(owner) or [])
        rows.sort(key=_row_sort_key)
        team_name = owner
        if rows:
            team_name = _display_team_name(league_id, rows[0], season_year=effective_season)
        totals = _team_totals(rows, salary_cap=eff_cap)
        team_sheets.append(
            {
                "owner_label": owner,
                "team_name": team_name,
                "season_year": effective_season,
                "prior_season": prior_season,
                "rows": rows,
                "totals": totals,
            }
        )

    from src.draft_hub.contract_sync import commissioner_sync_status

    sync_status = commissioner_sync_status(league_id)
    imports = storage.list_legacy_imports(league_id)
    import_meta = {int(r["season_year"]): r for r in imports}

    return {
        "available": True,
        "data_source": data_source,
        "view": merged_view,
        "salary_cap": eff_cap,
        "default_salary_cap": default_cap,
        "salary_caps_by_season": salary_caps_by_season,
        "seasons": seasons,
        "season_year": effective_season,
        "prior_season": prior_season,
        "positions": list(ANALYTICS_POSITIONS),
        "summary_matrix": summary_matrix,
        "team_sheets": team_sheets,
        "sync_status": sync_status,
        "import_meta": {
            str(yr): {
                "snapshot_phase": row.get("snapshot_phase"),
                "imported_at": row.get("imported_at"),
            }
            for yr, row in import_meta.items()
        },
    }
