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
    alias_meta_by_sid: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    from src.draft_hub.player_name_aliases import enrich_row_with_alias, row_sleeper_id

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
    sid = row_sleeper_id(row)
    if sid:
        base["sleeper_player_id"] = sid
        if row.get("player_id") is not None:
            base["player_id"] = row.get("player_id")
    if row.get("effective"):
        base["effective"] = True
        base["projection_source"] = row.get("projection_source")
    if alias_meta or alias_meta_by_sid or sid:
        return enrich_row_with_alias(base, alias_meta or {}, alias_meta_by_sid)
    return base


def load_week1_rows_by_season(league_id: str) -> dict[int, list[dict[str, Any]]]:
    """Persisted Sleeper roster snapshots (week-1 preferred over pre-draft)."""
    from src.draft_hub.sleeper_week1_snapshot import PRE_DRAFT_SOURCE_KIND, SOURCE_KIND

    out: dict[int, list[dict[str, Any]]] = {}
    for yr in storage.list_league_contract_seasons(league_id):
        week1: list[dict[str, Any]] = []
        pre_draft: list[dict[str, Any]] = []
        for r in storage.list_league_contract_rows(league_id, season_year=yr):
            kind = str(r.get("source_kind") or "")
            if kind not in (SOURCE_KIND, PRE_DRAFT_SOURCE_KIND):
                continue
            keep = False
            if str(r.get("roster_status") or "") == "cut":
                if not _is_summary_label(str(r.get("player_name") or "")):
                    keep = True
            elif _displayable_contract_row(r) or (
                r.get("player_name") and r.get("position") and r.get("needs_review")
            ):
                keep = True
            if not keep:
                continue
            if kind == SOURCE_KIND:
                week1.append(r)
            else:
                pre_draft.append(r)
        chosen = week1 or pre_draft
        if chosen:
            out[int(yr)] = dedupe_contract_rows(
                [{**r, "season_year": int(yr)} for r in chosen]
            )
    return out


_COMMISSIONER_ROWS_CACHE: dict[str, Any] = {
    "key": None,
    "rows": None,
}


def _commissioner_files_cache_key() -> tuple[Any, ...]:
    base = OLD_LEAGUE_FILES_DIR
    if not base.exists():
        return ("missing",)
    parts: list[tuple[str, float, int]] = []
    for path in sorted(base.glob("*")):
        if not path.is_file():
            continue
        # Skip Excel lock files
        if path.name.startswith("~$"):
            continue
        try:
            st = path.stat()
            parts.append((path.name, st.st_mtime, st.st_size))
        except OSError:
            continue
    return tuple(parts)


def load_commissioner_rows_by_season() -> dict[int, list[dict[str, Any]]]:
    """Parse commissioner Excel/PDF files (mtime-keyed process cache)."""
    key = _commissioner_files_cache_key()
    cached = _COMMISSIONER_ROWS_CACHE.get("rows")
    if _COMMISSIONER_ROWS_CACHE.get("key") == key and cached is not None:
        return cached

    df = process_league_history(OLD_LEAGUE_FILES_DIR)
    if df.empty:
        out: dict[int, list[dict[str, Any]]] = {}
        _COMMISSIONER_ROWS_CACHE["key"] = key
        _COMMISSIONER_ROWS_CACHE["rows"] = out
        return out
    grouped = rows_for_storage(df)
    out = {}
    for season, rows in grouped.items():
        displayable = [r for r in rows if _displayable_contract_row({**r, "season_year": season})]
        out[int(season)] = dedupe_contract_rows(
            [{**r, "season_year": int(season)} for r in displayable]
        )
    _COMMISSIONER_ROWS_CACHE["key"] = key
    _COMMISSIONER_ROWS_CACHE["rows"] = out
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
    """DB rows merged onto commissioner / week-1 sheets (manual + import overlays)."""
    out: dict[int, list[dict[str, Any]]] = {}
    week1_seasons = set(load_week1_rows_by_season(league_id).keys())
    for yr in storage.list_league_contract_seasons(league_id):
        rows = storage.list_league_contract_rows(league_id, season_year=yr)
        overlayable: list[dict[str, Any]] = []
        for r in rows:
            if not _overlayable_contract_row(r):
                continue
            # When week-1 is the base, skip import actives (membership SoT is week-1).
            # Keep import cuts only if somehow not already in week-1 persist.
            if int(yr) in week1_seasons and str(r.get("source_kind") or "") == "import":
                if str(r.get("roster_status") or "active") != "cut":
                    continue
            overlayable.append(r)
        out[int(yr)] = dedupe_contract_rows(overlayable)
    return out


