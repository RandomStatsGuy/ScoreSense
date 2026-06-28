"""Outbound email delivery."""

from src.email.smtp import send_email, smtp_configured

__all__ = ["send_email", "smtp_configured"]
