"""SCORE-45: single write path for live/historic contract mutations.

All edits, extensions, cuts, trades, draft-complete ticks, and Historic forward
applies should go through this module so live revision, audit, archive, and
cache invalidation stay consistent.

Expired deals are **archived** (status + as_of + snapshot) instead of deleted,
so draft reset can restore them losslessly.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from src.draft_hub import storage
from src.draft_hub.acquisition_semantics import is_current_auction_award
from src.draft_hub.contract_typing import (
    advance_roster_contracts_for_draft_complete,
    rewind_roster_contracts_after_draft_reset,
)
from src.draft_hub.contracts import (
    apply_or_queue_extension,
    build_contract_from_roster_edit,
)
from src.draft_hub.pre_draft_cap import (
    ROSTER_ACTIVE,
    ROSTER_CUT_BEFORE_DRAFT,
    ROSTER_EXPIRED,
    contract_on_cut_status_change,
)
from src.draft_hub.schemas import LeagueRules

WriteOp = Literal[
    "edit",
    "extension",
    "cut",
    "trade_transfer",
    "trade_drop",
    "tick",
    "unarchive",
    "historic_forward",
    "award",
]

ARCHIVE_REASON_TICK = "draft_complete_year_tick"


def _utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _slot_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    """Serializable roster slot for archive / draft-complete snapshots."""
    return {
        "player_id": row.get("player_id"),
        "player_name": row.get("player_name"),
        "team": row.get("team"),
        "position": row.get("position"),
        "salary": row.get("salary"),
        "contract_years": row.get("contract_years"),
        "sleeper_player_id": row.get("sleeper_player_id"),
        "source": row.get("source"),
        "roster_status": row.get("roster_status") or ROSTER_ACTIVE,
        "team_id": row.get("team_id"),
        "contract": dict(row.get("contract") or {}),
    }


def is_archived_expired(row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    if str(row.get("roster_status") or "") != ROSTER_EXPIRED:
        return False
    archive = (row.get("contract") or {}).get("archive")
    return isinstance(archive, dict) and bool(archive.get("snapshot"))


def build_archive_contract(
    row: dict[str, Any],
    *,
    as_of: str | None = None,
    reason: str = ARCHIVE_REASON_TICK,
    season: int | None = None,
) -> dict[str, Any]:
    """Contract JSON for an expired row: years=0 + archive metadata + snapshot."""
    prior = dict(row.get("contract") or {})
    prior.pop("archive", None)
    snapshot = {
        "salary": row.get("salary"),
        "contract_years": row.get("contract_years"),
        "source": row.get("source"),
        "team_id": row.get("team_id"),
        "player_name": row.get("player_name"),
        "team": row.get("team"),
        "position": row.get("position"),
        "sleeper_player_id": row.get("sleeper_player_id"),
        "contract": prior,
    }
    return {
        **prior,
        "years_remaining": 0,
        "current_salary": float(prior.get("current_salary") or prior.get("base_salary") or row.get("salary") or 0),
        "archive": {
            "as_of": as_of or _utcnow(),
            "reason": reason,
            "season": season,
            "snapshot": snapshot,
        },
    }


def restore_from_archive(row: dict[str, Any]) -> dict[str, Any]:
    """Rebuild an active roster payload from an archived expired row."""
    if not is_archived_expired(row):
        raise ValueError("Roster row is not an archived expired contract")
    archive = (row.get("contract") or {})["archive"]
    snap = dict(archive.get("snapshot") or {})
    contract = dict(snap.get("contract") or {})
    contract.pop("archive", None)
    return {
        "player_id": row.get("player_id"),
        "player_name": snap.get("player_name") or row.get("player_name"),
        "team": snap.get("team") or row.get("team"),
        "position": snap.get("position") or row.get("position") or "FLEX",
        "salary": float(snap.get("salary") or contract.get("current_salary") or 1),
        "contract_years": int(
            snap.get("contract_years")
            or contract.get("years_remaining")
            or 1
        ),
        "sleeper_player_id": snap.get("sleeper_player_id") or row.get("sleeper_player_id"),
        "source": snap.get("source") or row.get("source") or "sheet",
        "roster_status": ROSTER_ACTIVE,
        "team_id": snap.get("team_id") or row.get("team_id"),
        "contract": contract,
    }


def _flatten_league_roster(league_id: str, league: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    ws_id = storage.roster_workspace_for_league(league)
    by_team = storage.list_league_rosters_by_team(league_id)
    roster: list[dict[str, Any]] = []
    for rows in by_team.values():
        roster.extend(rows)
    if not roster and ws_id:
        roster = storage.list_roster(ws_id)
    return ws_id, roster


def list_archived_contracts(league_id: str) -> list[dict[str, Any]]:
    """Expired archive rows for a league (status + as_of + snapshot)."""
    league = storage.get_league(league_id)
    if not league:
        return []
    _, roster = _flatten_league_roster(league_id, league)
    out: list[dict[str, Any]] = []
    for row in roster:
        if str(row.get("roster_status") or "") != ROSTER_EXPIRED:
            continue
        archive = (row.get("contract") or {}).get("archive") or {}
        out.append(
            {
                "player_id": row.get("player_id"),
                "player_name": row.get("player_name"),
                "team_id": row.get("team_id"),
                "position": row.get("position"),
                "roster_status": ROSTER_EXPIRED,
                "as_of": archive.get("as_of"),
                "reason": archive.get("reason"),
                "season": archive.get("season"),
                "snapshot": archive.get("snapshot"),
                "live_roster_revision": None,
            }
        )
    revs = storage.league_cache_revisions(league_id)
    for item in out:
        item["live_roster_revision"] = revs.get("live_roster_revision")
    return out


# ---------------------------------------------------------------------------
# Write operations
# ---------------------------------------------------------------------------


def apply_roster_edit(
    league_id: str | None,
    workspace_id: str,
    player_id: str,
    *,
    contract: dict[str, Any] | None = None,
    roster_status: str | None = None,
    team_id: str | None = None,
    any_team: bool = False,
    edited_by_sub: str | None = None,
    note: str | None = None,
    op: WriteOp = "edit",
) -> dict[str, Any]:
    """Update a live roster contract through the single write path."""
    _ = (league_id, op)  # league_id reserved for future audit fan-out
    return storage.update_roster_slot(
        workspace_id,
        player_id,
        team_id=team_id,
        contract=contract,
        roster_status=roster_status,
        any_team=any_team,
        edited_by_sub=edited_by_sub,
        note=note,
    )


def apply_extension(
    league_id: str,
    workspace_id: str,
    row: dict[str, Any],
    rules: LeagueRules,
    *,
    extension_years: int,
    start_salary: float,
    draft_completed: bool,
    edited_by_sub: str | None = None,
) -> dict[str, Any]:
    """Queue or apply a rookie/post-rookie extension (SCORE-37 pending semantics)."""
    contract = apply_or_queue_extension(
        row,
        rules,
        extension_years=extension_years,
        start_salary=start_salary,
        draft_completed=draft_completed,
    )
    return apply_roster_edit(
        league_id,
        workspace_id,
        str(row["player_id"]),
        contract=contract,
        any_team=True,
        edited_by_sub=edited_by_sub,
        op="extension",
    )


def apply_cut(
    league_id: str,
    workspace_id: str,
    player_id: str,
    *,
    team_id: str | None = None,
    existing: dict[str, Any] | None = None,
    edited_by_sub: str | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    """Mark a player cut_before_draft with dead-cap years on the contract."""
    slot = existing or storage.get_roster_slot(workspace_id, player_id)
    if not slot:
        raise ValueError("Player not on roster")
    contract = contract_on_cut_status_change(slot, roster_status=ROSTER_CUT_BEFORE_DRAFT)
    return apply_roster_edit(
        league_id,
        workspace_id,
        player_id,
        contract=contract,
        roster_status=ROSTER_CUT_BEFORE_DRAFT,
        team_id=team_id or slot.get("team_id"),
        any_team=True,
        edited_by_sub=edited_by_sub,
        note=note,
        op="cut",
    )


def apply_trade_transfer(
    league_id: str,
    workspace_id: str,
    player_ids: list[str],
    from_team_id: str,
    to_team_id: str,
) -> int:
    """Move players between teams (trade send)."""
    _ = league_id
    return storage.transfer_roster_players(workspace_id, player_ids, from_team_id, to_team_id)


def apply_trade_drop(
    league_id: str,
    workspace_id: str,
    player_id: str,
    *,
    from_team_id: str,
    assignee_team_id: str,
) -> dict[str, Any]:
    """Trade drop: optional transfer then cut via the contract service."""
    slot = storage.get_roster_slot(workspace_id, player_id)
    if not slot or str(slot.get("team_id")) != str(from_team_id):
        raise ValueError(f"Drop {player_id} not on expected team")
    if str(assignee_team_id) != str(from_team_id):
        apply_trade_transfer(
            league_id, workspace_id, [player_id], from_team_id, assignee_team_id
        )
        slot = storage.get_roster_slot(workspace_id, player_id) or slot
    return apply_cut(
        league_id,
        workspace_id,
        player_id,
        team_id=assignee_team_id,
        existing=slot,
    )


def apply_historic_forward_salary(
    league_id: str,
    workspace_id: str,
    existing: dict[str, Any],
    *,
    new_salary: float,
    edited_by_sub: str,
    reason: str,
) -> dict[str, Any]:
    """Apply a Historic correction forward into the live planning roster."""
    league = storage.get_league(league_id) or {}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    yrs = int(existing.get("contract_years") or 1)
    contract = build_contract_from_roster_edit(
        rules,
        current_salary=float(new_salary),
        years_remaining=yrs,
        existing=existing.get("contract"),
        step_up=float(rules.contracts.extension_step_up),
    )
    return apply_roster_edit(
        league_id,
        workspace_id,
        str(existing["player_id"]),
        team_id=str(existing.get("team_id") or ""),
        contract=contract,
        any_team=True,
        edited_by_sub=edited_by_sub,
        note=reason,
        op="historic_forward",
    )


def archive_expired_slot(
    league_id: str,
    workspace_id: str,
    row: dict[str, Any],
    *,
    season: int | None = None,
    as_of: str | None = None,
    reason: str = ARCHIVE_REASON_TICK,
) -> dict[str, Any]:
    """Archive an expired contract in place (no delete)."""
    contract = build_archive_contract(row, as_of=as_of, reason=reason, season=season)
    return storage.update_roster_slot(
        workspace_id,
        str(row["player_id"]),
        contract=contract,
        roster_status=ROSTER_EXPIRED,
        any_team=True,
        allow_zero_years=True,
    )


def unarchive_slot(
    league_id: str,
    workspace_id: str,
    row: dict[str, Any],
) -> dict[str, Any]:
    """Restore an archived expired contract to active from its snapshot."""
    payload = restore_from_archive(row)
    return storage.add_roster_slot(
        workspace_id,
        payload,
        team_id=payload.get("team_id"),
    )


def tick_contracts_on_draft_complete(league_id: str) -> dict[str, Any]:
    """Draft-complete year tick: archive expirations; never delete slots."""
    league = storage.get_league(league_id)
    if not league:
        return {"advanced": 0, "expired": 0, "archived": 0, "updates": []}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    ws_id, roster = _flatten_league_roster(league_id, league)
    season = int(league.get("season") or 0)
    as_of = _utcnow()

    pre_slots = [
        _slot_snapshot(row)
        for row in roster
        if str(row.get("roster_status") or ROSTER_ACTIVE) == ROSTER_ACTIVE
        and not is_current_auction_award(row)
    ]
    storage.save_draft_contract_snapshot(
        league_id,
        {
            "season": season,
            "pre_tick": {"slots": pre_slots},
            "post_draft": None,
            "published": False,
        },
    )

    # Only tick active rows (ignore already-archived).
    active_roster = [
        row
        for row in roster
        if str(row.get("roster_status") or ROSTER_ACTIVE) == ROSTER_ACTIVE
    ]
    summary = advance_roster_contracts_for_draft_complete(rules, active_roster)
    archived = 0
    by_id = {str(r.get("player_id")): r for r in active_roster}

    for item in summary["updates"]:
        pid = str(item["player_id"])
        if item.get("expired"):
            row = by_id.get(pid)
            if not row:
                continue
            archive_expired_slot(
                league_id,
                ws_id,
                row,
                season=season,
                as_of=as_of,
                reason=ARCHIVE_REASON_TICK,
            )
            archived += 1
            continue
        contract = item["contract"]
        apply_roster_edit(
            league_id,
            ws_id,
            pid,
            contract=contract,
            any_team=True,
            op="tick",
        )

    _, after = _flatten_league_roster(league_id, league)
    post_slots = [
        _slot_snapshot(row)
        for row in after
        if str(row.get("roster_status") or ROSTER_ACTIVE) == ROSTER_ACTIVE
    ]
    storage.save_draft_contract_snapshot(
        league_id,
        {
            "season": season,
            "pre_tick": {"slots": pre_slots},
            "post_draft": {
                "slots": post_slots,
                "advanced": summary.get("advanced"),
                "expired": summary.get("expired"),
                "archived": archived,
                "skipped_auction": summary.get("skipped_auction"),
                "extensions_activated": summary.get("extensions_activated"),
            },
            "published": True,
            "archive_mode": True,
        },
    )
    summary["archived"] = archived
    summary["snapshot_published"] = True
    summary["archive_mode"] = True
    return summary


def rewind_contracts_on_draft_reset(league_id: str) -> dict[str, Any]:
    """Undo draft-complete tick.

    Prefer:
      1. Pre-tick snapshot restore (covers advanced + expired keepers).
      2. Unarchive expired rows + best-effort +1 rewind for remaining keepers.
      3. Refuse if destructive expiration was published with neither snapshot nor archives.
    """
    league = storage.get_league(league_id)
    if not league:
        return {"rewound": 0, "updates": [], "lossless": False}

    snap = storage.get_draft_contract_snapshot(league_id) or {}
    pre_slots = ((snap.get("pre_tick") or {}).get("slots")) or []
    post = snap.get("post_draft") or {}
    published = bool(snap.get("published"))
    expired_count = int(post.get("expired") or 0)
    archive_mode = bool(snap.get("archive_mode") or post.get("archived"))

    ws_id = storage.roster_workspace_for_league(league)
    _, roster = _flatten_league_roster(league_id, league)
    archived_rows = [
        row for row in roster if is_archived_expired(row)
    ]

    if pre_slots:
        restored = 0
        for slot in pre_slots:
            pid = slot.get("player_id")
            if not pid:
                continue
            storage.add_roster_slot(
                ws_id,
                {
                    "player_id": pid,
                    "player_name": slot.get("player_name"),
                    "team": slot.get("team"),
                    "position": slot.get("position") or "FLEX",
                    "salary": float(slot.get("salary") or 1),
                    "contract_years": int(slot.get("contract_years") or 1),
                    "sleeper_player_id": slot.get("sleeper_player_id"),
                    "source": slot.get("source") or "sheet",
                    "roster_status": slot.get("roster_status") or ROSTER_ACTIVE,
                    "contract": dict(slot.get("contract") or {}),
                },
                team_id=slot.get("team_id"),
            )
            restored += 1
        storage.clear_draft_contract_snapshot(league_id)
        return {
            "rewound": restored,
            "restored": restored,
            "updates": [],
            "lossless": True,
            "via": "pre_tick_snapshot",
            "note": (
                f"Restored {restored} keeper contract(s) from the draft-complete snapshot "
                "(including any that expired on End)."
            ),
        }

    if archived_rows:
        unarchived = 0
        for row in archived_rows:
            unarchive_slot(league_id, ws_id, row)
            unarchived += 1
        # Rewind keepers that were advanced (still active, not auction awards).
        _, after_unarchive = _flatten_league_roster(league_id, league)
        keepers = [
            row
            for row in after_unarchive
            if str(row.get("roster_status") or ROSTER_ACTIVE) == ROSTER_ACTIVE
            and not is_current_auction_award(row)
            and not is_archived_expired(row)
        ]
        # Only rewind players that were not just restored from archive
        # (those already have pre-tick years). Unarchived rows have correct years.
        restored_ids = {str(r.get("player_id")) for r in archived_rows}
        to_rewind = [r for r in keepers if str(r.get("player_id")) not in restored_ids]
        summary = rewind_roster_contracts_after_draft_reset(to_rewind)
        for item in summary["updates"]:
            apply_roster_edit(
                league_id,
                ws_id,
                item["player_id"],
                contract=item["contract"],
                any_team=True,
                op="unarchive",
            )
        storage.clear_draft_contract_snapshot(league_id)
        return {
            "rewound": unarchived + int(summary.get("rewound") or 0),
            "restored": unarchived,
            "updates": summary.get("updates") or [],
            "lossless": True,
            "via": "archive",
            "note": (
                f"Restored {unarchived} archived expired contract(s); "
                f"rewound {summary.get('rewound') or 0} remaining keeper(s)."
            ),
        }

    if published and expired_count > 0 and not archive_mode:
        raise ValueError(
            "Cannot reset draft: draft-complete published a destructive expiration "
            "without a restore snapshot or archived contracts. "
            "Re-sync sheets/Sleeper to recover expired players."
        )

    summary = rewind_roster_contracts_after_draft_reset(
        [
            row
            for row in roster
            if str(row.get("roster_status") or ROSTER_ACTIVE) == ROSTER_ACTIVE
        ]
    )
    for item in summary["updates"]:
        apply_roster_edit(
            league_id,
            ws_id,
            item["player_id"],
            contract=item["contract"],
            any_team=True,
            op="tick",
        )
    storage.clear_draft_contract_snapshot(league_id)
    return summary
