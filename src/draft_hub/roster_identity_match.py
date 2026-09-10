"""Match roster slots across GSIS, Sleeper, and sheet player ids.

Sleeper sync used to insert a second occupying row when the live snapshot
used ``sleeper-<id>`` (or a bare Sleeper id) and the cap sheet stored GSIS.
A player may be active on two rosters only when one row is a cut.
"""

from __future__ import annotations

import re
from typing import Any

from src.draft_hub.player_name_match import roster_name_key
from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.storage import roster_row_occupies

_GSIS_RE = re.compile(r"^00-\d{7}$")


def is_gsis_player_id(player_id: str | None) -> bool:
    return bool(_GSIS_RE.match(str(player_id or "").strip()))


def roster_identity_tokens(row: dict[str, Any] | None) -> set[str]:
    """Comparable ids for one person: GSIS, sleeper-<n>, and bare Sleeper n."""
    tokens: set[str] = set()
    if not row:
        return tokens
    pid = str(row.get("player_id") or "").strip()
    spid = str(row.get("sleeper_player_id") or "").strip()
    for raw in (pid, spid):
        if not raw:
            continue
        tokens.add(raw)
        if raw.startswith("sleeper-"):
            tokens.add(raw[8:])
        elif raw.isdigit():
            tokens.add(f"sleeper-{raw}")
    return {t for t in tokens if t}


def identities_overlap(left: dict[str, Any] | None, right: dict[str, Any] | None) -> bool:
    return bool(roster_identity_tokens(left) & roster_identity_tokens(right))


def name_pos_key(row: dict[str, Any] | None) -> str:
    if not row:
        return ""
    name = roster_name_key(str(row.get("player_name") or ""))
    pos = normalize_position(row.get("position"))
    if pos in {"DST", "D"}:
        pos = "DEF"
    if not name or not pos:
        return ""
    return f"{name}|{pos}"


def slot_years(row: dict[str, Any] | None) -> int:
    if not row:
        return 0
    contract = row.get("contract") or {}
    if isinstance(contract, dict) and contract.get("years_remaining") is not None:
        try:
            return int(contract["years_remaining"])
        except (TypeError, ValueError):
            pass
    try:
        return int(row.get("contract_years") or 0)
    except (TypeError, ValueError):
        return 0


def preferred_player_id(existing: dict[str, Any], incoming: dict[str, Any]) -> str:
    """Keep GSIS when either side has it; otherwise keep the stored id."""
    ex = str(existing.get("player_id") or "").strip()
    inc = str(incoming.get("player_id") or "").strip()
    if is_gsis_player_id(ex):
        return ex
    if is_gsis_player_id(inc):
        return inc
    return ex or inc


def _team_key(row: dict[str, Any] | None) -> str:
    return str((row or {}).get("team_id") or "")


def find_matching_roster_slot(
    rows: list[dict[str, Any]],
    player: dict[str, Any],
    *,
    team_id: str | None = None,
    occupying_only: bool = True,
) -> dict[str, Any] | None:
    """First occupying (or any) slot that is the same person as ``player``."""
    candidates = list(rows or [])
    if occupying_only:
        candidates = [r for r in candidates if roster_row_occupies(r)]
    if not candidates:
        return None

    pid = str(player.get("player_id") or "").strip()
    exact = [r for r in candidates if pid and str(r.get("player_id") or "") == pid]
    if exact:
        return _prefer_team(exact, team_id)

    overlap = [r for r in candidates if identities_overlap(r, player)]
    if overlap:
        return _prefer_team(overlap, team_id)

    want = name_pos_key(player)
    if not want:
        return None
    named = [r for r in candidates if name_pos_key(r) == want]
    if team_id:
        on_team = [r for r in named if _team_key(r) == str(team_id)]
        if on_team:
            return pick_keeper_slot(on_team)
    return pick_keeper_slot(named) if named else None


def _prefer_team(rows: list[dict[str, Any]], team_id: str | None) -> dict[str, Any]:
    if team_id:
        on_team = [r for r in rows if _team_key(r) == str(team_id)]
        if on_team:
            return pick_keeper_slot(on_team)
    return pick_keeper_slot(rows)


def pick_keeper_slot(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Keep the live staff contract; drop the Sleeper $1 clone."""

    def rank(row: dict[str, Any]) -> tuple:
        yrs = slot_years(row)
        live = 1 if yrs >= 1 else 0
        source = str(row.get("source") or "").strip().lower()
        staff = 0 if source in {"sleeper", ""} else 1
        try:
            salary = float(row.get("salary") or 0)
        except (TypeError, ValueError):
            salary = 0.0
        try:
            slot_id = int(row.get("id") or 0)
        except (TypeError, ValueError):
            slot_id = 0
        return (live, staff, salary, yrs, -slot_id)

    return max(rows, key=rank)


def group_duplicate_occupying(
    rows: list[dict[str, Any]],
    *,
    team_id: str | None = None,
) -> list[list[dict[str, Any]]]:
    """Same-team occupying groups that are one person under two ids."""
    occupying = [r for r in rows if roster_row_occupies(r)]
    if team_id:
        occupying = [r for r in occupying if _team_key(r) == str(team_id)]

    used: set[int] = set()
    groups: list[list[dict[str, Any]]] = []
    for i, row in enumerate(occupying):
        rid = row.get("id")
        if rid is not None and int(rid) in used:
            continue
        cluster = [row]
        if rid is not None:
            used.add(int(rid))
        key = name_pos_key(row)
        for other in occupying[i + 1 :]:
            oid = other.get("id")
            if oid is not None and int(oid) in used:
                continue
            if _team_key(other) != _team_key(row):
                continue
            if identities_overlap(row, other) or (key and key == name_pos_key(other)):
                cluster.append(other)
                if oid is not None:
                    used.add(int(oid))
        if len(cluster) > 1:
            groups.append(cluster)
    return groups
