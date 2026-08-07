"""Unified commissioner file + DB overlay contract row reads."""

from __future__ import annotations

import re
from typing import Any, Literal

from src.config import OLD_LEAGUE_FILES_DIR
from src.draft_hub import storage
from src.draft_hub.contract_history_audit import _name_key
from src.draft_hub.legacy_contract_history import (
    _displayable_contract_row,
    _overlayable_contract_row,
    dedupe_contract_rows,
)
from src.draft_hub.legacy_contract_import import (
    TEAM_OWNERS,
    _is_summary_label,
    process_league_history,
    rows_for_storage,
)
from src.draft_hub.rules_engine import normalize_position

ViewMode = Literal["snapshot", "effective"]
ANALYTICS_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"]

_POS_SORT = {p: i for i, p in enumerate(ANALYTICS_POSITIONS)}
_DATE_STATUS_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def _row_team_name(league_id: str, row: dict[str, Any]) -> str:
    owner = str(row.get("owner_label") or "").strip()
    season = row.get("season_year")
    if league_id and owner and season is not None:
        mapped = storage.resolve_hub_team_name(league_id, int(season), owner)
        if mapped:
            return mapped
    return str(row.get("hub_team_name") or owner or "Unknown")


def _owner_sort_key(owner_label: str) -> tuple[int, str]:
    try:
        return (TEAM_OWNERS.index(owner_label), owner_label)
    except ValueError:
        return (len(TEAM_OWNERS), owner_label)


def _row_sort_key(row: dict[str, Any]) -> tuple[int, str]:
    pos = normalize_position(row.get("position"))
    if pos in {"DST", "D"}:
        pos = "DEF"
    return (_POS_SORT.get(pos or "", 99), str(row.get("player_name") or "").lower())


