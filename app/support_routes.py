"""In-app bug reports → SCORE Jira pickup board."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import is_guest_user, optional_user
from src.auth.rate_limit import check_rate_limit
from src.support.jira_bugs import (
    REPORT_AREAS,
    JiraCreateError,
    JiraNotConfiguredError,
    build_bug_description,
    build_bug_summary,
    create_user_bug,
    jira_configured,
)

router = APIRouter(prefix="/api/support", tags=["support"])

_TITLE_MIN = 8
_TITLE_MAX = 120
_BODY_MIN = 20
_BODY_MAX = 4000
_EXPECTED_MAX = 2000
_PATH_MAX = 200


class BugReportBody(BaseModel):
    title: str = Field(min_length=1, max_length=_TITLE_MAX)
    what_happened: str = Field(min_length=1, max_length=_BODY_MAX)
    expected: str = Field(default="", max_length=_EXPECTED_MAX)
    area: str = Field(default="Other", max_length=32)
    page_path: str = Field(default="", max_length=_PATH_MAX)


def require_report_user(request: Request) -> dict[str, Any]:
    """Real signed-in account only. Never the shared local `dev` fallback."""
    user = optional_user(request)
    if not user or user.get("sub") == "dev" or user.get("auth_type") == "dev":
        raise HTTPException(status_code=401, detail="Sign in to send a report")
    if is_guest_user(user):
        raise HTTPException(
            status_code=403,
            detail="Draft-night guests cannot send reports. Sign in with a full account.",
        )
    return user


def _client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "unknown")


def _rate_limit_report(request: Request, user: dict[str, Any]) -> None:
    sub = str(user.get("sub") or "unknown")
    ip = _client_ip(request)
    if not check_rate_limit(f"bug-report:sub:{sub}", max_calls=5, window_seconds=3600):
        raise HTTPException(
            status_code=429,
            detail="Too many reports from this account. Try again later.",
        )
    if not check_rate_limit(f"bug-report:ip:{ip}", max_calls=20, window_seconds=3600):
        raise HTTPException(
            status_code=429,
            detail="Too many reports from this account. Try again later.",
        )


def _clean_title(raw: str) -> str:
    title = " ".join(str(raw or "").split()).strip()
    if len(title) < _TITLE_MIN:
        raise HTTPException(status_code=400, detail="Give the report a short title.")
    return title[:_TITLE_MAX]


def _clean_body(raw: str) -> str:
    body = str(raw or "").strip()
    if len(body) < _BODY_MIN:
        raise HTTPException(status_code=400, detail="Say what broke in a sentence or two.")
    return body[:_BODY_MAX]


def _clean_area(raw: str) -> str:
    area = str(raw or "").strip()
    return area if area in REPORT_AREAS else "Other"


def _clean_path(raw: str) -> str:
    path = str(raw or "").strip()
    if not path:
        return ""
    if not path.startswith("/") or path.startswith("//") or "://" in path:
        return ""
    return path.split("?")[0][:_PATH_MAX]


@router.get("/bugs/status")
def bug_report_status() -> dict[str, bool]:
    return {"enabled": jira_configured()}


@router.post("/bugs")
def create_bug_report(
    body: BugReportBody,
    request: Request,
    user: dict[str, Any] = Depends(require_report_user),
) -> dict[str, str]:
    _rate_limit_report(request, user)
    title = _clean_title(body.title)
    what_happened = _clean_body(body.what_happened)
    expected = str(body.expected or "").strip()[:_EXPECTED_MAX]
    area = _clean_area(body.area)
    page_path = _clean_path(body.page_path)
    summary = build_bug_summary(title, area)
    description = build_bug_description(
        what_happened=what_happened,
        expected=expected,
        area=area,
        page_path=page_path,
        reporter_name=str(user.get("name") or "").strip(),
        reporter_email=str(user.get("email") or "").strip(),
        reporter_sub=str(user.get("sub") or "").strip(),
    )
    try:
        created = create_user_bug(summary=summary, description=description)
    except JiraNotConfiguredError as exc:
        raise HTTPException(
            status_code=503,
            detail="The board is not taking reports right now.",
        ) from exc
    except JiraCreateError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not file this report. Try again in a minute.",
        ) from exc
    return {
        "key": created["key"],
        "url": created["url"],
    }
