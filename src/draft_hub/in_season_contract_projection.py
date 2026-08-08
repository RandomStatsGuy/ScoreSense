"""Apply Sleeper in-season moves on top of cap sheet snapshots."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.contract_history_audit import _name_key
from src.draft_hub.legacy_contract_import import _norm_name


def _player_key(name: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]", "", _norm_name(name).lower())


def _planning_season(league_id: str) -> int | None:
    league = storage.get_league(league_id) or {}
    season = league.get("season")
    if season is not None:
        return int(season)
    return None


def _roster_salary_by_player(league_id: str) -> dict[str, float]:
    """player_key -> salary from live hub roster."""
    try:
        overview = storage.league_roster_overview(league_id)
    except ValueError:
        return {}
    out: dict[str, float] = {}
    for block in overview.get("teams") or []:
        for row in block.get("roster") or []:
            name = str(row.get("player_name") or "")
            pk = _player_key(name)
            if pk:
                out[pk] = float(row.get("salary") or 0)
    return out


def project_effective_season(
    league_id: str,
    season_year: int,
    snapshot_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Overlay Sleeper acquisitions onto snapshot rows for the planning season."""
    planning = _planning_season(league_id)
    if planning is None or int(season_year) != planning:
        return snapshot_rows

    league = storage.get_league(league_id) or {}
    sleeper_lid = str(league.get("sleeper_league_id") or "")
    if not sleeper_lid:
        return snapshot_rows

    from src.draft_hub.sleeper_acquisition_hints import parse_sleeper_acquisitions

    acquisitions = parse_sleeper_acquisitions(
        league_id,
        sleeper_lid,
        season_year=int(season_year),
    )
    if not acquisitions:
        return snapshot_rows

    # Week-1 snapshot already includes pre-kickoff roster; only overlay in-season moves.
    from src.draft_hub.sleeper_week1_snapshot import _week1_kickoff_utc

    kickoff = _week1_kickoff_utc(int(season_year))
    filtered: list[dict[str, Any]] = []
    for ev in acquisitions:
        at = ev.get("event_at")
        if at:
            try:
                from datetime import datetime

                created = datetime.fromisoformat(str(at).replace("Z", "+00:00"))
                if created.tzinfo is None:
                    from datetime import timezone

                    created = created.replace(tzinfo=timezone.utc)
                if created < kickoff:
                    continue
            except (TypeError, ValueError):
                pass
        filtered.append(ev)
    acquisitions = filtered
    if not acquisitions:
        return snapshot_rows

    roster_salaries = _roster_salary_by_player(league_id)
    rows = [dict(r) for r in snapshot_rows]

    active_owner: dict[str, str] = {}
    row_index: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        if str(row.get("roster_status") or "active") != "active":
            continue
        pk = _player_key(str(row.get("player_name") or ""))
        owner = str(row.get("owner_label") or "")
        if pk and owner:
            active_owner[pk] = owner
            row_index[(owner, pk)] = row

    projected: list[dict[str, Any]] = []
    seen_new: set[tuple[str, str]] = set()

    for ev in acquisitions:
        pk = str(ev.get("player_key") or _player_key(str(ev.get("player_name") or "")))
        to_owner = str(ev.get("to_owner") or "")
        from_owner = str(ev.get("from_owner") or "") if ev.get("from_owner") else None
        if not pk or not to_owner:
            continue

        current = active_owner.get(pk)
        if current == to_owner:
            continue

        if from_owner and from_owner in {str(r.get("owner_label") or "") for r in rows}:
            sender_key = (from_owner, pk)
            if sender_key in row_index:
                sender = row_index[sender_key]
                if str(sender.get("roster_status") or "active") == "active":
                    traded = dict(sender)
                    traded["roster_status"] = "traded"
                    traded["effective"] = True
                    traded["projection_source"] = "sleeper"
                    traded["sleeper_transaction_id"] = ev.get("sleeper_transaction_id")
                    projected.append(traded)
                    active_owner.pop(pk, None)

        acq_type = str(ev.get("event_type") or "trade")
        salary = roster_salaries.get(pk)
        if salary is None:
            for row in rows:
                if _player_key(str(row.get("player_name") or "")) == pk:
                    salary = float(row.get("cap_hit") or row.get("base_salary") or 0)
                    break
        if salary is None:
            salary = 1.0 if acq_type in ("waiver", "post_draft_fa", "fa_contract", "free_agent") else 0.0

        new_key = (to_owner, pk)
        if new_key in seen_new:
            continue
        seen_new.add(new_key)

        new_row: dict[str, Any] = {
            "player_name": ev.get("player_name"),
            "owner_label": to_owner,
            "position": None,
            "cap_hit": round(float(salary), 2) if salary else None,
            "base_salary": round(float(salary), 2) if salary else None,
            "roster_status": "active",
            "acquisition_type": acq_type,
            "season_year": int(season_year),
            "effective": True,
            "projection_source": "sleeper",
            "sleeper_transaction_id": ev.get("sleeper_transaction_id"),
            "needs_review": salary == 0.0,
            "source_kind": "sleeper_projected",
        }
        if from_owner:
            new_row["prior_owner_label"] = from_owner
        projected.append(new_row)
        active_owner[pk] = to_owner
        row_index[new_key] = new_row

    if not projected:
        return snapshot_rows

    out = list(rows)
    for row in projected:
        if row.get("roster_status") == "traded":
            pk = _player_key(str(row.get("player_name") or ""))
            owner = str(row.get("owner_label") or "")
            if (owner, pk) in row_index:
                idx = out.index(row_index[(owner, pk)])
                out[idx] = {**out[idx], **row}
            continue
        out.append(row)
    return out


