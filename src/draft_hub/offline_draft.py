"""Offline commissioner-paced draft, owner self-entry, and CSV round-trip.

Writes use the same auction-win / pick persist path as the live room.
Does not unlock Players-tab Add (`can_instant_add` stays false).
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone
from typing import Any

from src.draft_hub import storage
from src.draft_hub.draft_pool import list_drafted_player_ids, resolve_nomination_player
from src.draft_hub.draft_state import get_room_state
from src.draft_hub.pick_draft import is_pick_draft
from src.draft_hub.rules_engine import assert_can_acquire, normalize_position
from src.draft_hub.schemas import LeagueRules

CONDUCT_LIVE = "live"
CONDUCT_OFFLINE = "offline"

CSV_FIELDS = (
    "pick",
    "player_id",
    "name",
    "pos",
    "nfl_team",
    "owner",
    "team_id",
    "salary",
)


def session_conduct(session: dict[str, Any] | None) -> str:
    raw = str((session or {}).get("conduct") or CONDUCT_LIVE).strip().lower()
    return CONDUCT_OFFLINE if raw == CONDUCT_OFFLINE else CONDUCT_LIVE


def is_offline_conduct(session: dict[str, Any] | None) -> bool:
    return session_conduct(session) == CONDUCT_OFFLINE


def owner_entry_is_open(session: dict[str, Any] | None) -> bool:
    sess = session or {}
    if not sess.get("owner_entry_open"):
        return False
    closes = str(sess.get("owner_entry_closes_at") or "").strip()
    if not closes:
        return True
    try:
        when = datetime.fromisoformat(closes.replace("Z", "+00:00"))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) < when
    except ValueError:
        return True


def _normalize_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _primary_commissioner(league: dict[str, Any], user_sub: str) -> bool:
    return str(league.get("commissioner_sub") or "") == str(user_sub)


def set_owner_entry(
    league_id: str,
    user_sub: str,
    *,
    open_entry: bool,
    closes_at: str | None = None,
) -> dict[str, Any]:
    """Commissioner opens or closes the owner self-entry window. Session stays setup."""
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if not _primary_commissioner(league, user_sub):
        raise ValueError("Commissioner managed")
    if league.get("draft_completed"):
        raise ValueError("Draft is already marked complete.")
    if open_entry:
        storage.update_draft_session(
            league_id,
            owner_entry_open=1,
            owner_entry_closes_at=(closes_at or None),
        )
    else:
        storage.update_draft_session(
            league_id,
            owner_entry_open=0,
            owner_entry_closes_at=None,
        )
    return get_room_state(league_id, user_sub)


def _resolve_player(
    league: dict[str, Any],
    session: dict[str, Any],
    *,
    player_id: str,
    player_name: str = "",
    position: str = "",
    nfl_team: str = "",
) -> dict[str, Any]:
    pid = str(player_id or "").strip()
    rules = LeagueRules.model_validate(league["rules"])
    workspace_id = storage.roster_workspace_for_league(league)
    if pid:
        return resolve_nomination_player(
            league_id=league["id"],
            pool_mode=session.get("pool_mode"),
            player_id=pid,
            season=int(league["season"]),
            rules=rules,
            workspace_id=workspace_id,
        )
    needle = _normalize_name(player_name)
    if not needle:
        raise ValueError("Pick a player to record.")
    from src.draft_hub.draft_pool import build_nomination_pool

    pool = build_nomination_pool(
        league_id=league["id"],
        pool_mode=session.get("pool_mode"),
        season=int(league["season"]),
        rules=rules,
        workspace_id=workspace_id,
    )
    matches = [
        row
        for row in (pool.get("rows") or [])
        if _normalize_name(row.get("player") or row.get("player_name") or "") == needle
    ]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        raise ValueError(f"No pool match for {player_name or 'that player'}.")
    pos = normalize_position(position)
    team = str(nfl_team or "").strip().upper()
    narrowed = [
        row
        for row in matches
        if (not pos or normalize_position(row.get("position")) == pos)
        and (not team or str(row.get("team") or "").upper() == team)
    ]
    if len(narrowed) == 1:
        return narrowed[0]
    raise ValueError(f"More than one pool match for {player_name}. Add a player id.")


def _resolve_team_for_record(
    league_id: str,
    *,
    team_id: str = "",
    owner: str = "",
) -> dict[str, Any]:
    tid = str(team_id or "").strip()
    if tid:
        team = storage.get_team(tid)
        if not team or str(team.get("league_id")) != str(league_id):
            raise ValueError("Team is not in this league.")
        return team
    label = _normalize_name(owner)
    if not label:
        raise ValueError("Pick a team to record the win.")
    from src.draft_hub.owner_display import attach_owner_names_to_teams

    teams = storage.list_league_teams(league_id)
    attach_owner_names_to_teams(league_id, teams)
    hits = []
    for team in teams:
        names = [
            team.get("name"),
            team.get("owner_name"),
            team.get("sleeper_team_name"),
        ]
        if any(_normalize_name(n) == label for n in names if n):
            hits.append(team)
    if len(hits) == 1:
        return hits[0]
    if not hits:
        raise ValueError(f"No team match for {owner}.")
    raise ValueError(f"More than one team match for {owner}. Use team_id.")


def record_draft_result(
    league_id: str,
    user_sub: str,
    *,
    player_id: str = "",
    team_id: str = "",
    salary: float | None = None,
    player_name: str = "",
    position: str = "",
    nfl_team: str = "",
    owner: str = "",
) -> dict[str, Any]:
    """Write one draft win/pick through finalize_auction_win or add_roster_slot."""
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if league.get("draft_completed"):
        raise ValueError("Draft is already marked complete.")
    session = storage.get_draft_session(league_id) or {}
    is_comm = _primary_commissioner(league, user_sub)
    caller_team = storage.get_team_by_user(league_id, user_sub)
    winner = _resolve_team_for_record(league_id, team_id=team_id, owner=owner)

    if not is_comm:
        if not owner_entry_is_open(session):
            raise ValueError("Commissioner managed")
        if not caller_team or str(caller_team["id"]) != str(winner["id"]):
            raise ValueError("Record wins on your own team only.")

    rules = LeagueRules.model_validate(league["rules"])
    pick_draft = is_pick_draft(rules)
    resolved = _resolve_player(
        league,
        session,
        player_id=player_id,
        player_name=player_name,
        position=position,
        nfl_team=nfl_team,
    )
    pid = str(resolved.get("player_id") or player_id)
    if pid in list_drafted_player_ids(league_id):
        raise ValueError("Player already drafted")

    pos = normalize_position(resolved.get("position") or position)
    winner_roster = storage.list_team_roster(league_id, winner["id"])
    assert_can_acquire(rules, winner_roster, pos)

    ws_id = storage.roster_workspace_for_league(league)
    name = resolved.get("player") or resolved.get("player_name") or player_name
    nfl = resolved.get("team") or nfl_team

    if pick_draft:
        storage.add_roster_slot(
            ws_id,
            {
                "player_id": pid,
                "player_name": name,
                "team": nfl,
                "position": pos,
                "salary": 0.0,
                "contract_years": 1,
                "source": "draft",
            },
            team_id=winner["id"],
        )
        storage.append_draft_event(
            league_id,
            "pick",
            {
                "player_id": pid,
                "player_name": name,
                "team": nfl,
                "position": pos,
                "team_id": winner["id"],
                "team_name": winner.get("name"),
                "picking_team_id": winner["id"],
                "picking_team_name": winner.get("name"),
                "amount": 0,
                "source": "offline",
            },
        )
        return get_room_state(league_id, user_sub)

    amount = float(salary if salary is not None else rules.auction.min_bid)
    min_bid = float(rules.auction.min_bid)
    if amount < min_bid:
        raise ValueError(f"Salary must be at least ${min_bid:.0f}.")
    leftover = float(winner.get("budget_remaining") or 0)
    if amount > leftover + 1e-9:
        raise ValueError(
            f"{winner.get('name') or 'That team'} has ${leftover:.0f} leftover. This bid is ${amount:.0f}."
        )

    from src.draft_hub.contracts import auction_win_is_rookie, build_auction_win_contract
    from src.draft_hub.draft_budgets import preserve_cut_liability

    preserve_cut_liability(ws_id, pid)
    is_rookie = auction_win_is_rookie(rules, resolved)
    contract = build_auction_win_contract(rules, amount, is_rookie=is_rookie)
    roster_row = {
        "player_id": pid,
        "player_name": name,
        "team": nfl,
        "position": pos,
        "salary": amount,
        "contract_years": int(contract.get("years_remaining") or 2),
        "contract": contract,
        "source": "draft",
    }
    claimed = storage.finalize_auction_win(
        league_id,
        player_id=pid,
        winner_id=str(winner["id"]),
        amount=amount,
        workspace_id=ws_id,
        roster_row=roster_row,
        event_payload={
            "player_id": pid,
            "player_name": name,
            "team": nfl,
            "position": pos,
            "team_id": winner["id"],
            "team_name": winner.get("name"),
            "amount": amount,
            "source": "offline",
            **{k: resolved.get(k) for k in ("fair_value", "per_game_proj", "season_proj") if resolved.get(k) is not None},
        },
        session_fields={},
    )
    if not claimed:
        raise ValueError("Player already drafted")
    return get_room_state(league_id, user_sub)


def export_draft_results_csv(league_id: str) -> str:
    events = storage.list_draft_result_events(league_id)
    teams = {str(t["id"]): t for t in storage.list_league_teams(league_id)}
    from src.draft_hub.owner_display import attach_owner_names_to_teams

    attach_owner_names_to_teams(league_id, list(teams.values()))
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(CSV_FIELDS), extrasaction="ignore")
    writer.writeheader()
    for index, event in enumerate(events, start=1):
        payload = event.get("payload") or {}
        team_id = str(payload.get("team_id") or payload.get("picking_team_id") or "")
        team = teams.get(team_id) or {}
        writer.writerow({
            "pick": index,
            "player_id": payload.get("player_id") or "",
            "name": payload.get("player_name") or payload.get("player") or "",
            "pos": payload.get("position") or "",
            "nfl_team": payload.get("team") or "",
            "owner": team.get("owner_name") or payload.get("team_name") or team.get("name") or "",
            "team_id": team_id,
            "salary": payload.get("amount") if payload.get("amount") is not None else "",
        })
    return buf.getvalue()


def parse_draft_results_csv(text: str) -> list[dict[str, str]]:
    raw = str(text or "").lstrip("\ufeff")
    if not raw.strip():
        raise ValueError("CSV is empty.")
    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames:
        raise ValueError("CSV needs a header row.")
    headers = {str(h or "").strip().lower(): str(h or "").strip() for h in reader.fieldnames}
    alias = {
        "pick": "pick",
        "player_id": "player_id",
        "playerid": "player_id",
        "name": "name",
        "player": "name",
        "player_name": "name",
        "pos": "pos",
        "position": "pos",
        "nfl_team": "nfl_team",
        "nfl": "nfl_team",
        "team": "nfl_team",
        "owner": "owner",
        "winner": "owner",
        "team_id": "team_id",
        "salary": "salary",
        "amount": "salary",
        "$": "salary",
    }
    mapped: list[dict[str, str]] = []
    for row in reader:
        out = {key: "" for key in CSV_FIELDS}
        for src, value in row.items():
            dest = alias.get(str(src or "").strip().lower())
            if dest:
                out[dest] = str(value or "").strip()
        if not any(out[k] for k in ("player_id", "name", "team_id", "owner")):
            continue
        mapped.append(out)
    if not mapped:
        raise ValueError("CSV has a header but no pick rows.")
    _ = headers
    return mapped


def preview_draft_results_csv(league_id: str, text: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    session = storage.get_draft_session(league_id) or {}
    rows = parse_draft_results_csv(text)
    ready: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        item = {**row, "row": index}
        try:
            player = _resolve_player(
                league,
                session,
                player_id=row.get("player_id") or "",
                player_name=row.get("name") or "",
                position=row.get("pos") or "",
                nfl_team=row.get("nfl_team") or "",
            )
            team = _resolve_team_for_record(
                league_id,
                team_id=row.get("team_id") or "",
                owner=row.get("owner") or "",
            )
            item["matched_player_id"] = player.get("player_id")
            item["matched_player_name"] = player.get("player") or player.get("player_name")
            item["matched_team_id"] = team["id"]
            item["matched_team_name"] = team.get("name")
            ready.append(item)
        except ValueError as exc:
            item["error"] = str(exc)
            errors.append(item)
    return {
        "ready": ready,
        "errors": errors,
        "ready_count": len(ready),
        "error_count": len(errors),
        "row_count": len(rows),
    }


def apply_draft_results_csv(league_id: str, user_sub: str, text: str) -> dict[str, Any]:
    preview = preview_draft_results_csv(league_id, text)
    applied = 0
    apply_errors: list[dict[str, Any]] = list(preview["errors"])
    for row in preview["ready"]:
        try:
            salary_raw = row.get("salary")
            salary = float(salary_raw) if str(salary_raw or "").strip() else None
            record_draft_result(
                league_id,
                user_sub,
                player_id=str(row.get("matched_player_id") or row.get("player_id") or ""),
                team_id=str(row.get("matched_team_id") or row.get("team_id") or ""),
                salary=salary,
                player_name=str(row.get("name") or ""),
                position=str(row.get("pos") or ""),
                nfl_team=str(row.get("nfl_team") or ""),
            )
            applied += 1
        except ValueError as exc:
            apply_errors.append({**row, "error": str(exc)})
    return {
        **get_room_state(league_id, user_sub),
        "applied": applied,
        "errors": apply_errors,
        "error_count": len(apply_errors),
        "ready_count": preview["ready_count"],
    }
