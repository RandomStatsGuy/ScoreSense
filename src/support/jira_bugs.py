"""Create SCORE Jira Bugs from in-app reports. Token stays on the server."""

from __future__ import annotations

from typing import Any

import requests

from src import config

USER_REPORT_LABELS = ("user-reported", "pickup")
REPORT_AREAS = ("Projections", "Fantasy", "Tools", "Account", "Sign in", "Other")


class JiraNotConfiguredError(RuntimeError):
    """JIRA_EMAIL / JIRA_API_TOKEN are missing."""


class JiraCreateError(RuntimeError):
    """Jira accepted the request shape but rejected the create."""


def jira_configured() -> bool:
    return bool(config.JIRA_EMAIL and config.JIRA_API_TOKEN)


def _issue_url() -> str:
    if config.JIRA_CLOUD_ID:
        return f"https://api.atlassian.com/ex/jira/{config.JIRA_CLOUD_ID}/rest/api/3/issue"
    return f"{config.JIRA_SITE}/rest/api/3/issue"


def browse_url(key: str) -> str:
    return f"{config.JIRA_SITE}/browse/{key}"


def _adf_heading(text: str, level: int = 2) -> dict[str, Any]:
    return {
        "type": "heading",
        "attrs": {"level": level},
        "content": [{"type": "text", "text": text}],
    }


def _adf_para(text: str) -> dict[str, Any]:
    body = str(text or "").strip()
    if not body:
        return {"type": "paragraph", "content": []}
    return {"type": "paragraph", "content": [{"type": "text", "text": body}]}


def build_bug_description(
    *,
    what_happened: str,
    expected: str,
    area: str,
    page_path: str,
    reporter_name: str,
    reporter_email: str,
    reporter_sub: str,
) -> dict[str, Any]:
    where = " · ".join(part for part in (area, page_path) if part)
    content = [
        _adf_heading("What happened"),
        _adf_para(what_happened),
        _adf_heading("Expected"),
        _adf_para(expected or "Not specified"),
        _adf_heading("Where"),
        _adf_para(where or "Not specified"),
        _adf_heading("Reporter"),
        _adf_para(
            " · ".join(
                part
                for part in (reporter_name, reporter_email, reporter_sub)
                if part
            )
            or "Signed-in account"
        ),
    ]
    return {"type": "doc", "version": 1, "content": content}


def build_bug_summary(title: str, area: str = "") -> str:
    clean_title = " ".join(str(title or "").split()).strip()
    clean_area = str(area or "").strip()
    if clean_area and clean_area in REPORT_AREAS and clean_area != "Other":
        summary = f"{clean_area}: {clean_title}"
    else:
        summary = clean_title
    return summary[:255]


def create_user_bug(
    *,
    summary: str,
    description: dict[str, Any],
    labels: tuple[str, ...] = USER_REPORT_LABELS,
    timeout_seconds: float = 12.0,
) -> dict[str, str]:
    """POST a Bug to SCORE. Returns {key, id, url}."""
    if not jira_configured():
        raise JiraNotConfiguredError("Jira is not configured")

    payload = {
        "fields": {
            "project": {"key": config.JIRA_PROJECT_KEY},
            "issuetype": {"name": config.JIRA_BUG_ISSUE_TYPE},
            "summary": summary,
            "description": description,
            "labels": list(labels),
        }
    }
    try:
        res = requests.post(
            _issue_url(),
            json=payload,
            auth=(config.JIRA_EMAIL, config.JIRA_API_TOKEN),
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=timeout_seconds,
        )
    except requests.RequestException as exc:
        raise JiraCreateError("Could not reach the board") from exc

    if res.status_code >= 400:
        raise JiraCreateError(f"Jira create failed ({res.status_code})")

    data = res.json()
    key = str(data.get("key") or "").strip()
    if not key:
        raise JiraCreateError("Jira create returned no key")
    return {
        "key": key,
        "id": str(data.get("id") or ""),
        "url": browse_url(key),
    }
