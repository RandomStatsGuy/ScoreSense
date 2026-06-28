"""Shared SMTP delivery for invites and auth emails."""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from src.config import SMTP_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_TLS, SMTP_USER

logger = logging.getLogger(__name__)


def smtp_configured() -> bool:
    return bool(SMTP_HOST)


def send_email(
    to_email: str,
    *,
    subject: str,
    text_body: str,
    html_body: str | None = None,
) -> bool:
    """Send email via SMTP. Returns False when unconfigured or on failure (never raises)."""
    if not smtp_configured():
        return False
    to = str(to_email or "").strip()
    if not to:
        return False

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            if SMTP_TLS:
                smtp.starttls()
            if SMTP_USER and SMTP_PASSWORD:
                smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except Exception:
        logger.exception("SMTP send failed to %s", to)
        return False
