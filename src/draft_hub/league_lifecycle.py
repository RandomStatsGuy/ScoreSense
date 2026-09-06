"""Commissioner league delete — every current commissioner must agree."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from src.draft_hub import storage
from src.draft_hub.league_export import league_name_matches


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class LeagueDeleteError(Exception):
    def __init__(self, detail: str, *, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def list_league_commissioners(league_id: str) -> list[dict[str, Any]]:
    league = storage.get_league(league_id)
    if not league:
        return []
    primary = str(league.get("commissioner_sub") or "")
    by_sub: dict[str, dict[str, Any]] = {}
    for team in storage.list_league_teams(league_id):
        sub = str(team.get("user_sub") or "")
        if not sub:
            continue
        if not (team.get("is_commissioner") or sub == primary):
            continue
        by_sub[sub] = {
            "user_sub": sub,
            "team_id": team.get("id"),
            "owner_name": team.get("owner_name") or team.get("name") or "Commissioner",
            "team_name": team.get("name"),
            "is_primary": sub == primary,
        }
    if primary and primary not in by_sub:
        by_sub[primary] = {
            "user_sub": primary,
            "team_id": None,
            "owner_name": "Commissioner",
            "team_name": None,
            "is_primary": True,
        }
    return sorted(
        by_sub.values(),
        key=lambda row: (not row["is_primary"], str(row.get("owner_name") or "").lower()),
    )


def viewer_sub_from_team(league_id: str, team_id: str | None) -> str | None:
    if not team_id:
        return None
    for team in storage.list_league_teams(league_id):
        if str(team.get("id")) == str(team_id):
            sub = str(team.get("user_sub") or "")
            return sub or None
    return None


def delete_request_snapshot(
    league_id: str,
    *,
    viewer_sub: str | None = None,
    viewer_team_id: str | None = None,
) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise LeagueDeleteError("League not found", status_code=404)
    if not viewer_sub:
        viewer_sub = viewer_sub_from_team(league_id, viewer_team_id)
    commissioners = list_league_commissioners(league_id)
    pending = _pending_request(league_id)
    approvals = _approvals_for(pending["id"]) if pending else {}
    staff = []
    for row in commissioners:
        staff.append(
            {
                **row,
                "approved": row["user_sub"] in approvals,
                "is_you": bool(viewer_sub) and row["user_sub"] == viewer_sub,
            }
        )
    approved_count = sum(1 for row in staff if row["approved"])
    required = len(staff)
    you_approved = bool(viewer_sub) and viewer_sub in approvals
    starter_name = None
    if pending:
        starter_name = next(
            (row["owner_name"] for row in staff if row["user_sub"] == pending["started_by_sub"]),
            "A commissioner",
        )
    waiting = [row["owner_name"] for row in staff if not row["approved"]]
    return {
        "league_id": league_id,
        "league_name": league.get("name"),
        "pending": bool(pending),
        "request": (
            {
                "id": pending["id"],
                "started_by_sub": pending["started_by_sub"],
                "started_by_name": starter_name,
                "created_at": pending["created_at"],
            }
            if pending
            else None
        ),
        "commissioners": staff,
        "approved_count": approved_count,
        "required_count": required,
        "waiting_names": waiting,
        "you_approved": you_approved,
        "can_start": not pending,
        "can_approve": bool(pending) and not you_approved,
        "can_cancel": bool(pending),
    }


def start_league_delete(league_id: str, *, actor_sub: str, confirm_name: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise LeagueDeleteError("League not found", status_code=404)
    _require_commissioner_sub(league_id, actor_sub)
    if not league_name_matches(confirm_name, str(league.get("name") or "")):
        raise LeagueDeleteError("Type the league name to delete it.")
    if _pending_request(league_id):
        raise LeagueDeleteError(
            "A delete is already waiting on every commissioner.",
            status_code=409,
        )
    now = _utcnow()
    request_id = str(uuid.uuid4())
    with storage.get_conn() as conn:
        conn.execute(
            """INSERT INTO league_delete_request
               (id, league_id, started_by_sub, status, created_at, updated_at)
               VALUES (?, ?, ?, 'pending', ?, ?)""",
            (request_id, league_id, actor_sub, now, now),
        )
        conn.execute(
            """INSERT INTO league_delete_approval (request_id, user_sub, approved_at)
               VALUES (?, ?, ?)""",
            (request_id, actor_sub, now),
        )
    return _finish_if_unanimous(league_id, actor_sub)


def approve_league_delete(league_id: str, *, actor_sub: str, confirm_name: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise LeagueDeleteError("League not found", status_code=404)
    _require_commissioner_sub(league_id, actor_sub)
    if not league_name_matches(confirm_name, str(league.get("name") or "")):
        raise LeagueDeleteError("Type the league name to delete it.")
    pending = _pending_request(league_id)
    if not pending:
        raise LeagueDeleteError("No delete is waiting.")
    now = _utcnow()
    with storage.get_conn() as conn:
        conn.execute(
            """INSERT INTO league_delete_approval (request_id, user_sub, approved_at)
               VALUES (?, ?, ?)
               ON CONFLICT(request_id, user_sub) DO UPDATE SET approved_at = excluded.approved_at""",
            (pending["id"], actor_sub, now),
        )
        conn.execute(
            "UPDATE league_delete_request SET updated_at = ? WHERE id = ?",
            (now, pending["id"]),
        )
    return _finish_if_unanimous(league_id, actor_sub)


def cancel_league_delete(league_id: str, *, actor_sub: str) -> dict[str, Any]:
    _require_commissioner_sub(league_id, actor_sub)
    pending = _pending_request(league_id)
    if not pending:
        raise LeagueDeleteError("No delete is waiting.")
    now = _utcnow()
    with storage.get_conn() as conn:
        conn.execute(
            "UPDATE league_delete_request SET status = 'cancelled', updated_at = ? WHERE id = ?",
            (now, pending["id"]),
        )
    return delete_request_snapshot(league_id, viewer_sub=actor_sub)


def _finish_if_unanimous(league_id: str, actor_sub: str) -> dict[str, Any]:
    snap = delete_request_snapshot(league_id, viewer_sub=actor_sub)
    if snap["required_count"] > 0 and snap["approved_count"] >= snap["required_count"]:
        deleted = storage.delete_league(league_id)
        return {
            "deleted": True,
            "deleted_league_id": deleted["deleted_league_id"],
            "league_name": deleted.get("league_name"),
            "teams_removed": deleted.get("teams_removed"),
        }
    return {"deleted": False, **snap}


def _require_commissioner_sub(league_id: str, user_sub: str) -> None:
    staff = {row["user_sub"] for row in list_league_commissioners(league_id)}
    if user_sub not in staff:
        raise LeagueDeleteError("Commissioner managed", status_code=403)


def _pending_request(league_id: str) -> dict[str, Any] | None:
    with storage.get_conn() as conn:
        row = conn.execute(
            """SELECT * FROM league_delete_request
               WHERE league_id = ? AND status = 'pending'
               ORDER BY created_at DESC LIMIT 1""",
            (league_id,),
        ).fetchone()
    return dict(row) if row else None


def _approvals_for(request_id: str) -> dict[str, str]:
    with storage.get_conn() as conn:
        rows = conn.execute(
            "SELECT user_sub, approved_at FROM league_delete_approval WHERE request_id = ?",
            (request_id,),
        ).fetchall()
    return {str(r["user_sub"]): r["approved_at"] for r in rows}
