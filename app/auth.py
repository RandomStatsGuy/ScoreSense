"""Patreon OAuth + ScoreSense accounts + JWT sessions."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import urllib.parse
import uuid
import base64
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import requests
from fastapi import HTTPException, Request

from src.auth import user_store
from src.auth.email_flow import send_password_reset_email, send_verification_email, send_welcome_email
from src.config import (
    AUTH_REQUIRED,
    FRONTEND_URL,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
    HUB_AUTH_REQUIRED,
    JWT_ALGORITHM,
    JWT_DAYS,
    JWT_SECRET,
    ADMIN_EMAILS,
    PATREON_CAMPAIGN_ID,
    PATREON_CLIENT_ID,
    PATREON_CLIENT_SECRET,
    PATREON_MIN_CENTS,
    PATREON_REDIRECT_URI,
    PRIVACY_URL,
    TERMS_URL,
    TERMS_VERSION,
)
from src.email.smtp import smtp_configured

PATREON_API = "https://www.patreon.com/api/oauth2/v2"

_NATIVE_SUB_PREFIX = "ss:"
_GUEST_SUB_PREFIX = "guest:"
_GUEST_JWT_DAYS = 7
_GUEST_LEAGUE_PATH = re.compile(r"^/api/hub/league/([^/]+)(.*)$")
_GUEST_WS_PATH = re.compile(r"^/api/hub/ws/([^/]+)")
_GUEST_LEAGUE_RESTS = {
    "",
    "/nomination-pool",
    "/nomination-queue",
    "/bid",
    "/nominate",
    "/pick",
    "/draft-recap",
    "/lobby/slot",
    "/lobby/name",
    "/trades",
}


def auth_enabled() -> bool:
    from src.config import AUTH_REQUIRED as _auth_required
    return _auth_required


def hub_auth_enabled() -> bool:
    from src.config import HUB_AUTH_REQUIRED as _hub_auth_required
    return _hub_auth_required


def patreon_configured() -> bool:
    return bool(PATREON_CLIENT_ID and PATREON_CLIENT_SECRET)


def google_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)


def admin_configured() -> bool:
    return bool(ADMIN_EMAILS)


def is_admin_user(user: dict[str, Any] | None) -> bool:
    if not user or not ADMIN_EMAILS:
        return False
    email = str(user.get("email") or "").strip().lower()
    return bool(email and email in ADMIN_EMAILS)


def require_admin(request: Request) -> dict[str, Any]:
    if not admin_configured():
        raise HTTPException(
            status_code=503,
            detail="Admin portal not configured. Set ADMIN_EMAILS in server .env",
        )
    user = require_hub_user(request) if hub_auth_enabled() else require_patron(request)
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    if not is_admin_user(user):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _hash_password(password: str) -> str:
    user_store.validate_password(password)
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return f"pbkdf2_sha256$120000${salt.hex()}${digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, digest_hex = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def register_native_user(
    email: str,
    password: str,
    display_name: str | None = None,
    *,
    accept_terms: bool = False,
) -> dict[str, Any]:
    if not accept_terms:
        raise ValueError("You must accept the Terms of Service and Privacy Policy")
    user_store.validate_email(email)
    user_store.validate_password(password)
    password_hash = _hash_password(password)
    user = user_store.create_user(
        email,
        password_hash,
        display_name or "",
        terms_version=TERMS_VERSION,
    )
    token = user_store.create_email_token(user["id"], "verify", hours=24)
    send_verification_email(user["email"], token=token, display_name=user["display_name"])
    return user


def verify_email_token(token: str) -> dict[str, Any] | None:
    user = user_store.consume_email_token(token, "verify")
    if not user:
        return None
    was_verified = user_store.is_email_verified(user)
    user = user_store.mark_email_verified(user["id"]) or user
    if not was_verified:
        send_welcome_email(user["email"], display_name=user["display_name"])
    return user


def request_password_reset(email: str) -> None:
    row = user_store.get_user_by_email(email)
    if not row:
        return
    token = user_store.create_email_token(row["id"], "reset", hours=1)
    send_password_reset_email(row["email"], token=token, display_name=row["display_name"])


def reset_password_with_token(token: str, new_password: str) -> dict[str, Any] | None:
    user_store.validate_password(new_password)
    user = user_store.consume_email_token(token, "reset")
    if not user:
        return None
    user_store.update_password(user["id"], _hash_password(new_password))
    return user_store.get_user_by_id(user["id"])


def resend_verification_email(user_id: str) -> bool:
    user = user_store.get_user_by_id(user_id)
    if not user or user_store.is_email_verified(user):
        return False
    token = user_store.create_email_token(user["id"], "verify", hours=24)
    return send_verification_email(user["email"], token=token, display_name=user["display_name"])


def user_terms_current(user_row: dict[str, Any] | None) -> bool:
    if not user_row:
        return True
    accepted = str(user_row.get("terms_version") or "").strip()
    return accepted == TERMS_VERSION


def native_user_terms_current(jwt_user: dict[str, Any]) -> bool:
    if jwt_user.get("auth_type") != "native":
        return True
    user_id = resolve_native_user_id(jwt_user)
    if not user_id:
        return True
    row = user_store.get_user_by_id(user_id)
    return user_terms_current(row)


def change_native_password(user_id: str, current_password: str, new_password: str) -> dict[str, Any]:
    user = user_store.get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    row = user_store.get_user_by_email(user["email"])
    if not row or not _verify_password(current_password, row["password_hash"]):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user_store.validate_password(new_password)
    user_store.update_password(user_id, _hash_password(new_password))
    return user_store.get_user_by_id(user_id) or user


def update_native_profile(user_id: str, display_name: str) -> dict[str, Any]:
    try:
        updated = user_store.update_display_name(user_id, display_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Account not found")
    return updated


def update_native_sms_opt_in(user_id: str, phone: str) -> dict[str, Any]:
    try:
        updated = user_store.update_sms_opt_in(user_id, phone)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Account not found")
    return updated


def accept_native_terms(user_id: str) -> dict[str, Any]:
    updated = user_store.accept_terms(user_id, TERMS_VERSION)
    if not updated:
        raise HTTPException(status_code=404, detail="Account not found")
    return updated


def delete_native_account(
    user_id: str,
    password: str = "",
    *,
    confirm_email: str | None = None,
) -> None:
    row = user_store.get_user_by_id(user_id)
    if not row:
        raise HTTPException(status_code=404, detail="Account not found")
    full = user_store.get_user_by_email(row["email"])
    if not full:
        raise HTTPException(status_code=404, detail="Account not found")
    if user_store.has_usable_password(full):
        if not _verify_password(password, full["password_hash"]):
            raise HTTPException(status_code=400, detail="Password is incorrect")
    elif user_store.normalize_email(confirm_email or "") != full["email"]:
        raise HTTPException(status_code=400, detail="Type your account email to confirm")
    if not user_store.delete_user(user_id):
        raise HTTPException(status_code=404, detail="Account not found")


def native_user_id_from_sub(sub: str) -> str | None:
    if not is_native_sub(sub):
        return None
    return str(sub)[len(_NATIVE_SUB_PREFIX):]


def resolve_native_user_id(
    jwt_user: dict[str, Any] | None,
    *,
    email_hint: str | None = None,
) -> str | None:
    """Resolve native account id from JWT sub, falling back to email lookup."""
    if not jwt_user or jwt_user.get("auth_type") != "native":
        return None
    user_id = native_user_id_from_sub(str(jwt_user.get("sub") or ""))
    if user_id and user_store.get_user_by_id(user_id):
        return user_id
    for hint in (email_hint, jwt_user.get("email")):
        if not hint:
            continue
        row = user_store.get_user_by_email(str(hint))
        if row:
            return row["id"]
    return None


def native_account_row(jwt_user: dict[str, Any] | None) -> dict[str, Any] | None:
    """Load the native account row for a JWT user, or None if the session is orphaned."""
    if not jwt_user or jwt_user.get("auth_type") != "native":
        return None
    user_id = resolve_native_user_id(jwt_user)
    if user_id:
        row = user_store.get_user_by_id(user_id)
        if row:
            return row
    email = jwt_user.get("email")
    if email:
        return user_store.get_user_by_email(str(email))
    return None


def native_email_verified(jwt_user: dict[str, Any]) -> bool:
    if jwt_user.get("auth_type") != "native":
        return True
    row = native_account_row(jwt_user)
    if not row:
        return False
    return user_store.is_email_verified(row)


def sign_oauth_state(next_path: str) -> str:
    """HMAC-signed return path for Patreon OAuth state param."""
    safe_next = (next_path or "/projections/weekly").strip()
    if not safe_next.startswith("/"):
        safe_next = f"/{safe_next}"
    payload = base64.urlsafe_b64encode(safe_next.encode("utf-8")).decode("ascii").rstrip("=")
    sig = hmac.new(JWT_SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).hexdigest()[:16]
    return f"{payload}.{sig}"


def verify_oauth_state(state: str | None) -> str:
    if not state or "." not in state:
        return "/projections/weekly"
    payload, sig = state.rsplit(".", 1)
    expected = hmac.new(JWT_SECRET.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).hexdigest()[:16]
    if not hmac.compare_digest(expected, sig):
        return "/projections/weekly"
    pad = "=" * (-len(payload) % 4)
    try:
        path = base64.urlsafe_b64decode(payload + pad).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return "/projections/weekly"
    if not path.startswith("/"):
        return "/projections/weekly"
    return path


def authenticate_native_user(email: str, password: str) -> dict[str, Any]:
    row = user_store.get_user_by_email(email)
    if not row:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user_store.has_usable_password(row):
        raise HTTPException(
            status_code=401,
            detail="This account uses Google. Continue with Google, or set a password from Forgot password.",
        )
    if not _verify_password(password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row["display_name"],
    }


def native_user_sub(user_id: str) -> str:
    return f"{_NATIVE_SUB_PREFIX}{user_id}"


def is_native_sub(sub: str) -> bool:
    return str(sub).startswith(_NATIVE_SUB_PREFIX)


def is_guest_sub(sub: str | None) -> bool:
    return str(sub or "").startswith(_GUEST_SUB_PREFIX)


def is_guest_user(user: dict[str, Any] | None) -> bool:
    if not user:
        return False
    return user.get("auth_type") == "guest" or is_guest_sub(user.get("sub"))


def create_guest_access_token(
    *,
    league_id: str,
    team_id: str,
    name: str,
    guest_id: str | None = None,
) -> tuple[str, str]:
    """Return (jwt, guest_sub) scoped to one draft room."""
    gid = str(guest_id or uuid.uuid4())
    sub = f"{_GUEST_SUB_PREFIX}{gid}"
    exp = datetime.now(timezone.utc) + timedelta(days=_GUEST_JWT_DAYS)
    payload = {
        "sub": sub,
        "auth_type": "guest",
        "name": name,
        "league_id": str(league_id),
        "team_id": str(team_id),
        "exp": exp,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM), sub


def guest_request_allowed(request: Request, user: dict[str, Any]) -> bool:
    """Guests may only touch the room they joined — not the rest of Draft Hub."""
    path = str(getattr(request.url, "path", "") or "")
    league_id = str(user.get("league_id") or "")
    if path.startswith("/api/hub/lobby/"):
        return True
    if path.startswith("/api/hub/draft-room/"):
        return True
    ws = _GUEST_WS_PATH.match(path)
    if ws:
        return bool(league_id) and ws.group(1) == league_id
    match = _GUEST_LEAGUE_PATH.match(path)
    if not match:
        return False
    if not league_id or match.group(1) != league_id:
        return False
    return (match.group(2) or "") in _GUEST_LEAGUE_RESTS


def google_authorize_url(state: str | None = None) -> str:
    state = state or secrets.token_urlsafe(16)
    params = {
        "response_type": "code",
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "include_granted_scopes": "true",
        "prompt": "select_account",
    }
    return f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"


def exchange_google_code(code: str) -> str:
    response = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def fetch_google_identity(access_token: str) -> dict[str, Any]:
    response = requests.get(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    response.raise_for_status()
    data = response.json() or {}
    email = str(data.get("email") or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="Google did not return an email address")
    if data.get("email_verified") is False:
        raise HTTPException(status_code=400, detail="Verify your Google email, then try again")
    return {
        "id": str(data.get("sub") or ""),
        "email": email,
        "name": data.get("name") or data.get("given_name") or email.split("@")[0],
    }


def upsert_google_user(identity: dict[str, Any]) -> dict[str, Any]:
    """Find or create a native account for a verified Google identity."""
    google_sub = str(identity.get("id") or "").strip()
    email = str(identity.get("email") or "").strip()
    if not google_sub:
        raise HTTPException(status_code=400, detail="Google account is missing an id")
    existing = user_store.get_user_by_google_sub(google_sub)
    if existing:
        return existing
    by_email = user_store.get_user_by_email(email)
    if by_email:
        # Unverified email+password rows can be squatters. Google proves the
        # mailbox, so take the row but drop the password they never owned.
        disable_password = not user_store.is_email_verified(by_email)
        try:
            linked = user_store.link_google_sub(
                by_email["id"],
                google_sub,
                disable_password=disable_password,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return linked or by_email
    dummy = _hash_password(secrets.token_urlsafe(24))
    try:
        return user_store.create_google_user(
            email,
            dummy,
            identity.get("name") or "",
            google_sub,
            terms_version=TERMS_VERSION,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def patreon_authorize_url(state: str | None = None) -> str:
    state = state or secrets.token_urlsafe(16)
    params = {
        "response_type": "code",
        "client_id": PATREON_CLIENT_ID,
        "redirect_uri": PATREON_REDIRECT_URI,
        "scope": "identity identity[email]",
        "state": state,
    }
    return f"https://www.patreon.com/oauth2/authorize?{urllib.parse.urlencode(params)}"


def exchange_patreon_code(code: str) -> str:
    response = requests.post(
        "https://www.patreon.com/api/oauth2/token",
        data={
            "code": code,
            "grant_type": "authorization_code",
            "client_id": PATREON_CLIENT_ID,
            "client_secret": PATREON_CLIENT_SECRET,
            "redirect_uri": PATREON_REDIRECT_URI,
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def _active_membership(memberships: list[dict], included: list[dict]) -> bool:
    campaign_ids = {PATREON_CAMPAIGN_ID} if PATREON_CAMPAIGN_ID else set()
    tier_map = {item["id"]: item for item in included if item.get("type") == "tier"}

    for member in memberships:
        attrs = member.get("attributes") or {}
        status = attrs.get("patron_status")
        cents = int(attrs.get("currently_entitled_amount_cents") or 0)
        if status != "active_patron" or cents < PATREON_MIN_CENTS:
            continue
        if not campaign_ids:
            return True
        rel = member.get("relationships") or {}
        campaign_data = (rel.get("campaign") or {}).get("data") or {}
        if str(campaign_data.get("id")) in campaign_ids:
            return True
    return False


def fetch_patron_identity(access_token: str) -> dict[str, Any]:
    params = {
        "include": "memberships,memberships.currently_entitled_tiers",
        "fields[user]": "full_name,email,image_url",
        "fields[member]": "patron_status,currently_entitled_amount_cents,lifetime_support_cents",
    }
    response = requests.get(
        f"{PATREON_API}/identity",
        headers={"Authorization": f"Bearer {access_token}"},
        params=params,
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    data = payload.get("data") or {}
    included = payload.get("included") or []
    memberships = [i for i in included if i.get("type") == "member"]
    if not _active_membership(memberships, included):
        raise HTTPException(status_code=403, detail="Active Patreon membership required")
    attrs = data.get("attributes") or {}
    return {
        "id": data.get("id"),
        "name": attrs.get("full_name") or "Patron",
        "email": attrs.get("email"),
        "image_url": attrs.get("image_url"),
    }


def create_access_token(user: dict[str, Any], *, auth_type: str = "patreon") -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=JWT_DAYS)
    if auth_type == "native":
        sub = native_user_sub(str(user["id"]))
        payload = {
            "sub": sub,
            "auth_type": "native",
            "name": user.get("display_name") or user.get("name") or "User",
            "email": user.get("email"),
            "exp": exp,
        }
    else:
        payload = {
            "sub": str(user["id"]),
            "auth_type": "patreon",
            "name": user.get("name"),
            "email": user.get("email"),
            "exp": exp,
        }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session") from exc


def decode_token_or_none(token: str) -> dict[str, Any] | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None


def ws_user_from_token(token: str | None) -> dict[str, Any] | None:
    """Resolve JWT payload for WebSocket handshake (?token= query param)."""
    if hub_auth_enabled():
        if not token:
            return None
        return decode_token_or_none(token)
    if token:
        return decode_token_or_none(token) or {"sub": "dev", "auth_type": "dev", "name": "Dev"}
    return {"sub": "dev", "auth_type": "dev", "name": "Dev"}


def token_from_request(request: Request) -> str | None:
    auth = request.headers.get("Authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth.split(" ", 1)[1].strip()
    return request.cookies.get("scoresense_token")


def optional_user(request: Request) -> dict[str, Any] | None:
    token = token_from_request(request)
    if not token:
        return None
    try:
        return decode_access_token(token)
    except HTTPException:
        return None


def require_patron(request: Request) -> dict[str, Any] | None:
    if not auth_enabled():
        return optional_user(request)
    token = token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Login required")
    return decode_access_token(token)


def require_hub_user(request: Request) -> dict[str, Any]:
    """Draft Hub always needs a stable account — never the shared dev fallback."""
    if not hub_auth_enabled():
        user = optional_user(request)
        if user:
            if is_guest_user(user) and not guest_request_allowed(request, user):
                raise HTTPException(
                    status_code=403,
                    detail="Guest sessions can only use the draft room they joined.",
                )
            return user
        return {"sub": "dev", "auth_type": "dev", "name": "Dev"}
    token = token_from_request(request)
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Sign in or create a ScoreSense account to use Draft Hub",
        )
    user = decode_access_token(token)
    if is_guest_user(user):
        if not guest_request_allowed(request, user):
            raise HTTPException(
                status_code=403,
                detail="Guest sessions can only use the draft room they joined.",
            )
        return user
    if user.get("auth_type") == "native" and not native_email_verified(user):
        raise HTTPException(
            status_code=403,
            detail="Verify your email before using Draft Hub. Check your inbox or resend from account settings.",
        )
    return user


def session_user_public(user: dict[str, Any] | None) -> dict[str, Any] | None:
    if not user:
        return None
    native_row = native_account_row(user) if user.get("auth_type") == "native" else None
    verified = user_store.is_email_verified(native_row) if native_row else True
    if user.get("auth_type") == "native" and native_row is None:
        verified = False
    terms_current = native_user_terms_current(user)
    terms_version = native_row.get("terms_version") if native_row else None
    return {
        "sub": user.get("sub"),
        "name": user.get("name"),
        "email": user.get("email"),
        "auth_type": user.get("auth_type") or "patreon",
        "is_admin": is_admin_user(user),
        "email_verified": verified,
        "account_found": native_row is not None if user.get("auth_type") == "native" else True,
        "terms_current": terms_current,
        "terms_version": terms_version,
        "has_password": user_store.has_usable_password(native_row) if native_row else False,
        "google_linked": bool(native_row.get("google_sub")) if native_row else False,
        "phone": native_row.get("phone") if native_row else None,
        "sms_opted_in": bool(native_row.get("sms_opted_in_at")) if native_row else False,
    }


def auth_public_config() -> dict[str, Any]:
    return {
        "terms_url": TERMS_URL,
        "privacy_url": PRIVACY_URL,
        "terms_version": TERMS_VERSION,
        "smtp_configured": smtp_configured(),
    }
