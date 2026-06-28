"""League invite URLs and optional email delivery."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from src.config import FRONTEND_URL
from src.email.smtp import send_email
from src.auth.user_store import normalize_email, validate_email
from src.draft_hub import storage


def invite_expires_at(days: int = 14) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def build_invite_url(token: str) -> str:
    base = FRONTEND_URL.rstrip("/")
    return f"{base}/?invite={token}"


def create_invite(
    league_id: str,
    email: str,
    team_name: str,
    invited_by_sub: str,
) -> dict:
    validate_email(email)
    token = secrets.token_urlsafe(32)
    invite = storage.create_league_invite(
        league_id,
        email,
        team_name,
        invited_by_sub,
        token=token,
        expires_at=invite_expires_at(),
    )
    invite["invite_url"] = build_invite_url(token)
    invite["email_sent"] = send_invite_email(
        normalize_email(email),
        league_name=invite.get("league_name") or storage.get_league(league_id).get("name", "your league"),
        team_name=invite["team_name"],
        invite_url=invite["invite_url"],
    )
    return invite


def send_invite_email(to_email: str, *, league_name: str, team_name: str, invite_url: str) -> bool:
    body = "\n".join(
        [
            f"You've been invited to manage {team_name} in {league_name} on ScoreSense Draft Hub.",
            "",
            "Create a free ScoreSense account (or sign in) with this email address, then open:",
            invite_url,
            "",
            "Sleeper still runs scoring and roster moves — Draft Hub tracks contracts and cap for your league.",
        ]
    )
    return send_email(
        to_email,
        subject=f"Join {league_name} on ScoreSense Draft Hub",
        text_body=body,
    )