def apply_effective_projection(
    league_id: str,
    season_year: int,
    snapshot_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    league = storage.get_league(league_id) or {}
    if not league.get("draft_completed"):
        return snapshot_rows
    return project_effective_season(league_id, season_year, snapshot_rows)


def diff_effective_vs_db(
    league_id: str,
    season_year: int,
) -> dict[str, Any]:
    """Preview deltas between effective projection and DB snapshot."""
    from src.draft_hub.contract_rows_merged import list_merged_contract_rows

    snapshot = list_merged_contract_rows(
        league_id,
        season_year=season_year,
        view="snapshot",
    )
    effective = list_merged_contract_rows(
        league_id,
        season_year=season_year,
        view="effective",
    )

    def _keys(rows: list[dict[str, Any]]) -> set[tuple[str, str]]:
        out: set[tuple[str, str]] = set()
        for r in rows:
            if str(r.get("roster_status") or "active") != "active":
                continue
            pk = _player_key(str(r.get("player_name") or ""))
            owner = str(r.get("owner_label") or "")
            if pk and owner:
                out.add((owner, pk))
        return out

    snap_keys = _keys(snapshot)
    eff_keys = _keys(effective)
    added = eff_keys - snap_keys
    removed = snap_keys - eff_keys

    adds: list[dict[str, Any]] = []
    for row in effective:
        pk = _player_key(str(row.get("player_name") or ""))
        owner = str(row.get("owner_label") or "")
        if (owner, pk) in added:
            adds.append(row)

    removes: list[dict[str, Any]] = []
    for row in snapshot:
        pk = _player_key(str(row.get("player_name") or ""))
        owner = str(row.get("owner_label") or "")
        if (owner, pk) in removed:
            removes.append(row)

    return {
        "season_year": season_year,
        "add_count": len(adds),
        "remove_count": len(removes),
        "adds": adds,
        "removes": removes,
    }


def materialize_sleeper_moves(
    league_id: str,
    season_year: int,
    *,
    edited_by_sub: str = "system:sleeper",
) -> dict[str, Any]:
    """Write effective projection deltas into DB as manual rows."""
    diff = diff_effective_vs_db(league_id, season_year)
    created = 0
    updated = 0

    for row in diff.get("removes") or []:
        row_id = row.get("id") or row.get("row_id")
        if row_id:
            storage.update_league_contract_row(
                int(row_id),
                {"roster_status": "traded"},
                edited_by_sub=edited_by_sub,
                note="Materialized from Sleeper effective projection",
            )
            updated += 1

    for row in diff.get("adds") or []:
        if row.get("source_kind") == "sleeper_projected" or row.get("projection_source") == "sleeper":
            storage.insert_league_contract_row(
                league_id,
                int(season_year),
                {
                    "owner_label": row.get("owner_label"),
                    "hub_team_name": storage.resolve_hub_team_name(
                        league_id,
                        season_year,
                        str(row.get("owner_label") or ""),
                    ),
                    "player_name": row.get("player_name"),
                    "position": row.get("position"),
                    "cap_hit": row.get("cap_hit"),
                    "base_salary": row.get("base_salary") or row.get("cap_hit"),
                    "roster_status": "active",
                    "acquisition_type": row.get("acquisition_type"),
                    "source_kind": "manual",
                    "confidence": "sleeper_confirmed",
                    "needs_review": bool(row.get("needs_review")),
                    "sleeper_verified": True,
                },
            )
            created += 1

    from src.draft_hub.legacy_contract_reconcile import infer_movements_from_snapshots
    from src.draft_hub.insights_cache import invalidate_cap_cache

    events = infer_movements_from_snapshots(league_id, season_year=season_year)
    storage.replace_league_movements(league_id, season_year, events)
    invalidate_cap_cache(league_id)

    return {
        "season_year": season_year,
        "created": created,
        "updated": updated,
        "movement_count": len(events),
    }
