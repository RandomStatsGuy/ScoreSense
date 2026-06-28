"""Auth-related outbound email (verification, welcome, password reset)."""

from __future__ import annotations

from src.config import FRONTEND_URL
from src.email.smtp import send_email


def _frontend_base() -> str:
    return FRONTEND_URL.rstrip("/")


def send_verification_email(to_email: str, *, token: str, display_name: str) -> bool:
    url = f"{_frontend_base()}/api/auth/verify-email?token={token}"
    name = display_name or "there"
    body = "\n".join(
        [
            f"Hi {name},",
            "",
            "Confirm your email to use ScoreSense Draft Hub and save your league data.",
            "",
            f"Verify your email: {url}",
            "",
            "This link expires in 24 hours. If you did not create an account, you can ignore this email.",
        ]
    )
    return send_email(
        to_email,
        subject="Verify your ScoreSense email",
        text_body=body,
    )


def send_welcome_email(to_email: str, *, display_name: str) -> bool:
    name = display_name or "there"
    url = f"{_frontend_base()}/hub/setup"
    body = "\n".join(
        [
            f"Welcome to ScoreSense, {name}!",
            "",
            "Your email is verified. Open Draft Hub to configure your league, link Sleeper, and prep for draft day:",
            url,
            "",
            "Projections and tools are at the same site under Weekly, Season, and Tools.",
        ]
    )
    return send_email(
        to_email,
        subject="Welcome to ScoreSense",
        text_body=body,
    )


def send_password_reset_email(to_email: str, *, token: str, display_name: str) -> bool:
    url = f"{_frontend_base()}/auth/reset-password?token={token}"
    name = display_name or "there"
    body = "\n".join(
        [
            f"Hi {name},",
            "",
            "We received a request to reset your ScoreSense password.",
            "",
            f"Reset password: {url}",
            "",
            "This link expires in 1 hour. If you did not request a reset, ignore this email.",
        ]
    )
    return send_email(
        to_email,
        subject="Reset your ScoreSense password",
        text_body=body,
    )
