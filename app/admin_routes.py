"""Site admin API — league/user management (ADMIN_EMAILS allowlist)."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth import is_native_sub, native_user_sub, require_admin
from src.auth import user_store
from src.draft_hub import storage
from src.draft_hub.hub_context import resolve_hub_context
from src.draft_hub.league_invites import build_invite_url, create_invite
from src.draft_hub.presets import load_preset
from src.draft_hub.schemas import LeagueRules

router = APIRouter(prefix="/api/admin", tags=["admin"])

_SYSTEM_HUB_SUBS = frozenset({"dev", "dummy", "comm-filter-debug"})


def _is_system_hub_sub(user_sub: str) -> bool:
    s = str(user_sub or "").strip()
    if not s:
        return True
    if s.startswith("bot:"):
        return True
    return s in _SYSTEM_HUB_SUBS


def _is_test_account_email(email: str | None) -> bool:
    e = str(email or "").strip().lower()
    return not e or e.endswith("@example.com") or e.endswith("@example.org")


def _is_test_membership(m: dict) -> bool:
    if m.get("test_mode") in (True, 1, "1", "true", "True"):
        return True
    name = str(m.get("league_name") or "").lower()
    return "mock draft" in name or "(test)" in name


def _filter_memberships(
    memberships: list[dict],
    *,
    include_test: bool,
) -> list[dict]:
    if include_test:
        return memberships
    return [m for m in memberships if not _is_test_membership(m)]


def _enrich_sub(user_sub: str) -> dict:
    all_memberships = storage.list_memberships_for_sub(user_sub)
    test_hidden = sum(1 for m in all_memberships if _is_test_membership(m))
    ws = storage.get_or_create_workspace(user_sub)
    return {
        "user_sub": user_sub,
        "email": _email_for_sub(user_sub),
        "auth_type": "native" if is_native_sub(user_sub) else "patreon",
        "workspace_id": ws.get("id"),
        "workspace_season": ws.get("season"),
        "memberships": all_memberships,
        "membership_count": len(all_memberships),
        "live_membership_count": len(all_memberships) - test_hidden,
        "test_membership_count": test_hidden,
    }


class AdminTransferCommissionerRequest(BaseModel):
    commissioner_email: Optional[str] = None
    commissioner_sub: Optional[str] = None


class AdminLeagueInviteRequest(BaseModel):
    email: str
    team_name: str


class AdminLinkTeamRequest(BaseModel):
    email: Optional[str] = None
    user_sub: Optional[str] = None


class AdminLeagueCreateRequest(BaseModel):
    name: str
    season: int = Field(ge=2015, le=2035)
    team_count: int = Field(default=12, ge=2, le=32)
    commissioner_email: Optional[str] = None
    commissioner_sub: Optional[str] = None
    commissioner_team_name: str = "Commissioner"
    preset_id: str = "salary_cap_auction_v1"
    test_mode: bool = False


def _resolve_account_sub(
    email: str | None,
    sub: str | None,
    *,
    required: str = "email or user_sub required",
) -> str:
    if sub and str(sub).strip():
        return str(sub).strip()
    if email and str(email).strip():
        user = user_store.get_user_by_email(email)
        if not user:
            raise HTTPException(status_code=400, detail=f"No account for email {email}")
        return native_user_sub(user["id"])
    raise HTTPException(status_code=400, detail=required)


def _resolve_commissioner_sub(email: str | None, sub: str | None) -> str:
    return _resolve_account_sub(
        email,
        sub,
        required="commissioner_email or commissioner_sub required",
    )


def _email_for_sub(user_sub: str) -> str | None:
    if is_native_sub(user_sub):
        uid = str(user_sub).removeprefix("ss:")
        user = user_store.get_user_by_id(uid)
        return user.get("email") if user else None
    return None


@router.get("/overview")
def admin_overview(_admin=Depends(require_admin)) -> dict:
    users = user_store.list_users(limit=5000)
    real_accounts = [u for u in users if not _is_test_account_email(u.get("email"))]
    leagues = storage.list_leagues_admin(include_test=True, limit=500)
    subs = storage.list_distinct_hub_subs()
    bot_subs = sum(1 for s in subs if str(s).startswith("bot:"))
    return {
        "native_user_count": len(real_accounts),
        "native_user_count_including_test_accounts": len(users),
        "league_count": len(leagues),
        "live_league_count": sum(1 for lg in leagues if not lg.get("test_mode")),
        "distinct_hub_subs": len(subs),
        "test_league_count": sum(1 for lg in leagues if lg.get("test_mode")),
        "bot_sub_count": bot_subs,
    }


@router.get("/users")
def admin_list_users(
    _admin=Depends(require_admin),
    limit: int = Query(500, ge=1, le=2000),
    include_test_accounts: bool = Query(False),
    include_system_subs: bool = Query(False),
) -> dict:
    native = user_store.list_users(limit=limit)
    if not include_test_accounts:
        native = [u for u in native if not _is_test_account_email(u.get("email"))]
    rows = []
    for u in native:
        sub = native_user_sub(u["id"])
        rows.append({**u, "user_sub": sub, **_enrich_sub(sub)})
    system_subs: list[dict] = []
    if include_system_subs:
        for sub in storage.list_distinct_hub_subs():
            if is_native_sub(sub):
                continue
            if any(r["user_sub"] == sub for r in rows):
                continue
            if not _is_system_hub_sub(sub):
                continue
            system_subs.append(_enrich_sub(sub))
    return {
        "accounts": rows,
        "system_subs": system_subs,
        "count": len(rows),
    }


@router.get("/leagues")
def admin_list_leagues(
    _admin=Depends(require_admin),
    include_test: bool = Query(False),
    limit: int = Query(200, ge=1, le=500),
) -> dict:
    leagues = storage.list_leagues_admin(include_test=include_test, limit=limit)
    for lg in leagues:
        lg["commissioner_email"] = _email_for_sub(str(lg.get("commissioner_sub") or ""))
        for team in lg.get("teams") or []:
            if team.get("user_sub"):
                team["user_email"] = _email_for_sub(str(team["user_sub"]))
    return {"leagues": leagues, "count": len(leagues)}


@router.get("/leagues/{league_id}")
def admin_get_league(league_id: str, _admin=Depends(require_admin)) -> dict:
    league = storage.get_league(league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    teams = storage.list_league_teams(league_id)
    for team in teams:
        if team.get("user_sub"):
            team["user_email"] = _email_for_sub(str(team["user_sub"]))
    league["teams"] = teams
    league["commissioner_email"] = _email_for_sub(str(league.get("commissioner_sub") or ""))
    invites = storage.list_league_invites(league_id)
    for inv in invites:
        inv["invite_url"] = build_invite_url(inv["token"])
    league["invites"] = invites
    try:
        league["roster_overview"] = storage.league_roster_overview(league_id)
    except ValueError:
        league["roster_overview"] = None
    return league


@router.post("/leagues")
def admin_create_league(body: AdminLeagueCreateRequest, _admin=Depends(require_admin)) -> dict:
    comm_sub = _resolve_commissioner_sub(body.commissioner_email, body.commissioner_sub)
    rules = load_preset(body.preset_id)
    if not body.test_mode:
        existing = storage.get_primary_league_membership(comm_sub)
        if existing:
            league, team = existing
            return {
                "league": league,
                "team": team,
                "already_in_league": True,
                "hub_context": resolve_hub_context(comm_sub),
            }
    ws = storage.get_or_create_workspace(comm_sub, body.season)
    league = storage.create_league(
        comm_sub,
        body.name.strip(),
        body.season,
        rules,
        body.team_count,
        ws["id"] if not body.test_mode else None,
        commissioner_team_name=body.commissioner_team_name,
        test_mode=body.test_mode,
    )
    return {"league": league, "hub_context": resolve_hub_context(comm_sub)}


@router.delete("/leagues/{league_id}")
def admin_delete_league(
    league_id: str,
    confirm: str = Query(..., description="Must match league room code"),
    _admin=Depends(require_admin),
) -> dict:
    league = storage.get_league(league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    if str(confirm).strip().upper() != str(league.get("room_code") or "").upper():
        raise HTTPException(status_code=400, detail="Confirmation must match league room code")
    try:
        return storage.delete_league(league_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/leagues/{league_id}/teams/{team_id}/link")
def admin_link_team(
    league_id: str,
    team_id: str,
    body: AdminLinkTeamRequest,
    _admin=Depends(require_admin),
) -> dict:
    user_sub = _resolve_account_sub(body.email, body.user_sub)
    try:
        result = storage.admin_assign_team_user(league_id, team_id, user_sub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    team = result.get("team") or {}
    if team.get("user_sub"):
        team["user_email"] = _email_for_sub(str(team["user_sub"]))
    result["team"] = team
    return result


@router.post("/leagues/{league_id}/teams/{team_id}/unlink")
def admin_unlink_team(
    league_id: str,
    team_id: str,
    force_commissioner: bool = Query(False),
    _admin=Depends(require_admin),
) -> dict:
    try:
        team = storage.admin_release_team_claim(
            league_id,
            team_id,
            allow_commissioner=force_commissioner,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"team": team}


@router.post("/leagues/{league_id}/transfer-commissioner")
def admin_transfer_commissioner(
    league_id: str,
    body: AdminTransferCommissionerRequest,
    _admin=Depends(require_admin),
) -> dict:
    new_sub = _resolve_commissioner_sub(body.commissioner_email, body.commissioner_sub)
    try:
        result = storage.admin_transfer_commissioner(league_id, new_sub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    league = result.get("league") or {}
    league["commissioner_email"] = _email_for_sub(str(league.get("commissioner_sub") or ""))
    result["league"] = league
    return result


@router.post("/leagues/{league_id}/invites")
def admin_create_league_invite(
    league_id: str,
    body: AdminLeagueInviteRequest,
    admin=Depends(require_admin),
) -> dict:
    league = storage.get_league(league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    invited_by = str(admin.get("sub") or league.get("commissioner_sub") or "")
    try:
        invite = create_invite(league_id, body.email.strip(), body.team_name.strip(), invited_by)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"invite": invite}