def season_rows_source(league_id: str) -> tuple[dict[int, list[dict[str, Any]]], str]:
    """Membership base per season: Sleeper snapshot when present, else Excel, else DB.

    Manual Historic corrections are **not** selected here — they are applied as
    overlays via ``load_database_overlay_rows_by_season`` + ``merge_owner_roster``.
    Never collapse to ``sleeper_rows or rows`` for the final sheet (SCORE-39).
    """
    from src.draft_hub.sleeper_week1_snapshot import PRE_DRAFT_SOURCE_KIND, SOURCE_KIND

    sleeper = load_week1_rows_by_season(league_id)
    file_rows = load_commissioner_rows_by_season()
    if sleeper or file_rows:
        out: dict[int, list[dict[str, Any]]] = {}
        for yr in sorted(set(sleeper.keys()) | set(file_rows.keys())):
            # Membership SoT: Sleeper when this season has a snapshot; else Excel.
            # Manuals stay in the overlay layer (see sheet_roster_sync).
            if sleeper.get(yr):
                out[yr] = sleeper[yr]
            else:
                out[yr] = file_rows[yr]
        if sleeper:
            kinds = {
                str((rows[0] or {}).get("source_kind") or "")
                for rows in sleeper.values()
                if rows
            }
            if SOURCE_KIND in kinds and PRE_DRAFT_SOURCE_KIND in kinds:
                label = "sleeper_sheets"
            elif SOURCE_KIND in kinds:
                label = "week1_sleeper"
            else:
                label = "pre_draft_sleeper"
            return out, label if not file_rows else f"{label}+commissioner_files"
        return out, "commissioner_files"
    return load_database_rows_by_season(league_id), "database"


def _pk(name: str, alias_map: dict[str, str]) -> str:
    from src.draft_hub.player_name_aliases import resolve_player_name

    return _name_key(resolve_player_name(name, alias_map))


