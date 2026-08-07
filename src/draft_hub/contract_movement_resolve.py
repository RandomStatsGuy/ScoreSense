"""Story-based movement resolution for contract history owner changes."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from src.draft_hub import storage

MOVEMENT_STORIES = frozenset(
    {"cut", "trade", "draft_win", "waiver", "post_draft_fa", "add"}
)


def story_label(story: str) -> str:
    labels = {
        "cut": "Released / cut",
        "trade": "Traded",
        "draft_win": "Won at auction",
        "waiver": "Waiver pickup",
        "post_draft_fa": "Free agent add",
        "add": "Added to roster",
    }
    return labels.get(story, story)


def resolve_updates_for_movement(movement: dict[str, Any], story: str) -> dict[str, Any]:
    """Map a commissioner story to movement row updates."""
    if story not in MOVEMENT_STORIES:
        raise ValueError(f"Unknown story: {story}")
    et = str(movement.get("event_type") or "")
    updates: dict[str, Any] = {"confidence": "manual"}

    if story == "cut":
        if et == "trade_in":
            updates["event_type"] = "add"
        else:
            updates["event_type"] = "cut"
            updates["to_owner"] = None
        return updates

    if story == "trade":
        updates["event_type"] = "trade"
        return updates

    if story == "draft_win":
        if et in ("trade_out", "cut"):
            updates["event_type"] = "cut"
            updates["to_owner"] = None
        else:
            updates["event_type"] = "draft"
        return updates

    if story == "waiver":
        updates["event_type"] = "waiver"
        return updates

    if story == "post_draft_fa":
        updates["event_type"] = "post_draft_fa"
        return updates

    updates["event_type"] = "add"
    return updates


def apply_story_to_movements(
    league_id: str,
    movement_ids: list[int],
    story: str,
) -> list[dict[str, Any]]:
    """Resolve one or more movement rows with the same story."""
    if story not in MOVEMENT_STORIES:
        raise ValueError(f"Unknown story: {story}")
    updated: list[dict[str, Any]] = []
    for mid in movement_ids:
        mov = storage.get_league_movement(int(mid))
        if not mov or mov.get("league_id") != league_id:
            continue
        patch = resolve_updates_for_movement(mov, story)
        row = storage.update_league_movement(int(mid), patch)
        if row:
            updated.append(row)
    return updated


def _player_story_key(movement: dict[str, Any]) -> tuple:
    return (
        str(movement.get("player_name") or "").lower(),
        movement.get("from_owner") or "",
        movement.get("to_owner") or "",
    )


def group_ambiguous_movements(movements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse trade_in/trade_out pairs into one player story."""
    ambiguous = [m for m in movements if m.get("confidence") == "ambiguous"]
    groups: dict[tuple, dict[str, Any]] = {}
    for mov in ambiguous:
        key = _player_story_key(mov)
        bucket = groups.get(key)
        if not bucket:
            groups[key] = {
                "player_name": mov.get("player_name"),
                "from_owner": mov.get("from_owner"),
                "to_owner": mov.get("to_owner"),
                "salary": mov.get("salary"),
                "movement_ids": [mov["id"]],
                "event_types": [mov.get("event_type")],
            }
        else:
            bucket["movement_ids"].append(mov["id"])
            bucket["event_types"].append(mov.get("event_type"))
            if mov.get("salary") is not None:
                bucket["salary"] = mov.get("salary")
    return list(groups.values())


def group_departures_by_owner(
    movements: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Bulk groups: many players leaving the same owner (auction churn pattern)."""
    ambiguous = [m for m in movements if m.get("confidence") == "ambiguous"]
    player_groups = group_ambiguous_movements(ambiguous)
    by_owner: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for group in player_groups:
        from_owner = group.get("from_owner")
        if not from_owner:
            continue
        if not any(et in ("trade_out", "cut") for et in group.get("event_types") or []):
            continue
        by_owner[str(from_owner)].append(group)

    bulk: list[dict[str, Any]] = []
    for owner, groups in sorted(by_owner.items()):
        if len(groups) < 2:
            continue
        bulk.append(
            {
                "from_owner": owner,
                "player_count": len(groups),
                "players": [g["player_name"] for g in groups],
                "movement_ids": [mid for g in groups for mid in g["movement_ids"]],
            }
        )
    return bulk


def build_owner_changes_payload(
    movements: list[dict[str, Any]],
    *,
    season_year: int | None,
    sleeper_hints: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """UI payload for owner-change resolution."""
    hints = sleeper_hints or {}
    ambiguous = [m for m in movements if m.get("confidence") == "ambiguous"]
    resolved = [m for m in movements if m.get("confidence") != "ambiguous"]
    player_stories = group_ambiguous_movements(movements)
    for story in player_stories:
        from src.draft_hub.contract_history_audit import _name_key

        pk = _name_key(story.get("player_name") or "")
        hint = hints.get(pk)
        if hint:
            story["sleeper_hint"] = hint
    return {
        "season_year": season_year,
        "ambiguous_count": len(ambiguous),
        "resolved_count": len(resolved),
        "player_stories": player_stories,
        "bulk_departures": group_departures_by_owner(movements),
        "resolved_preview": resolved[:30],
        "stories": [
            {"id": s, "label": story_label(s)}
            for s in ("cut", "draft_win", "trade", "waiver", "post_draft_fa", "add")
        ],
        "sleeper_available": bool(hints),
    }
