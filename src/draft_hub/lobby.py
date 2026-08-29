"""Draft lobby — guest join, snake-slot claims, and live-draft open emails."""

from __future__ import annotations

import json
import uuid
from typing import Any

from src.auth import user_store
from src.auth.user_store import normalize_email
from src.config import FRONTEND_URL
from src.draft_hub import storage
from src.draft_hub.draft_state import (
    get_room_state,
    start_draft,
    nomination_order_for_start,
)
from src.draft_hub.pick_draft import draft_type_of, is_pick_draft
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.test_draft import BOT_NAMES
from src.email.smtp import send_email


MAX_DISPLAY_NAME = 24


def build_lobby_url(room_code: str) -> str:
    code = str(room_code or "").strip().upper()
    base = FRONTEND_URL.rstrip("/")
    return f"{base}/lobby/{code}"


def clean_display_name(name: str | None) -> str:
    label = " ".join(str(name or "").strip().split())
    if not label:
        raise ValueError("Enter a display name")
    if len(label) > MAX_DISPLAY_NAME:
        raise ValueError(f"Keep names to {MAX_DISPLAY_NAME} characters")
    return label


def _public_seat(team: dict[str, Any]) -> dict[str, Any]:
    return {
        "team_id": team.get("id"),
        "name": team.get("name"),
        "is_commissioner": bool(team.get("is_commissioner")),
        "is_bot": bool(team.get("is_bot")),
        "is_guest": bool(team.get("is_guest") or storage.is_guest_sub(team.get("user_sub"))),
        "draft_slot": team.get("draft_slot"),
        "claimed": bool(team.get("user_sub")) and not team.get("is_bot"),
    }


def _slot_board(teams: list[dict[str, Any]], team_count: int) -> list[dict[str, Any]]:
    by_slot: dict[int, dict[str, Any]] = {}
    for team in teams:
        slot = team.get("draft_slot")
        if slot is None:
            continue
        try:
            index = int(slot)
        except (TypeError, ValueError):
            continue
        if index not in by_slot:
            by_slot[index] = team
    return [
        {
            "slot": index,
            "seat": _public_seat(by_slot[index]) if index in by_slot else None,
        }
        for index in range(1, max(1, team_count) + 1)
    ]


def lobby_is_joinable(league: dict[str, Any] | None) -> bool:
    if not league:
        return False
    if str(league.get("status") or "setup") != "setup":
        return False
    if league.get("draft_completed"):
        return False
    return True


def build_lobby_preview(room_code: str) -> dict[str, Any]:
    league = storage.get_league_by_room_code(room_code)
    if not league:
        raise ValueError("Lobby not found")
    rules = LeagueRules.model_validate(league.get("rules") or {})
    teams = storage.list_league_teams(league["id"])
    humans = [t for t in teams if not t.get("is_bot") and t.get("user_sub")]
    team_count = int(league.get("team_count") or 12)
    draft_type = draft_type_of(rules)
    return {
        "room_code": league.get("room_code"),
        "league_id": league["id"],
        "name": league.get("name"),
        "season": league.get("season"),
        "draft_type": draft_type,
        "pick_draft": is_pick_draft(rules),
        "team_count": team_count,
        "status": league.get("status") or "setup",
        "test_mode": bool(league.get("test_mode")),
        "draft_starts_at": league.get("draft_starts_at"),
        "draft_timezone": league.get("draft_timezone"),
        "can_join": lobby_is_joinable(league) and len(humans) < team_count,
        "lobby_url": build_lobby_url(str(league.get("room_code") or "")),
        "claimed": len(humans),
        "open_seats": max(0, team_count - len(humans)),
        "seats": [_public_seat(t) for t in teams if not t.get("is_bot")],
        "slots": _slot_board(teams, team_count),
        "lobby_notified_at": league.get("lobby_notified_at"),
    }