def _enrich_name_fields(
    row: dict[str, Any],
    alias_map: dict[str, str],
    alias_meta: dict[str, dict[str, Any]] | None = None,
    alias_meta_by_sid: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    from src.draft_hub.player_name_aliases import enrich_row_with_alias, resolve_player_name

    raw = str(row.get("player_name") or "").strip()
    canonical = resolve_player_name(raw, alias_map)
    enriched = enrich_row_with_alias(row, alias_meta or {}, alias_meta_by_sid)
    if enriched.get("name_mapped"):
        if canonical and canonical != raw and "canonical_player_name" not in enriched:
            enriched = {**enriched, "canonical_player_name": canonical}
        return enriched
    if canonical and canonical != raw:
        return {**row, "canonical_player_name": canonical, "name_mapped": True}
    return row


def _collapse_key(
    row: dict[str, Any],
    alias_map: dict[str, str],
    alias_meta: dict[str, dict[str, Any]] | None = None,
) -> str:
    from src.draft_hub.player_name_aliases import row_sleeper_id, sleeper_id_for_name

    sid = row_sleeper_id(row)
    if not sid and alias_meta:
        sid = sleeper_id_for_name(str(row.get("player_name") or ""), alias_meta) or ""
    if sid:
        return f"sid:{sid}"
    return _pk(str(row.get("player_name") or ""), alias_map)


def _row_identity_keys(
    row: dict[str, Any],
    alias_map: dict[str, str],
    alias_meta: dict[str, dict[str, Any]] | None = None,
) -> set[str]:
    keys: set[str] = set()
    pk = _pk(str(row.get("player_name") or ""), alias_map)
    if pk:
        keys.add(f"pk:{pk}")
    ck = _collapse_key(row, alias_map, alias_meta)
    if ck:
        keys.add(ck)
    return keys


def _rost_eligible_row(row: dict[str, Any]) -> bool:
    return not _is_summary_label(str(row.get("player_name") or ""))


def _rank_db_overlay(row: dict[str, Any]) -> tuple[int, int, int]:
    # Prefer commissioner manual overlays, then active over cut (post-draft sheet
    # edits / re-drafts should beat a leftover CUT line), then newest id.
    kind = str(row.get("source_kind") or "")
    source_rank = (
        0
        if kind == "manual"
        else 1
        if kind in {"week1_sleeper", "pre_draft_sleeper"}
        else 2
    )
    cut_penalty = 1 if str(row.get("roster_status") or "active") == "cut" else 0
    return (source_rank, cut_penalty, -int(row.get("id") or 0))


def _db_rows_for_player(
    db_rows: list[dict[str, Any]],
    *,
    owner: str,
    file_row: dict[str, Any],
    alias_map: dict[str, str],
    alias_meta: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    file_keys = _row_identity_keys(file_row, alias_map, alias_meta)
    if not file_keys:
        return []
    return [
        row
        for row in db_rows
        if str(row.get("owner_label") or "") == owner
        and bool(_row_identity_keys(row, alias_map, alias_meta) & file_keys)
    ]


def _match_db_row(
    db_rows: list[dict[str, Any]],
    file_row: dict[str, Any],
    alias_map: dict[str, str],
    alias_meta: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    owner = str(file_row.get("owner_label") or "")
    matches = _db_rows_for_player(
        db_rows,
        owner=owner,
        file_row=file_row,
        alias_map=alias_map,
        alias_meta=alias_meta,
    )
    if not matches:
        return None
    return sorted(matches, key=_rank_db_overlay)[0]


def _collapse_rows_by_player(
    rows: list[dict[str, Any]],
    alias_map: dict[str, str],
    alias_meta: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """One sheet line per player: active beats cut; prefer higher $ / newer row_id."""
    best: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for row in rows:
        pk = _collapse_key(row, alias_map, alias_meta)
        if not pk:
            order.append(f"__anon_{len(order)}")
            best[order[-1]] = row
            continue
        prev = best.get(pk)
        if prev is None:
            best[pk] = row
            order.append(pk)
            continue
        prev_cut = 1 if str(prev.get("roster_status") or "active") == "cut" else 0
        cur_cut = 1 if str(row.get("roster_status") or "active") == "cut" else 0
        if cur_cut != prev_cut:
            if cur_cut < prev_cut:
                best[pk] = row
            continue
        prev_hit = float(prev.get("cap_hit") or prev.get("base_salary") or 0)
        cur_hit = float(row.get("cap_hit") or row.get("base_salary") or 0)
        prev_id = int(prev.get("row_id") or prev.get("id") or 0)
        cur_id = int(row.get("row_id") or row.get("id") or 0)
        if (cur_hit, cur_id) > (prev_hit, prev_id):
            best[pk] = row
    return [best[k] for k in order if k in best]


def _same_salary(a: float, b: float, *, tol: float = 0.051) -> bool:
    return abs(a - b) <= tol


def _db_row_duplicates_file_player(
    dr: dict[str, Any],
    *,
    owner_label: str,
    file_rows: list[dict[str, Any]],
    alias_map: dict[str, str],
    alias_meta: dict[str, dict[str, Any]] | None = None,
) -> bool:
    """Catch 'B. Robinson' $37 next to file 'Bijan Robinson' $37 (same last/pos/$)."""
    from src.draft_hub.player_name_match import last_name_key
    from src.draft_hub.rules_engine import normalize_position

    d_name = str(dr.get("player_name") or "")
    d_keys = _row_identity_keys(dr, alias_map, alias_meta)
    d_ln = last_name_key(d_name)
    d_pos = normalize_position(str(dr.get("position") or ""))
    d_hit = float(dr.get("cap_hit") or dr.get("base_salary") or 0)
    if not d_ln and not d_keys:
        return False
    for fr in file_rows:
        if str(fr.get("owner_label") or "") != owner_label:
            continue
        f_name = str(fr.get("player_name") or "")
        if d_keys & _row_identity_keys(fr, alias_map, alias_meta):
            return True
        if not d_ln or last_name_key(f_name) != d_ln:
            continue
        f_pos = normalize_position(str(fr.get("position") or ""))
        if d_pos and f_pos and d_pos != f_pos:
            continue
        f_hit = float(fr.get("cap_hit") or fr.get("base_salary") or 0)
        if _same_salary(d_hit, f_hit):
            return True
    return False


def _apply_manual_overlay(
    base: dict[str, Any],
    db: dict[str, Any],
    *,
    season_year: int,
    alias_meta: dict[str, dict[str, Any]] | None = None,
    alias_meta_by_sid: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Manual DB edits win over imported file fields (status, $, pos, acquisition)."""
    db_sheet = _sheet_row(
        db,
        season_year=season_year,
        alias_meta=alias_meta,
        alias_meta_by_sid=alias_meta_by_sid,
    )
    out = {
        **base,
        "cap_hit": db_sheet.get("cap_hit"),
        "prior_salary": db_sheet.get("prior_salary"),
        "base_salary": db_sheet.get("base_salary"),
        "position": db_sheet.get("position") or base.get("position"),
        "roster_status": db_sheet.get("roster_status") or base.get("roster_status") or "active",
        "status": _format_status_note(db),
    }
    # Keep Sleeper id / mapping from either side so collapse still works.
    for key in ("sleeper_player_id", "player_id", "canonical_player_name", "name_mapped"):
        if db_sheet.get(key) is not None:
            out[key] = db_sheet.get(key)
        elif base.get(key) is not None:
            out[key] = base.get(key)
    if db.get("acquisition_type") is not None:
        out["acquisition_type"] = db.get("acquisition_type")
    if db.get("contract_phase") is not None:
        out["contract_phase"] = db.get("contract_phase")
    return out


def merge_owner_roster(
    league_id: str,
    *,
    season_year: int,
    owner_label: str,
    file_rows: list[dict[str, Any]],
    db_rows: list[dict[str, Any]],
    alias_map: dict[str, str],
    alias_meta: dict[str, dict[str, Any]] | None = None,
    alias_meta_by_sid: dict[str, dict[str, Any]] | None = None,
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
        siblings = _db_rows_for_player(
            db_rows,
            owner=owner_label,
            file_row=fr,
            alias_map=alias_map,
            alias_meta=alias_meta,
        )
        for sib in siblings:
            if sib.get("id"):
                matched_db_ids.add(int(sib["id"]))
        db = sorted(siblings, key=_rank_db_overlay)[0] if siblings else None
        if sheet_format:
            base = _sheet_row(
                fr,
                season_year=season_year,
                alias_meta=alias_meta,
                alias_meta_by_sid=alias_meta_by_sid,
            )
            if db and str(db.get("source_kind") or "") == "manual":
                base = _apply_manual_overlay(
                    base,
                    db,
                    season_year=season_year,
                    alias_meta=alias_meta,
                    alias_meta_by_sid=alias_meta_by_sid,
                )
            elif db and str(db.get("roster_status") or "active") == "cut":
                cut_sheet = _sheet_row(
                    db,
                    season_year=season_year,
                    alias_meta=alias_meta,
                    alias_meta_by_sid=alias_meta_by_sid,
                )
                base = {**base, **cut_sheet, "status": _format_status_note(db)}
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
                alias_meta_by_sid,
            )
        else:
            row_out = dict(fr)
            if db and str(db.get("source_kind") or "") == "manual":
                row_out = {
                    **row_out,
                    "cap_hit": db.get("cap_hit"),
                    "prior_salary": db.get("prior_salary"),
                    "base_salary": db.get("base_salary"),
                    "position": db.get("position") or row_out.get("position"),
                    "roster_status": db.get("roster_status") or row_out.get("roster_status") or "active",
                    "acquisition_type": db.get("acquisition_type")
                    if db.get("acquisition_type") is not None
                    else row_out.get("acquisition_type"),
                    "contract_phase": db.get("contract_phase")
                    if db.get("contract_phase") is not None
                    else row_out.get("contract_phase"),
                    "status_note": db.get("status_note")
                    if db.get("status_note") is not None
                    else row_out.get("status_note"),
                    "id": db.get("id"),
                    "source_kind": "manual",
                }
            elif db and str(db.get("roster_status") or "active") == "cut":
                row_out = {**row_out, **db}
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
        dr_keys = _row_identity_keys(dr, alias_map, alias_meta)
        on_file = any(
            bool(dr_keys & _row_identity_keys(fr, alias_map, alias_meta))
            for fr in file_rows
            if str(fr.get("owner_label") or "") == owner_label
        )
        if on_file:
            continue
        if _db_row_duplicates_file_player(
            dr,
            owner_label=owner_label,
            file_rows=file_rows,
            alias_map=alias_map,
            alias_meta=alias_meta,
        ):
            if rid:
                matched_db_ids.add(int(rid))
            continue
        if sheet_format:
            merged.append(_enrich_name_fields(
                {
                    **_sheet_row(
                        dr,
                        season_year=season_year,
                        alias_meta=alias_meta,
                        alias_meta_by_sid=alias_meta_by_sid,
                    ),
                    "owner_label": owner_label,
                    "row_id": dr.get("id"),
                    "source_kind": str(dr.get("source_kind") or "manual"),
                    "db_overlay": True,
                    "editable": True,
                    "status": _format_status_note(dr),
                },
                alias_map,
                alias_meta,
                alias_meta_by_sid,
            ))
        else:
            merged.append({**dr, "season_year": season_year})
    # DB can hold both an active re-add and a leftover cut (or duplicate inserts).
    # Cap math must see one line per player.
    return _collapse_rows_by_player(merged, alias_map, alias_meta)


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
    alias_meta_by_sid: dict[str, dict[str, Any]] | None,
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
                alias_meta_by_sid=alias_meta_by_sid,
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
                    row_out = _sheet_row(
                        fr,
                        season_year=season_year,
                        alias_meta=alias_meta,
                        alias_meta_by_sid=alias_meta_by_sid,
                    )
                    row_out["owner_label"] = owner
                else:
                    row_out = {**fr, "season_year": season_year}
                rows.append(row_out)
            rows = _collapse_rows_by_player(rows, alias_map, alias_meta)
        else:
            rows = [
                {**r, "season_year": season_year}
                for r in db_rows
                if str(r.get("owner_label") or "") == owner
            ]
            if sheet_format:
                rows = [
                    {
                        **_sheet_row(
                            r,
                            season_year=season_year,
                            alias_meta=alias_meta,
                            alias_meta_by_sid=alias_meta_by_sid,
                        ),
                        "owner_label": owner,
                    }
                    for r in rows
                ]
            rows = _collapse_rows_by_player(rows, alias_map, alias_meta)
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

    from src.draft_hub.player_name_aliases import (
        alias_meta_by_name_key,
        alias_meta_by_sleeper_id,
        load_alias_map,
    )

    alias_map = load_alias_map(league_id)
    alias_meta = alias_meta_by_name_key(league_id)
    alias_meta_by_sid = alias_meta_by_sleeper_id(league_id)

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
            alias_meta_by_sid=alias_meta_by_sid,
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
