"""Create SCORE Jira Bugs from in-app reports. Token stays on the server."""

from __future__ import annotations

from typing import Any

import requests

from src import config
from src.ops.connection_store import ConnectionStoreError, connection_values

USER_REPORT_LABELS = ("user-reported", "pickup")
REPORT_AREAS = ("Projections", "Fantasy", "Tools", "Account", "Sign in", "Other")


class JiraNotConfiguredError(RuntimeError):
    """JIRA_EMAIL / JIRA_API_TOKEN are missing."""


class JiraCreateError(RuntimeError):
    """Jira accepted the request shape but rejected the create."""


def jira_configured() -> bool:
    try:
        return all(connection_values("jira").values())
    except ConnectionStoreError:
        return False


def check_jira_connection() -> dict:
    """Read project permissions without creating a test ticket."""
    values = connection_values("jira")
    if not all(values.values()):
        return {"ok": False, "message": "Save the Jira account email and API token first."}
    try:
        res = requests.get(_issue_url().removesuffix("/issue") + "/mypermissions",
                           params={"projectKey": config.JIRA_PROJECT_KEY,
                                   "permissions": "BROWSE_PROJECTS,CREATE_ISSUES"},
                           auth=(values["email"], values["api_token"]),
                           headers={"Accept": "application/json"}, timeout=12, allow_redirects=False)
        if res.status_code in (401, 403):
            return {"ok": False, "message": "Jira rejected these credentials or their access. Check the email, token and project access."}
        if res.status_code != 200:
            return {"ok": False, "message": "Could not check Jira right now. Try again later."}
        permissions = res.json().get("permissions", {})
        if not all(permissions.get(key, {}).get("havePermission") is True
                   for key in ("BROWSE_PROJECTS", "CREATE_ISSUES")):
            return {"ok": False, "message": "This Jira account needs Browse Projects and Create Issues access to the report project."}
    except (requests.RequestException, ValueError, AttributeError):
        return {"ok": False, "message": "Could not check Jira right now. Try again later."}
    return {"ok": True, "message": "Jira connection checked. This account can create issues in the report project. No test report was sent."}


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
    try:
        credentials = connection_values("jira")
    except ConnectionStoreError:
        raise JiraNotConfiguredError("Saved Jira connection unavailable") from None
    if not all(credentials.values()):
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
            auth=(credentials["email"], credentials["api_token"]),
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