def _claim_or_create_seat(
    league: dict[str, Any],
    user_sub: str,
    display_name: str,
) -> dict[str, Any]:
    league_id = str(league["id"])
    existing = storage.get_team_by_user(league_id, user_sub)
    if existing:
        if display_name and display_name != existing.get("name"):
            return storage.update_team_display_name(existing["id"], display_name)
        return existing
    if not lobby_is_joinable(league):
        raise ValueError("This draft is already underway")
    teams = storage.list_league_teams(league_id)
    humans_claimed = [t for t in teams if not t.get("is_bot") and t.get("user_sub")]
    team_count = int(league.get("team_count") or 12)
    if len(humans_claimed) >= team_count:
        raise ValueError("The room is full")
    unclaimed = [t for t in teams if not t.get("is_bot") and not t.get("user_sub")]
    if unclaimed:
        return storage.assign_team_user(str(unclaimed[0]["id"]), user_sub, name=display_name)
    if len(teams) >= team_count:
        raise ValueError("The room is full")
    rules = LeagueRules.model_validate(league.get("rules") or {})
    team_id = str(uuid.uuid4())
    now = storage._utcnow()
    with storage.get_conn() as conn:
        conn.execute(
            """INSERT INTO team (id, league_id, user_sub, name, budget_remaining, is_commissioner, is_bot, joined_at)
               VALUES (?, ?, ?, ?, ?, 0, 0, ?)""",
            (team_id, league_id, user_sub, display_name, float(rules.salary_cap), now),
        )
        row = conn.execute("SELECT * FROM team WHERE id = ?", (team_id,)).fetchone()
    return storage._team_dict(row)