def _format_status_note(row: dict[str, Any]) -> str:
    raw = str(row.get("status_note") or "").strip()
    if str(row.get("roster_status") or "") == "cut":
        return raw or "CUT"
    if not raw:
        phase = str(row.get("contract_phase") or "").strip()
        return phase.replace("_", " ") if phase else ""
    if _DATE_STATUS_RE.match(raw):
        phase = str(row.get("contract_phase") or "").strip()
        if phase and phase != "post_2024_base":
            return phase.replace("_", " ")
        m = _DATE_STATUS_RE.match(raw)
        if m:
            yr, mo, _ = m.groups()
            months = ("", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
            mo_i = int(mo)
            label = months[mo_i] if 1 <= mo_i <= 12 else mo
            return f"Step-up · {label} '{yr[2:]}"
        return "Renewal"
    return raw


def _display_team_name(league_id: str, row: dict[str, Any], *, season_year: int) -> str:
    hub = str(row.get("hub_team_name") or "").strip()
    if hub:
        return hub
    return _row_team_name(league_id, {**row, "season_year": season_year})


def _sheet_row(
    row: dict[str, Any],
    *,
    season_year: int,
    alias_meta: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    base = {
        "player_name": row.get("player_name"),
        "position": row.get("position"),
        "prior_salary": row.get("prior_salary"),
        "cap_hit": row.get("cap_hit") or row.get("base_salary"),
        "base_salary": row.get("base_salary"),
        "roster_status": row.get("roster_status") or "active",
        "contract_phase": row.get("contract_phase"),
        "acquisition_type": row.get("acquisition_type"),
        "status": _format_status_note(row),
        "season_year": season_year,
    }
    if row.get("effective"):
        base["effective"] = True
        base["projection_source"] = row.get("projection_source")
    if alias_meta:
        from src.draft_hub.player_name_aliases import enrich_row_with_alias

        return enrich_row_with_alias(base, alias_meta)
    return base


def load_commissioner_rows_by_season() -> dict[int, list[dict[str, Any]]]:
    """Parse commissioner Excel/PDF files."""
    df = process_league_history(OLD_LEAGUE_FILES_DIR)
    if df.empty:
        return {}
    grouped = rows_for_storage(df)
    out: dict[int, list[dict[str, Any]]] = {}
    for season, rows in grouped.items():
        displayable = [r for r in rows if _displayable_contract_row({**r, "season_year": season})]
        out[int(season)] = dedupe_contract_rows(
            [{**r, "season_year": int(season)} for r in displayable]
        )
    return out


def load_database_rows_by_season(league_id: str) -> dict[int, list[dict[str, Any]]]:
    """Fallback when commissioner files are unavailable."""
    out: dict[int, list[dict[str, Any]]] = {}
    for yr in storage.list_league_contract_seasons(league_id):
        rows = storage.list_league_contract_rows(league_id, season_year=yr)
        displayable = [r for r in rows if _displayable_contract_row(r)]
        out[int(yr)] = dedupe_contract_rows(displayable)
    return out


def load_database_overlay_rows_by_season(league_id: str) -> dict[int, list[dict[str, Any]]]:
    """DB rows merged onto commissioner sheets (includes manual rows without position)."""
    out: dict[int, list[dict[str, Any]]] = {}
    for yr in storage.list_league_contract_seasons(league_id):
        rows = storage.list_league_contract_rows(league_id, season_year=yr)
        overlayable = [r for r in rows if _overlayable_contract_row(r)]
        out[int(yr)] = dedupe_contract_rows(overlayable)
    return out


def season_rows_source(league_id: str) -> tuple[dict[int, list[dict[str, Any]]], str]:
    file_rows = load_commissioner_rows_by_season()
    if file_rows:
        return file_rows, "commissioner_files"
    return load_database_rows_by_season(league_id), "database"


def _pk(name: str, alias_map: dict[str, str]) -> str:
    from src.draft_hub.player_name_aliases import resolve_player_name

    return _name_key(resolve_player_name(name, alias_map))


def _enrich_name_fields(
    row: dict[str, Any],
    alias_map: dict[str, str],
    alias_meta: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    from src.draft_hub.player_name_aliases import enrich_row_with_alias, resolve_player_name

    raw = str(row.get("player_name") or "").strip()
    canonical = resolve_player_name(raw, alias_map)
    enriched = enrich_row_with_alias(row, alias_meta or {})
    if enriched.get("name_mapped"):
        if canonical and canonical != raw and "canonical_player_name" not in enriched:
            enriched = {**enriched, "canonical_player_name": canonical}
        return enriched
    if canonical and canonical != raw:
        return {**row, "canonical_player_name": canonical, "name_mapped": True}
    return row


def _rost_eligible_row(row: dict[str, Any]) -> bool:
    return not _is_summary_label(str(row.get("player_name") or ""))


def _match_db_row(
    db_rows: list[dict[str, Any]],
    file_row: dict[str, Any],
    alias_map: dict[str, str],
) -> dict[str, Any] | None:
    pk = _pk(file_row.get("player_name") or "", alias_map)
    owner = str(file_row.get("owner_label") or "")
    status = str(file_row.get("roster_status") or "active")
    for row in db_rows:
        if str(row.get("owner_label") or "") != owner:
            continue
        if _pk(row.get("player_name") or "", alias_map) != pk:
            continue
        if str(row.get("roster_status") or "active") == status:
            return row
    for row in db_rows:
        if str(row.get("owner_label") or "") != owner:
            continue
        if _pk(row.get("player_name") or "", alias_map) == pk:
            return row
    return None


def merge_owner_roster(
    league_id: str,
    *,
    season_year: int,
    owner_label: str,
    file_rows: list[dict[str, Any]],
    db_rows: list[dict[str, Any]],
    alias_map: dict[str, str],
    alias_meta: dict[str, dict[str, Any]] | None = None,
    sheet_format: bool = True,
) -> list[dict[str, Any]]:
    """Merge commissioner file rows with DB overlays for one owner."""
    merged: list[dict[str, Any]] = []
    matched_db_ids: set[int] = set()
    for fr in file_rows:
        if str(fr.get("owner_label") or "") != owner_label:
            continue
        if not _rost_eligible_row(fr):
            continue
        db = _match_db_row(db_rows, fr, alias_map)
        if db and db.get("id"):
            matched_db_ids.add(int(db["id"]))
        if sheet_format:
            base = _sheet_row(fr, season_year=season_year, alias_meta=alias_meta)
            if db and str(db.get("roster_status") or "active") == "cut":
                base = {**base, **_sheet_row(db, season_year=season_year), "status": _format_status_note(db)}
            elif db and str(db.get("source_kind") or "") == "manual":
                db_sheet = _sheet_row(db, season_year=season_year)
                base = {
                    **base,
                    "cap_hit": db_sheet.get("cap_hit"),
                    "prior_salary": db_sheet.get("prior_salary"),
                    "base_salary": db_sheet.get("base_salary"),
                    "position": db_sheet.get("position") or base.get("position"),
                }
            row_out = _enrich_name_fields(
                {
                    **base,
                    "owner_label": owner_label,
                    "row_id": db.get("id") if db else None,
                    "source_kind": "file",
                    "db_overlay": db is not None and db.get("source_kind") == "manual",
                    "editable": True,
                },
                alias_map,
                alias_meta,
            )
        else:
            row_out = dict(fr)
            if db and str(db.get("roster_status") or "active") == "cut":
                row_out = {**row_out, **db}
            elif db and str(db.get("source_kind") or "") == "manual":
                row_out = {
                    **row_out,
                    "cap_hit": db.get("cap_hit"),
                    "prior_salary": db.get("prior_salary"),
                    "base_salary": db.get("base_salary"),
                    "position": db.get("position") or row_out.get("position"),
                    "id": db.get("id"),
                    "source_kind": "manual",
                }
            elif db:
                row_out = {**row_out, "id": db.get("id")}
            row_out["season_year"] = season_year
        merged.append(row_out)

    for dr in db_rows:
        if str(dr.get("owner_label") or "") != owner_label:
            continue
        if not _rost_eligible_row(dr):
            continue
        rid = dr.get("id")
        if rid and int(rid) in matched_db_ids:
            continue
        pk = _pk(dr.get("player_name") or "", alias_map)
        on_file = any(
            _pk(fr.get("player_name") or "", alias_map) == pk
            for fr in file_rows
            if str(fr.get("owner_label") or "") == owner_label
        )
        if on_file:
            continue
        if sheet_format:
            merged.append(_enrich_name_fields(
                {
                    **_sheet_row(dr, season_year=season_year, alias_meta=alias_meta),
                    "owner_label": owner_label,
                    "row_id": dr.get("id"),
                    "source_kind": str(dr.get("source_kind") or "manual"),
                    "db_overlay": True,
                    "editable": True,
                    "status": _format_status_note(dr),
                },
                alias_map,
                alias_meta,
            ))
        else:
            merged.append({**dr, "season_year": season_year})
    return merged


def merged_active_rows_for_ownership(
    file_rows: list[dict[str, Any]],
    db_rows: list[dict[str, Any]],
    alias_map: dict[str, str],
) -> list[dict[str, Any]]:
    """Commissioner file rows plus DB-only active rows, minus DB cut overlays."""
    active_file: list[dict[str, Any]] = []
    file_keys: set[tuple[str, str]] = set()
    for row in file_rows:
        if str(row.get("roster_status") or "active") != "active":
            continue
        owner = str(row.get("owner_label") or "").strip()
        pk = _pk(row.get("player_name") or "", alias_map)
        if not owner or not pk:
            continue
        file_keys.add((owner, pk))
        active_file.append(row)

    cuts: set[tuple[str, str]] = set()
    db_only_active: list[dict[str, Any]] = []
    for row in db_rows:
        owner = str(row.get("owner_label") or "").strip()
        pk = _pk(row.get("player_name") or "", alias_map)
        if not owner or not pk:
            continue
        status = str(row.get("roster_status") or "active")
        if status == "cut":
            cuts.add((owner, pk))
            continue
        if (owner, pk) not in file_keys:
            db_only_active.append(row)

    out: list[dict[str, Any]] = []
    for row in active_file:
        owner = str(row.get("owner_label") or "").strip()
        pk = _pk(row.get("player_name") or "", alias_map)
        if (owner, pk) not in cuts:
            out.append(row)
    out.extend(db_only_active)
    return out


def _merge_season_snapshot(
    league_id: str,
    *,
    season_year: int,
    file_rows: list[dict[str, Any]],
    db_rows: list[dict[str, Any]],
    alias_map: dict[str, str],
    alias_meta: dict[str, dict[str, Any]] | None,
    owner_label: str | None,
    sheet_format: bool,
) -> list[dict[str, Any]]:
    owners = sorted(
        {
            str(r.get("owner_label") or "")
            for r in (file_rows or db_rows)
            if r.get("owner_label")
        },
        key=_owner_sort_key,
    )
    if owner_label:
        owners = [owner_label]

    out: list[dict[str, Any]] = []
    for owner in owners:
        if not owner:
            continue
        if file_rows and db_rows:
            rows = merge_owner_roster(
                league_id,
                season_year=season_year,
                owner_label=owner,
                file_rows=file_rows,
                db_rows=db_rows,
                alias_map=alias_map,
                alias_meta=alias_meta,
                sheet_format=sheet_format,
            )
        elif file_rows:
            rows = []
            for fr in file_rows:
                if str(fr.get("owner_label") or "") != owner:
                    continue
                if not _rost_eligible_row(fr):
                    continue
                if sheet_format:
                    row_out = _sheet_row(fr, season_year=season_year, alias_meta=alias_meta)
                    row_out["owner_label"] = owner
                else:
                    row_out = {**fr, "season_year": season_year}
                rows.append(row_out)
        else:
            rows = [
                {**r, "season_year": season_year}
                for r in db_rows
                if str(r.get("owner_label") or "") == owner
            ]
            if sheet_format:
                rows = [
                    {**_sheet_row(r, season_year=season_year, alias_meta=alias_meta), "owner_label": owner}
                    for r in rows
                ]
        out.extend(rows)
    return out


def build_merged_contract_rows(
    league_id: str,
    *,
    season_year: int | None = None,
    owner_label: str | None = None,
    view: ViewMode = "snapshot",
    sheet_format: bool = False,
) -> dict[str, Any]:
    """
    Return merged contract rows by season.

    snapshot: commissioner files + DB manual overlays.
    effective: snapshot + Sleeper in-season projection (planning season only).
    """
    file_by_season, data_source = season_rows_source(league_id)
    db_overlay = load_database_overlay_rows_by_season(league_id)

    seasons = sorted(set(file_by_season.keys()) | set(db_overlay.keys()))
    if not seasons:
        db_only = load_database_rows_by_season(league_id)
        if not db_only:
            return {
                "available": False,
                "data_source": "database",
                "seasons": [],
                "rows_by_season": {},
            }
        file_by_season = db_only
        seasons = sorted(db_only.keys())
        data_source = "database"

    from src.draft_hub.player_name_aliases import alias_meta_by_name_key, load_alias_map

    alias_map = load_alias_map(league_id)
    alias_meta = alias_meta_by_name_key(league_id)

    if season_year is not None:
        target_seasons = [season_year] if season_year in seasons else [max(seasons)]
    else:
        target_seasons = seasons

    rows_by_season: dict[int, list[dict[str, Any]]] = {}
    for yr in target_seasons:
        file_rows = file_by_season.get(yr, [])
        db_rows = dedupe_contract_rows(db_overlay.get(yr, []))
        merged = _merge_season_snapshot(
            league_id,
            season_year=yr,
            file_rows=file_rows,
            db_rows=db_rows,
            alias_map=alias_map,
            alias_meta=alias_meta,
            owner_label=owner_label,
            sheet_format=sheet_format,
        )
        if view == "effective":
            from src.draft_hub.in_season_contract_projection import apply_effective_projection

            merged = apply_effective_projection(league_id, yr, merged)
        rows_by_season[yr] = merged

    return {
        "available": True,
        "data_source": data_source,
        "seasons": seasons,
        "rows_by_season": rows_by_season,
        "view": view,
    }


def list_merged_contract_rows(
    league_id: str,
    *,
    season_year: int | None = None,
    owner_label: str | None = None,
    view: ViewMode = "snapshot",
    active_only: bool = False,
) -> list[dict[str, Any]]:
    """Flat list of merged rows (analytics / contract history display)."""
    payload = build_merged_contract_rows(
        league_id,
        season_year=season_year,
        owner_label=owner_label,
        view=view,
        sheet_format=False,
    )
    if not payload.get("available"):
        return []
    rows: list[dict[str, Any]] = []
    for yr in sorted(payload["rows_by_season"].keys()):
        for row in payload["rows_by_season"][yr]:
            if active_only and str(row.get("roster_status") or "active") != "active":
                continue
            if not _displayable_contract_row(row) and str(row.get("roster_status") or "") != "cut":
                if active_only:
                    continue
                if not _rost_eligible_row(row):
                    continue
            rows.append(row)
    return rows


def active_merged_contract_rows(
    league_id: str,
    season_year: int | None = None,
    *,
    view: ViewMode = "snapshot",
) -> list[dict[str, Any]]:
    """Active displayable merged rows for one season (or all if season_year is None)."""
    if season_year is not None:
        return list_merged_contract_rows(
            league_id,
            season_year=season_year,
            view=view,
            active_only=True,
        )
    out: list[dict[str, Any]] = []
    for yr in storage.list_league_contract_seasons(league_id):
        out.extend(
            list_merged_contract_rows(
                league_id,
                season_year=yr,
                view=view,
                active_only=True,
            )
        )
    return out
