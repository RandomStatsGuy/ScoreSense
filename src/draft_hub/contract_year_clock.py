"""Persist contract year tick when a league marks the draft completed."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.acquisition_semantics import is_current_auction_award
from src.draft_hub.contract_typing import (
    advance_roster_contracts_for_draft_complete,
    rewind_roster_contracts_after_draft_reset,
)
from src.draft_hub.schemas import LeagueRules


def _flatten_league_roster(league_id: str, league: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    ws_id = storage.roster_workspace_for_league(league)
    by_team = storage.list_league_rosters_by_team(league_id)
    roster: list[dict[str, Any]] = []
    for rows in by_team.values():
        roster.extend(rows)
    if not roster and ws_id:
        roster = storage.list_roster(ws_id)
    return ws_id, roster


def _slot_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    """Serializable roster slot for pre/post draft-complete snapshots."""
    return {
        "player_id": row.get("player_id"),
        "player_name": row.get("player_name"),
        "team": row.get("team"),
        "position": row.get("position"),
        "salary": row.get("salary"),
        "contract_years": row.get("contract_years"),
        "sleeper_player_id": row.get("sleeper_player_id"),
        "source": row.get("source"),
        "roster_status": row.get("roster_status") or "active",
        "team_id": row.get("team_id"),
        "contract": dict(row.get("contract") or {}),
    }


def tick_contracts_on_draft_complete(league_id: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        return {"advanced": 0, "expired": 0, "updates": []}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    ws_id, roster = _flatten_league_roster(league_id, league)

    # Pre-tick snapshot of keepers (non-auction) for lossless reset.
    pre_slots = [
        _slot_snapshot(row)
        for row in roster
        if str(row.get("roster_status") or "active") == "active"
        and not is_current_auction_award(row)
    ]
    storage.save_draft_contract_snapshot(
        league_id,
        {
            "season": int(league.get("season") or 0),
            "pre_tick": {"slots": pre_slots},
            "post_draft": None,
            "published": False,
        },
    )

    summary = advance_roster_contracts_for_draft_complete(rules, roster)
    for item in summary["updates"]:
        pid = item["player_id"]
        if item.get("expired"):
            storage.remove_roster_slot(ws_id, pid)
            continue
        contract = item["contract"]
        storage.update_roster_slot(
            ws_id,
            pid,
            contract=contract,
            any_team=True,
        )

    # Publish post-draft snapshot after mutations (includes auction awards still on roster).
    _, after = _flatten_league_roster(league_id, league)
    post_slots = [
        _slot_snapshot(row)
        for row in after
        if str(row.get("roster_status") or "active") == "active"
    ]
    storage.save_draft_contract_snapshot(
        league_id,
        {
            "season": int(league.get("season") or 0),
            "pre_tick": {"slots": pre_slots},
            "post_draft": {
                "slots": post_slots,
                "advanced": summary.get("advanced"),
                "expired": summary.get("expired"),
                "skipped_auction": summary.get("skipped_auction"),
                "extensions_activated": summary.get("extensions_activated"),
            },
            "published": True,
        },
    )
    summary["snapshot_published"] = True
    return summary


def rewind_contracts_on_draft_reset(league_id: str) -> dict[str, Any]:
    """Undo tick_contracts_on_draft_complete.

    Prefer lossless restore from the pre-tick snapshot (reinstates expired keepers).
    If a published snapshot recorded expirations but no pre-tick slots exist, refuse.
    Otherwise fall back to best-effort +1 year rewind for remaining keepers.
    """
    league = storage.get_league(league_id)
    if not league:
        return {"rewound": 0, "updates": [], "lossless": False}

    snap = storage.get_draft_contract_snapshot(league_id) or {}
    pre_slots = ((snap.get("pre_tick") or {}).get("slots")) or []
    post = snap.get("post_draft") or {}
    published = bool(snap.get("published"))
    expired_count = int(post.get("expired") or 0)

    if pre_slots:
        ws_id = storage.roster_workspace_for_league(league)
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
                    "roster_status": slot.get("roster_status") or "active",
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
            "note": (
                f"Restored {restored} keeper contract(s) from the draft-complete snapshot "
                "(including any that expired on End)."
            ),
        }

    if published and expired_count > 0:
        raise ValueError(
            "Cannot reset draft: draft-complete published a destructive expiration "
            "without a restore snapshot. Re-sync sheets/Sleeper to recover expired players."
        )

    ws_id, roster = _flatten_league_roster(league_id, league)
    summary = rewind_roster_contracts_after_draft_reset(roster)
    for item in summary["updates"]:
        storage.update_roster_slot(
            ws_id,
            item["player_id"],
            contract=item["contract"],
            any_team=True,
        )
    storage.clear_draft_contract_snapshot(league_id)
    return summary