def join_lobby(
    room_code: str,
    display_name: str,
    *,
    user: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Seat a signed-in member or create a guest seat. Returns token when guest."""
    from app.auth import create_guest_access_token, is_guest_user
    from src.draft_hub.storage import user_sub_from_patron

    league = storage.get_league_by_room_code(room_code)
    if not league:
        raise ValueError("Lobby not found")
    name = clean_display_name(display_name)
    guest_token = None
    if user and is_guest_user(user) and str(user.get("league_id") or "") == str(league["id"]):
        sub = str(user.get("sub") or "")
        team = _claim_or_create_seat(league, sub, name)
        guest_id = sub.split(":", 1)[1] if sub.startswith(storage.GUEST_SUB_PREFIX) else None
        guest_token, sub = create_guest_access_token(
            league_id=str(league["id"]),
            team_id=str(team["id"]),
            name=name,
            guest_id=guest_id,
        )
    elif user and not is_guest_user(user):
        sub = user_sub_from_patron(user)
        team = _claim_or_create_seat(league, sub, name)
    else:
        guest_id = str(uuid.uuid4())
        sub = f"{storage.GUEST_SUB_PREFIX}{guest_id}"
        team = _claim_or_create_seat(league, sub, name)
        guest_token, sub = create_guest_access_token(
            league_id=str(league["id"]),
            team_id=str(team["id"]),
            name=name,
            guest_id=guest_id,
        )
    preview = build_lobby_preview(str(league.get("room_code") or room_code))
    return {
        "token": guest_token,
        "auth_type": "guest" if guest_token else (user or {}).get("auth_type") or "native",
        "league_id": league["id"],
        "room_code": league.get("room_code"),
        "team": team,
        "lobby": preview,
        "state": get_room_state(league["id"], sub),
    }


def claim_draft_slot(
    league_id: str,
    user_sub: str,
    slot: int | None,
    *,
    team_id: str | None = None,
) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if not lobby_is_joinable(league):
        raise ValueError("Draft order can only change before the draft starts")
    team_count = int(league.get("team_count") or 12)
    target = None
    if team_id and str(league.get("commissioner_sub") or "") == str(user_sub):
        target = storage.get_team(str(team_id))
        if not target or str(target.get("league_id")) != str(league_id):
            raise ValueError("Team not found")
    else:
        target = storage.get_team_by_user(league_id, user_sub)
    if not target:
        raise ValueError("Join the lobby before claiming a pick")
    if target.get("is_bot"):
        raise ValueError("Bots cannot claim a human seat")
    if slot is None:
        storage.set_team_draft_slot(str(target["id"]), None)
    else:
        index = int(slot)
        if index < 1 or index > team_count:
            raise ValueError(f"Pick a seat between 1 and {team_count}")
        if storage.draft_slot_taken(league_id, index, except_team_id=str(target["id"])):
            raise ValueError("That pick is already taken")
        storage.set_team_draft_slot(str(target["id"]), index)
    _sync_nomination_order(league_id)
    return get_room_state(league_id, user_sub)


def rename_lobby_team(league_id: str, user_sub: str, name: str) -> dict[str, Any]:
    team = storage.get_team_by_user(league_id, user_sub)
    if not team:
        raise ValueError("Join the lobby before renaming")
    storage.update_team_display_name(str(team["id"]), clean_display_name(name))
    return get_room_state(league_id, user_sub)


def _sync_nomination_order(league_id: str) -> None:
    league = storage.get_league(league_id)
    if not league:
        return
    session = storage.get_draft_session(league_id) or {}
    teams = storage.list_league_teams(league_id)
    order = nomination_order_for_start(league, teams, session)
    if not order:
        return
    storage.update_draft_session(
        league_id,
        nomination_order_json=json.dumps(order),
        nominator_index=0,
    )


def fill_empty_seats_with_bots(league_id: str) -> int:
    """Add bots for leftover mock seats. No-op on live leagues or a full room."""
    league = storage.get_league(league_id)
    if not league or not league.get("test_mode"):
        return 0
    teams = storage.list_league_teams(league_id)
    team_count = int(league.get("team_count") or 12)
    need = max(0, team_count - len(teams))
    if need == 0:
        return 0
    rules = LeagueRules.model_validate(league.get("rules") or {})
    budget = float(rules.salary_cap)
    taken = {
        int(t["draft_slot"])
        for t in teams
        if t.get("draft_slot") is not None
    }
    open_slots = [i for i in range(1, team_count + 1) if i not in taken]
    added = 0
    for i in range(need):
        bot_id = str(uuid.uuid4())
        name = BOT_NAMES[i % len(BOT_NAMES)]
        slot = open_slots[i] if i < len(open_slots) else None
        storage.add_bot_team(league_id, bot_id, name, budget, draft_slot=slot)
        added += 1
    _sync_nomination_order(league_id)
    return added


def start_from_lobby(
    league_id: str,
    user_sub: str,
    *,
    force: bool = False,
    allow_empty: bool = False,
    fill_bots: bool = False,
) -> dict[str, Any]:
    if fill_bots:
        fill_empty_seats_with_bots(league_id)
    state = start_draft(league_id, user_sub, force=force, allow_empty=allow_empty)
    league = storage.get_league(league_id) or {}
    if not league.get("test_mode"):
        try:
            notify_managers_draft_open(league_id, user_sub, force=False)
        except ValueError:
            pass
        state = get_room_state(league_id, user_sub)
    return state


def _manager_emails(league_id: str, *, exclude_sub: str | None = None) -> list[str]:
    found: set[str] = set()
    for invite in storage.list_league_invites(league_id):
        if str(invite.get("status") or "") in ("revoked",):
            continue
        email = normalize_email(invite.get("email") or "")
        if email:
            found.add(email)
    for team in storage.list_league_teams(league_id):
        sub = str(team.get("user_sub") or "")
        if not sub or team.get("is_bot") or storage.is_guest_sub(sub):
            continue
        if exclude_sub and sub == str(exclude_sub):
            continue
        if sub.startswith("ss:"):
            row = user_store.get_user_by_id(sub[3:])
            if row and row.get("email"):
                found.add(normalize_email(row["email"]))
    return sorted(found)


def send_draft_open_email(
    to_email: str,
    *,
    league_name: str,
    lobby_url: str,
    draft_type: str,
    starts_label: str | None = None,
) -> bool:
    format_label = {
        "snake": "snake draft",
        "linear": "linear draft",
        "auction": "auction",
    }.get(str(draft_type or "auction"), "draft")
    when = f" Scheduled for {starts_label}." if starts_label else ""
    body = "\n".join(
        [
            f"The {format_label} for {league_name} is open.{when}",
            "",
            "Join the lobby (a ScoreSense account is optional for this room):",
            lobby_url,
            "",
            "If you already have a seat, that link puts you back in the room.",
            "",
        ]
    )
    return send_email(
        to_email,
        subject=f"{league_name} draft is open",
        text_body=body,
    )


def notify_managers_draft_open(
    league_id: str,
    actor_sub: str,
    *,
    force: bool = False,
) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    if str(league.get("commissioner_sub") or "") != str(actor_sub):
        raise ValueError("Only the commissioner can email the room")
    if league.get("test_mode"):
        raise ValueError("Practice rooms do not email managers")
    already = league.get("lobby_notified_at")
    if already and not force:
        return {
            "sent": 0,
            "recipients": 0,
            "skipped": True,
            "notified_at": already,
            "lobby_url": build_lobby_url(str(league.get("room_code") or "")),
        }
    rules = LeagueRules.model_validate(league.get("rules") or {})
    emails = _manager_emails(league_id, exclude_sub=actor_sub)
    lobby_url = build_lobby_url(str(league.get("room_code") or ""))
    sent = 0
    for email in emails:
        if send_draft_open_email(
            email,
            league_name=str(league.get("name") or "your league"),
            lobby_url=lobby_url,
            draft_type=draft_type_of(rules),
        ):
            sent += 1
    storage.set_lobby_notified_at(league_id)
    refreshed = storage.get_league(league_id) or league
    return {
        "sent": sent,
        "recipients": len(emails),
        "skipped": False,
        "notified_at": refreshed.get("lobby_notified_at"),
        "lobby_url": lobby_url,
    }
