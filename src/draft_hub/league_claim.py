"""Shareable league claim links — text a URL, pick an unclaimed team."""

from __future__ import annotations

from typing import Any

from src.config import FRONTEND_URL
from src.draft_hub import storage


def build_claim_url(token: str) -> str:
    base = FRONTEND_URL.rstrip("/")
    return f"{base}/hub/draft?claim={token}"


def ensure_claim_token(league_id: str) -> str:
    token = storage.get_league_claim_token(league_id)
    if not token:
        raise ValueError("League not found")
    return token


def staff_claim_payload(league: dict[str, Any]) -> dict[str, Any]:
    league_id = str(league.get("id") or "")
    token = ensure_claim_token(league_id)
    return {
        "url": build_claim_url(token),
        "enabled": bool(league.get("claim_link_enabled", True)),
    }


def rotate_claim_link(league_id: str) -> dict[str, Any]:
    token = storage.rotate_league_claim_token(league_id)
    league = storage.get_league(league_id) or {}
    return {
        "url": build_claim_url(token),
        "enabled": bool(league.get("claim_link_enabled", True)),
    }


def _public_team(team: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": team.get("id"),
        "name": team.get("name"),
        "owner_name": team.get("owner_name"),
    }


def _human_teams(teams: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [t for t in teams if not t.get("is_bot")]


def _pending_invite_team_ids(league_id: str, teams: list[dict[str, Any]]) -> set[str]:
    pending_names = {
        str(invite.get("team_name") or "").strip().lower()
        for invite in storage.list_league_invites(league_id)
        if str(invite.get("status") or "") == "pending"
    }
    return {
        str(team["id"])
        for team in teams
        if str(team.get("name") or "").strip().lower() in pending_names
    }


def _seat_reserved(league_id: str, team: dict[str, Any]) -> bool:
    return bool(storage.get_pending_invite_for_team(league_id, str(team.get("id") or "")))


def build_claim_preview(token: str, user_sub: str | None = None) -> dict[str, Any]:
    league = storage.get_league_by_claim_token(token)
    if not league:
        raise ValueError("Invite link is not valid")
    teams = _human_teams(storage.list_league_teams(league["id"]))
    reserved = _pending_invite_team_ids(league["id"], teams)
    claimed = [t for t in teams if t.get("user_sub")]
    unclaimed = [t for t in teams if not t.get("user_sub") and str(t["id"]) not in reserved]
    team_count = int(league.get("team_count") or 12)
    open_create = max(0, team_count - len(teams))
    reserved_count = len(reserved)
    enabled = bool(league.get("claim_link_enabled", True))
    live = str(league.get("status") or "setup") == "live"
    completed = bool(league.get("draft_completed"))
    if not enabled:
        status = "disabled"
    elif live or completed:
        status = "closed"
    elif not unclaimed and open_create <= 0:
        status = "full"
    else:
        status = "open"

    your_team = None
    if user_sub:
        mine = storage.get_team_by_user(league["id"], user_sub)
        if mine:
            your_team = _public_team(mine)

    return {
        "status": status,
        "league_name": league.get("name"),
        "league_season": league.get("season"),
        "team_count": team_count,
        "claimed": len(claimed),
        "open_seats": max(0, team_count - len(claimed) - reserved_count),
        "can_create_seat": status == "open" and open_create > 0,
        "unclaimed_teams": [_public_team(t) for t in unclaimed],
        "claim_link_enabled": enabled,
        "already_member": bool(your_team),
        "your_team": your_team,
    }


def accept_claim_link(
    token: str,
    user_sub: str,
    *,
    team_id: str | None = None,
    team_name: str | None = None,
) -> dict[str, Any]:
    league = storage.get_league_by_claim_token(token)
    if not league:
        raise ValueError("Invite link is not valid")
    if not league.get("claim_link_enabled", True):
        raise ValueError("This league is not accepting invite links right now")
    if str(league.get("status") or "setup") == "live":
        raise ValueError("The draft already started")
    if league.get("draft_completed"):
        raise ValueError("This league already drafted")

    league_id = str(league["id"])
    existing = storage.get_team_by_user(league_id, user_sub)
    if existing:
        storage.set_hub_focus(user_sub, league_id=league_id)
        return {
            "league": storage.get_league(league_id),
            "team": existing,
            "already_member": True,
        }

    chosen_id = str(team_id or "").strip()
    chosen_name = str(team_name or "").strip()
    if chosen_id:
        team = storage.get_team(chosen_id)
        if not team or str(team.get("league_id")) != league_id:
            raise ValueError("That team is not in this league")
        if team.get("is_bot"):
            raise ValueError("That seat is a bot")
        if team.get("user_sub") and str(team["user_sub"]) != str(user_sub):
            raise ValueError("That team is already claimed")
        if _seat_reserved(league_id, team):
            raise ValueError("That seat is reserved for an invited manager")
        claimed = storage.assign_team_user(chosen_id, user_sub)
        storage.set_hub_focus(user_sub, league_id=league_id)
        return {
            "league": storage.get_league(league_id),
            "team": claimed,
            "already_member": False,
        }

    if chosen_name:
        named = next(
            (
                team
                for team in storage.list_league_teams(league_id)
                if str(team.get("name") or "").strip().lower() == chosen_name.lower()
            ),
            None,
        )
        if named and _seat_reserved(league_id, named):
            raise ValueError("That seat is reserved for an invited manager")
        claimed = storage.join_league(user_sub, str(league.get("room_code") or ""), chosen_name)
        storage.set_hub_focus(user_sub, league_id=league_id)
        return {
            "league": storage.get_league(league_id),
            "team": claimed,
            "already_member": False,
        }

    raise ValueError("Pick a team")
