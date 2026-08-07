"""Sleeper transaction + draft evidence for contract history tagging."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from src.draft_hub import storage
from src.draft_hub.contract_history_audit import _name_key
from src.draft_hub.draft_results_import import find_draft_win, load_draft_wins_by_season
from src.draft_hub.legacy_contract_reconcile import fetch_sleeper_transactions
from src.draft_hub.league_history import sleeper_league_season_chain
from src.draft_hub.owner_display import lookup_owner_label, team_owner_map_for_league
from src.draft_hub.player_name_match import name_key, names_likely_same
from src.integrations.sleeper import load_sleeper_players
from src.integrations.sleeper_league import fetch_league_rosters, fetch_league_users

_ACQ_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_ACQ_CACHE_TTL_SEC = 3600


def _cache_get(key: str) -> list[dict[str, Any]] | None:
    hit = _ACQ_CACHE.get(key)
    if not hit:
        return None
    if time.time() - hit[0] > _ACQ_CACHE_TTL_SEC:
        _ACQ_CACHE.pop(key, None)
        return None
    return hit[1]


def _cache_set(key: str, value: list[dict[str, Any]]) -> None:
    _ACQ_CACHE[key] = (time.time(), value)


def _player_name_from_sleeper_id(sid: str, raw: dict[str, Any]) -> str:
    info = raw.get(str(sid)) or {}
    return str(info.get("full_name") or f"Sleeper {sid}")


def sleeper_league_id_for_season(sleeper_league_id: str, season_year: int) -> str | None:
    chain = sleeper_league_season_chain(sleeper_league_id)
    for entry in chain:
        if int(entry.get("season") or 0) == int(season_year):
            return str(entry.get("league_id") or "")
    return None


def build_sleeper_roster_owner_map(
    league_id: str,
    sleeper_league_id: str,
    *,
    season_year: int,
) -> dict[int, str]:
    """Map Sleeper roster_id -> commissioner owner_label for one season."""
    owner_map = team_owner_map_for_league(league_id, season_year=season_year)
    try:
        rosters = fetch_league_rosters(sleeper_league_id)
        users = {u["user_id"]: u for u in fetch_league_users(sleeper_league_id)}
    except Exception:
        return {}

    out: dict[int, str] = {}
    for roster in rosters:
        rid = int(roster.get("roster_id") or 0)
        if not rid:
            continue
        user = users.get(roster.get("owner_id")) or {}
        meta = user.get("metadata") or {}
        team = str(meta.get("team_name") or user.get("display_name") or "")
        owner = lookup_owner_label(
            team,
            owner_map,
            sleeper_user_id=str(user.get("user_id") or ""),
        )
        if owner:
            out[rid] = owner
    return out


def parse_sleeper_acquisitions(
    league_id: str,
    sleeper_league_id: str,
    *,
    season_year: int,
) -> list[dict[str, Any]]:
    """Structured adds/trades/waivers from Sleeper for one NFL season."""
    lid = sleeper_league_id_for_season(sleeper_league_id, season_year) or sleeper_league_id
    cache_key = f"{league_id}:{season_year}:{lid}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    roster_map = build_sleeper_roster_owner_map(league_id, lid, season_year=season_year)
    if not roster_map:
        _cache_set(cache_key, [])
        return []

    raw_players = load_sleeper_players()
    events: list[dict[str, Any]] = []

    for tx in fetch_sleeper_transactions(lid):
        if str(tx.get("status") or "").lower() not in ("complete", "approved"):
            continue
        tx_type = str(tx.get("type") or "").lower()
        if tx_type not in ("trade", "waiver", "free_agent"):
            continue
        adds = tx.get("adds") or {}
        drops = tx.get("drops") or {}
        created_ms = tx.get("created")
        event_at = None
        if created_ms:
            try:
                event_at = datetime.fromtimestamp(int(created_ms) / 1000, tz=timezone.utc).isoformat()
            except (TypeError, ValueError, OSError):
                pass

        acq_type = "trade" if tx_type == "trade" else "waiver" if tx_type == "waiver" else "post_draft_fa"

        for pid, to_rid in (adds or {}).items():
            pname = _player_name_from_sleeper_id(str(pid), raw_players)
            to_owner = roster_map.get(int(to_rid or 0))
            from_owner = None
            drop_rid = (drops or {}).get(pid) or (drops or {}).get(str(pid))
            if drop_rid is not None:
                from_owner = roster_map.get(int(drop_rid))
            if not to_owner:
                continue
            events.append(
                {
                    "season_year": int(season_year),
                    "player_name": pname,
                    "player_key": _name_key(pname),
                    "event_type": acq_type,
                    "from_owner": from_owner,
                    "to_owner": to_owner,
                    "event_at": event_at,
                    "sleeper_transaction_id": str(tx.get("transaction_id") or ""),
                    "source": "sleeper",
                }
            )
    _cache_set(cache_key, events)
    return events


def build_sleeper_hints_payload(
    league_id: str,
    *,
    season_year: int,
) -> dict[str, Any]:
    """Lazy-loaded Sleeper hints for owner-change UI (not on hot contract-history path)."""
    league = storage.get_league(league_id) or {}
    sleeper_lid = str(league.get("sleeper_league_id") or "")
    if not sleeper_lid:
        return {"available": False, "hints_by_player": {}}
    movements = storage.list_league_movements(league_id, season_year=season_year)
    hints = sleeper_hints_for_movements(
        league_id,
        sleeper_lid,
        season_year=season_year,
        movements=movements,
    )
    return {
        "available": True,
        "season_year": season_year,
        "hints_by_player": hints,
    }


def _index_draft_wins() -> dict[int, dict[str, dict[str, Any]]]:
    wins_by_season, _ = load_draft_wins_by_season()
    indexed: dict[int, dict[str, dict[str, Any]]] = {}
    for season, wins in wins_by_season.items():
        bucket: dict[str, dict[str, Any]] = {}
        for w in wins:
            bucket[name_key(w["player_name"])] = w
        indexed[int(season)] = bucket
    return indexed


def build_player_acquisition_evidence(
    league_id: str,
    player_name: str,
    *,
    sleeper_league_id: str | None = None,
    editing_season: int | None = None,
) -> dict[str, Any]:
    """Cap sheet rows + Sleeper moves + draft wins for one player."""
    key = _name_key(player_name)
    if not key:
        return {"player_name": player_name, "events": [], "suggestions": []}

    events: list[dict[str, Any]] = []
    suggestions: list[dict[str, Any]] = []

    for yr in storage.list_league_contract_seasons(league_id):
        for row in storage.list_league_contract_rows(league_id, season_year=yr):
            if _name_key(row.get("player_name") or "") != key:
                continue
            events.append(
                {
                    "kind": "cap_sheet",
                    "season_year": int(yr),
                    "owner_label": row.get("owner_label"),
                    "cap_hit": row.get("cap_hit"),
                    "roster_status": row.get("roster_status"),
                    "acquisition_type": row.get("acquisition_type"),
                    "contract_phase": row.get("contract_phase"),
                    "row_id": row.get("id"),
                    "label": f"{yr} cap sheet: {row.get('owner_label')} · ${row.get('cap_hit')} ({row.get('roster_status')})",
                }
            )

    draft_index = _index_draft_wins()
    for yr, bucket in draft_index.items():
        win = find_draft_win(yr, player_name, None, {yr: bucket})
        if not win:
            for w in bucket.values():
                if names_likely_same(player_name, w["player_name"]):
                    win = w
                    break
        if win:
            events.append(
                {
                    "kind": "draft",
                    "season_year": yr,
                    "owner_label": win.get("owner_label"),
                    "cap_hit": win.get("cap_hit"),
                    "event_type": "draft",
                    "label": f"{yr} auction: won by {win.get('owner_label')} for ${win.get('cap_hit')}",
                    "source": win.get("source", "excel"),
                }
            )

    if sleeper_league_id:
        chain = sleeper_league_season_chain(sleeper_league_id)
        for entry in chain:
            yr = int(entry.get("season") or 0)
            if not yr:
                continue
            for ev in parse_sleeper_acquisitions(
                league_id,
                sleeper_league_id,
                season_year=yr,
            ):
                if ev.get("player_key") != key:
                    continue
                when = ""
                if ev.get("event_at"):
                    when = f" ({str(ev['event_at'])[:10]})"
                frm = f" from {ev['from_owner']}" if ev.get("from_owner") else ""
                events.append(
                    {
                        **ev,
                        "kind": "sleeper",
                        "label": (
                            f"{yr} Sleeper {ev['event_type']}{when}: "
                            f"{ev.get('from_owner') or '?'} → {ev.get('to_owner')}"
                        ),
                    }
                )

    events.sort(key=lambda e: (int(e.get("season_year") or 0), e.get("kind") != "cap_sheet", e.get("event_at") or ""))

    prev_owner: str | None = None
    for yr in sorted(storage.list_league_contract_seasons(league_id)):
        active = [
            r for r in storage.list_league_contract_rows(league_id, season_year=yr)
            if _name_key(r.get("player_name") or "") == key
            and str(r.get("roster_status") or "active") == "active"
        ]
        if not active:
            prev_owner = None
            continue
        row = active[0]
        owner = str(row.get("owner_label") or "")
        sleeper_ev = next(
            (
                e for e in events
                if e.get("kind") == "sleeper"
                and int(e.get("season_year") or 0) == yr
                and e.get("to_owner") == owner
            ),
            None,
        )
        draft_ev = next(
            (
                e for e in events
                if e.get("kind") == "draft"
                and int(e.get("season_year") or 0) == yr
                and e.get("owner_label") == owner
            ),
            None,
        )
        if prev_owner and prev_owner != owner and sleeper_ev:
            suggestions.append(
                {
                    "season_year": yr,
                    "row_id": row.get("id"),
                    "message": (
                        f"Sleeper shows {sleeper_ev['event_type']} from {sleeper_ev.get('from_owner')} "
                        f"to {owner} in {yr}. Tag the {yr} row Acquired=trade (not the next year's renewal)."
                    ),
                    "suggested_patch": {
                        "acquisition_type": sleeper_ev["event_type"],
                        "needs_review": False,
                    },
                }
            )
        elif not prev_owner and draft_ev and yr == int(draft_ev.get("season_year") or 0):
            suggestions.append(
                {
                    "season_year": yr,
                    "row_id": row.get("id"),
                    "message": f"Draft results show {owner} won this player at auction in {yr}.",
                    "suggested_patch": {
                        "acquisition_type": "draft",
                        "contract_phase": "initial",
                        "needs_review": False,
                    },
                }
            )
        elif editing_season and yr == int(editing_season) and prev_owner == owner:
            suggestions.append(
                {
                    "season_year": yr,
                    "row_id": row.get("id"),
                    "message": (
                        f"Same owner as {yr - 1} — this is a renewal row. "
                        "Leave Acquired blank; only set trade/draft on the season they joined."
                    ),
                    "suggested_patch": {
                        "acquisition_type": None,
                        "needs_review": False,
                    },
                }
            )
        prev_owner = owner

    return {
        "player_name": player_name,
        "events": events,
        "suggestions": suggestions,
    }


def sleeper_hints_for_movements(
    league_id: str,
    sleeper_league_id: str,
    *,
    season_year: int,
    movements: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Map player_key -> best Sleeper hint for ambiguous owner-change rows."""
    acquisitions = parse_sleeper_acquisitions(
        league_id,
        sleeper_league_id,
        season_year=season_year,
    )
    hints: dict[str, dict[str, Any]] = {}
    for mov in movements:
        if mov.get("confidence") != "ambiguous":
            continue
        pk = _name_key(mov.get("player_name") or "")
        if not pk:
            continue
        for ev in acquisitions:
            if ev.get("player_key") != pk:
                continue
            if mov.get("from_owner") and ev.get("from_owner") != mov.get("from_owner"):
                continue
            if mov.get("to_owner") and ev.get("to_owner") != mov.get("to_owner"):
                continue
            hints[pk] = {
                "story": "trade" if ev["event_type"] == "trade" else ev["event_type"],
                "label": ev.get("label") or f"Sleeper {ev['event_type']}",
                "event_at": ev.get("event_at"),
                "from_owner": ev.get("from_owner"),
                "to_owner": ev.get("to_owner"),
            }
            break
    return hints


