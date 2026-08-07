"""Audit commissioner salary sheets vs prior season, draft wins, and DB overlays."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.contract_history_audit import _name_key
from src.draft_hub.contract_rows_merged import (
    _display_team_name,
    _row_sort_key,
    load_commissioner_rows_by_season,
    load_database_overlay_rows_by_season,
    load_database_rows_by_season,
    merge_owner_roster,
    merged_active_rows_for_ownership,
)
from src.draft_hub.draft_results_import import load_draft_wins_by_season
from src.draft_hub.legacy_contract_history import dedupe_contract_rows
from src.draft_hub.legacy_contract_import import TEAM_OWNERS
from src.draft_hub.player_name_aliases import (
    alias_meta_by_name_key,
    load_alias_map,
    owner_sleeper_ids_on_sheet,
    resolve_player_name,
    sleeper_id_for_name,
)

# Backward-compatible aliases for tests and imports
_merge_owner_roster = merge_owner_roster
_load_commissioner_rows_by_season = load_commissioner_rows_by_season
_load_database_overlay_rows_by_season = load_database_overlay_rows_by_season
_load_database_rows_by_season = load_database_rows_by_season
_merged_active_rows_for_ownership = merged_active_rows_for_ownership

_REASON_LABELS = {
    "prior_roster": "Was on last year's sheet",
    "draft_win": "Won at auction (draft log)",
    "traded_to": "On another team's sheet",
    "unowned": "Not on any team's sheet",
    "db_only": "In database only (not in Excel)",
    "sleeper_only": "On Sleeper roster but not on sheet",
}


def _pk(name: str, alias_map: dict[str, str]) -> str:
    return _name_key(resolve_player_name(name, alias_map))


def _active_sheet_keys_by_owner(
    rows: list[dict[str, Any]],
    alias_map: dict[str, str],
) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {o: set() for o in TEAM_OWNERS}
    for row in rows:
        if str(row.get("roster_status") or "active") != "active":
            continue
        owner = str(row.get("owner_label") or "").strip()
        if not owner:
            continue
        out.setdefault(owner, set()).add(_pk(row.get("player_name") or "", alias_map))
    return out


def _league_active_owner_by_player(
    rows: list[dict[str, Any]],
    alias_map: dict[str, str],
) -> dict[str, str]:
    out: dict[str, str] = {}
    for row in rows:
        if str(row.get("roster_status") or "active") != "active":
            continue
        pk = _pk(row.get("player_name") or "", alias_map)
        if pk:
            out[pk] = str(row.get("owner_label") or "")
    return out


def build_salary_sheet_audit(
    league_id: str,
    *,
    season_year: int | None = None,
    owner_label: str | None = None,
) -> dict[str, Any]:
    file_by_season = load_commissioner_rows_by_season()
    db_by_season = load_database_overlay_rows_by_season(league_id)
    if file_by_season:
        data_source = "commissioner_files"
        sheet_by_season = file_by_season
    else:
        data_source = "database"
        sheet_by_season = db_by_season

    seasons = sorted(set(sheet_by_season.keys()) | set(db_by_season.keys()))
    if not seasons:
        return {
            "available": False,
            "data_source": data_source,
            "season_year": season_year,
            "prior_season": None,
            "owners": [],
            "rosters": {},
            "missing_by_owner": {},
            "missing_count": 0,
            "sleeper_only_by_owner": {},
        }
    if season_year is None or season_year not in seasons:
        season_year = max(seasons)
    prior_season = season_year - 1 if season_year - 1 in seasons else None

    file_rows = sheet_by_season.get(season_year, [])
    db_rows = dedupe_contract_rows(db_by_season.get(season_year, []))
    file_prior = sheet_by_season.get(prior_season, []) if prior_season else []

    owners_on_sheet = sorted(
        {str(r.get("owner_label") or "") for r in file_rows if r.get("owner_label")},
        key=lambda o: (TEAM_OWNERS.index(o) if o in TEAM_OWNERS else 99, o),
    )
    audit_owners = [owner_label] if owner_label else owners_on_sheet

    alias_map = load_alias_map(league_id)
    alias_meta = alias_meta_by_name_key(league_id)
    effective_active = merged_active_rows_for_ownership(file_rows, db_rows, alias_map)
    league_owners = _league_active_owner_by_player(effective_active, alias_map)
    owner_keys = _active_sheet_keys_by_owner(effective_active, alias_map)
    owner_sleeper_ids = {
        owner: owner_sleeper_ids_on_sheet(owner, effective_active, alias_meta)
        for owner in audit_owners
    }

    wins_by_season, _ = load_draft_wins_by_season()

    missing_by_owner: dict[str, list[dict[str, Any]]] = {o: [] for o in audit_owners}
    seen_missing: dict[str, set[str]] = {o: set() for o in audit_owners}
    sleeper_only_by_owner: dict[str, list[dict[str, Any]]] = {o: [] for o in audit_owners}

    def _player_on_owner_sheet(owner: str, player_name: str) -> bool:
        pk = _pk(player_name, alias_map)
        if pk in owner_keys.get(owner, set()):
            return True
        sid = sleeper_id_for_name(player_name, alias_meta)
        return bool(sid and sid in owner_sleeper_ids.get(owner, set()))

    def _add_missing(owner: str, item: dict[str, Any]) -> None:
        if owner not in missing_by_owner:
            return
        pk = _pk(item.get("player_name") or "", alias_map)
        if not pk or pk in seen_missing[owner]:
            return
        if _player_on_owner_sheet(owner, str(item.get("player_name") or "")):
            return
        seen_missing[owner].add(pk)
        missing_by_owner[owner].append(item)

    if prior_season:
        for row in file_prior:
            if str(row.get("roster_status") or "active") != "active":
                continue
            owner = str(row.get("owner_label") or "")
            if owner not in audit_owners:
                continue
            pk = _pk(row.get("player_name") or "", alias_map)
            if _player_on_owner_sheet(owner, str(row.get("player_name") or "")):
                continue
            other = league_owners.get(pk)
            if other and other != owner:
                continue
            reason = "prior_roster"
            detail = f"On {prior_season} sheet at {row.get('cap_hit')}; missing from {season_year} sheet"
            _add_missing(
                owner,
                {
                    "player_name": row.get("player_name"),
                    "position": row.get("position"),
                    "reason": reason,
                    "reason_label": _REASON_LABELS.get(reason, reason),
                    "detail": detail,
                    "prior_salary": row.get("cap_hit"),
                    "suggested_cap_hit": row.get("cap_hit"),
                    "suggested_prior_salary": row.get("cap_hit"),
                    "current_owner_label": None,
                },
            )

    for win in wins_by_season.get(season_year, []):
        owner = str(win.get("owner_label") or win.get("owner") or "").strip()
        if not owner or owner not in audit_owners:
            continue
        pk = _pk(win.get("player_name") or "", alias_map)
        if _player_on_owner_sheet(owner, str(win.get("player_name") or "")):
            continue
        other = league_owners.get(pk)
        reason = "draft_win" if not other else "traded_to"
        detail = f"Draft win ${win.get('cap_hit') or win.get('amount')}"
        if other and other != owner:
            detail = f"Draft win; currently on {other}'s sheet"
        _add_missing(
            owner,
            {
                "player_name": win.get("player_name"),
                "position": win.get("position"),
                "reason": reason,
                "reason_label": _REASON_LABELS.get(reason, reason),
                "detail": detail,
                "prior_salary": None,
                "suggested_cap_hit": win.get("cap_hit") or win.get("amount"),
                "suggested_prior_salary": None,
                "acquisition_type": "draft",
                "current_owner_label": other if other and other != owner else None,
            },
        )

    from src.draft_hub.in_season_contract_projection import diff_effective_vs_db

    eff_diff = diff_effective_vs_db(league_id, season_year)
    for row in eff_diff.get("adds") or []:
        owner = str(row.get("owner_label") or "")
        if owner not in audit_owners:
            continue
        item = {
            "player_name": row.get("player_name"),
            "position": row.get("position"),
            "reason": "sleeper_only",
            "reason_label": _REASON_LABELS["sleeper_only"],
            "detail": "Sleeper in-season move not on cap sheet snapshot",
            "suggested_cap_hit": row.get("cap_hit"),
            "acquisition_type": row.get("acquisition_type"),
        }
        sleeper_only_by_owner.setdefault(owner, []).append(item)
        _add_missing(owner, item)

    rosters: dict[str, list[dict[str, Any]]] = {}
    for owner in audit_owners:
        roster = merge_owner_roster(
            league_id,
            season_year=season_year,
            owner_label=owner,
            file_rows=file_rows,
            db_rows=db_rows,
            alias_map=alias_map,
            alias_meta=alias_meta,
            sheet_format=True,
        )
        roster.sort(key=_row_sort_key)
        team_name = owner
        sample = next((r for r in file_rows if r.get("owner_label") == owner), None)
        if sample:
            team_name = _display_team_name(league_id, sample, season_year=season_year)
        rosters[owner] = roster
        for item in missing_by_owner.get(owner, []):
            item["owner_label"] = owner
            item["team_name"] = team_name

    return {
        "available": bool(seasons),
        "data_source": data_source,
        "season_year": season_year,
        "prior_season": prior_season,
        "owners": owners_on_sheet,
        "rosters": rosters,
        "missing_by_owner": missing_by_owner,
        "missing_count": sum(len(v) for v in missing_by_owner.values()),
        "sleeper_only_by_owner": sleeper_only_by_owner,
        "sleeper_only_count": sum(len(v) for v in sleeper_only_by_owner.values()),
        "name_aliases": storage.list_player_name_aliases(league_id),
    }


def suggest_add_row(
    league_id: str,
    *,
    season_year: int,
    owner_label: str,
    player_name: str,
    missing_item: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build POST body for adding a missing player to contract history."""
    item = missing_item or {}
    hub = storage.resolve_hub_team_name(league_id, season_year, owner_label)
    return {
        "season_year": season_year,
        "owner_label": owner_label,
        "hub_team_name": hub,
        "player_name": player_name,
        "position": item.get("position"),
        "cap_hit": item.get("suggested_cap_hit"),
        "base_salary": item.get("suggested_cap_hit"),
        "prior_salary": item.get("suggested_prior_salary") or item.get("prior_salary"),
        "roster_status": "active",
        "acquisition_type": item.get("acquisition_type"),
        "source_kind": "manual",
        "confidence": "manual",
        "needs_review": False,
    }
