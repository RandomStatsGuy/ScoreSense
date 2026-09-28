"""Scoring identity only: never use this as a roster/export/lock validator."""

from __future__ import annotations

from typing import Iterable


def scoring_lineup_key(
    *,
    site: str,
    slate_snapshot_id: str,
    game_style: str,
    player_ids: Iterable[str],
    captain_id: str | None = None,
) -> tuple[str, str, str, str | None, tuple[str, ...]]:
    """Collapse slot permutations without collapsing different Captains.

    Supports the two proposed DraftKings NFL profiles only. Preserve an entry's
    slot map and platform locks separately: score-equivalent is not swap-equivalent.
    """
    if site != "draftkings":
        raise ValueError("GPP scoring identity currently supports DraftKings only")
    if not isinstance(slate_snapshot_id, str) or not slate_snapshot_id.strip():
        raise ValueError("slate_snapshot_id is required")
    if game_style not in ("classic", "showdown"):
        raise ValueError("unsupported GPP game_style")
    if isinstance(player_ids, (str, bytes)):
        raise TypeError("player_ids must be a collection of canonical IDs")
    ids = tuple(player_ids)
    if any(not isinstance(pid, str) or not pid.strip() for pid in ids):
        raise ValueError("every canonical player ID must be a nonempty string")
    expected = 9 if game_style == "classic" else 6
    if len(ids) != expected or len(set(ids)) != expected:
        raise ValueError(f"{game_style} requires {expected} distinct canonical IDs")
    if game_style == "classic" and captain_id is not None:
        raise ValueError("Classic does not have a Captain")
    if game_style == "showdown" and captain_id not in ids:
        raise ValueError("Showdown requires a Captain from the selected entities")
    return site, slate_snapshot_id, game_style, captain_id, tuple(sorted(ids))