def apply_sleeper_acquisition_tags(
    league_id: str,
    sleeper_league_id: str,
    *,
    season_year: int,
) -> dict[str, Any]:
    """Tag contract rows and resolve movements using structured Sleeper data."""
    from src.draft_hub.contract_movement_resolve import apply_story_to_movements

    lid = sleeper_league_id_for_season(sleeper_league_id, season_year) or sleeper_league_id
    acquisitions = parse_sleeper_acquisitions(league_id, lid, season_year=season_year)
    prev_rows = storage.list_league_contract_rows(league_id, season_year=season_year - 1)
    prev_by_player: dict[str, str] = {}
    for r in prev_rows:
        if str(r.get("roster_status") or "active") != "active":
            continue
        prev_by_player[_name_key(r.get("player_name") or "")] = str(r.get("owner_label") or "")

    rows_tagged = 0
    movements_resolved = 0
    curr_rows = storage.list_league_contract_rows(league_id, season_year=season_year)

    for ev in acquisitions:
        pk = ev.get("player_key") or ""
        to_owner = ev.get("to_owner")
        if not pk or not to_owner:
            continue
        prev_owner = prev_by_player.get(pk)
        if prev_owner == to_owner:
            continue
        for row in curr_rows:
            if _name_key(row.get("player_name") or "") != pk:
                continue
            if row.get("owner_label") != to_owner:
                continue
            if str(row.get("roster_status") or "active") != "active":
                continue
            if row.get("sleeper_verified") and row.get("acquisition_type") == ev["event_type"]:
                continue
            storage.update_league_contract_row(
                int(row["id"]),
                {
                    "acquisition_type": ev["event_type"],
                    "confidence": "sleeper_confirmed",
                    "needs_review": False,
                    "sleeper_verified": True,
                },
                edited_by_sub="system:sleeper",
                note=f"Sleeper {ev['event_type']} {ev.get('event_at') or ''}".strip(),
            )
            rows_tagged += 1
            break

    movements = storage.list_league_movements(league_id, season_year=season_year)
    hints = sleeper_hints_for_movements(
        league_id,
        sleeper_league_id,
        season_year=season_year,
        movements=movements,
    )
    for mov in movements:
        if mov.get("confidence") != "ambiguous":
            continue
        pk = _name_key(mov.get("player_name") or "")
        hint = hints.get(pk)
        if not hint:
            continue
        story = hint["story"]
        if story == "post_draft_fa":
            story = "post_draft_fa"
        apply_story_to_movements(league_id, [int(mov["id"])], story)
        movements_resolved += 1

    return {
        "season_year": season_year,
        "sleeper_league_id": lid,
        "acquisitions_found": len(acquisitions),
        "rows_tagged": rows_tagged,
        "movements_resolved": movements_resolved,
    }
