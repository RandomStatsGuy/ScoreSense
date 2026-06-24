"""Draft Hub API routes."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect

from app.auth import hub_auth_enabled, require_hub_user, ws_user_from_token
from src.draft_hub import storage
from src.draft_hub.draft_enrichment import beat_digest_single, build_draft_room_enrichment
from src.draft_hub.draft_state import (
    award_nominee,
    check_timers,
    cut_player,
    end_draft,
    get_room_state,
    nominate,
    place_bid,
    set_nomination_order,
    set_pool_mode,
    start_draft,
    update_auction_rules,
)
from src.draft_hub.draft_pool import build_nomination_pool
from src.draft_hub.draft_recap import build_draft_recap
from src.draft_hub.presets import list_presets, load_preset
from src.draft_hub.pre_draft_cap import (
    ROSTER_ACTIVE,
    ROSTER_CUT_BEFORE_DRAFT,
    cap_summary_for_phase,
    contract_on_cut_status_change,
    pre_draft_cap_summary,
)
from src.draft_hub.rules_engine import cap_summary, multi_year_cap_plan, validate_roster
from src.draft_hub.salary_import import match_ranges_to_pool, parse_salary_range_csv
from src.draft_hub.schemas import (
    AuctionRulesUpdate,
    ContractExtendRequest,
    ContractRenewRequest,
    DraftBidRequest,
    DraftCutRequest,
    DraftEnrichmentRequest,
    DraftNominateRequest,
    DraftPoolModeRequest,
    LeagueCreateRequest,
    LeagueInviteAcceptRequest,
    LeagueInviteCreateRequest,
    LeagueJoinRequest,
    LeagueSettingsUpdate,
    NominationOrderUpdate,
    LeagueRules,
    LeagueSheetImportRequest,
    RosterAddRequest,
    RosterRemoveRequest,
    RosterUpdateRequest,
    SleeperImportRequest,
    SleeperLeagueConnectRequest,
    SleeperLinkRequest,
    SleeperSyncRequest,
    TestDraftSetupRequest,
    TradeSwapRequest,
    LeagueTradeRequest,
    WorkspaceUpdate,
)
from src.draft_hub.contracts import renew_player_contract, roster_row_from_import, swap_contracts, build_contract_from_roster_edit
from src.draft_hub.hub_context import list_roster_for_context, resolve_hub_context, roster_scope
from src.draft_hub.league_permissions import can_edit_roster, require_commissioner
from src.draft_hub.league_analytics import build_league_analytics
from src.draft_hub.league_invites import build_invite_url, create_invite
from src.draft_hub.league_sleeper_sync import connect_sleeper_league
from src.draft_hub.league_sheet_import import parse_league_sheet_csv
from src.draft_hub.test_draft import reset_test_draft, setup_test_draft
from src.draft_hub.trade_executor import execute_league_trade
from src.draft_hub.trade_insights import build_trade_insights
from src.draft_hub.sleeper_link import (
    discover_teams,
    get_sleeper_context,
    link_sleeper_team,
    repair_solo_roster,
    sleeper_player_id_set,
    sync_league_sleeper,
    sync_sleeper_roster,
)
from src.draft_hub.storage import user_sub_from_patron
from src.draft_hub.tier_generator import generate_tiers
from src.draft_hub.value_sheet import (
    _load_draft_pool,
    build_draft_pool_payload,
    build_value_overlay,
    build_value_sheet,
)
from src.draft_hub.ws_manager import draft_room_manager
from src.integrations.sleeper_league import import_sleeper_roster

router = APIRouter(prefix="/api/hub", tags=["draft-hub"])


def _sub(patron: dict | None) -> str:
    return user_sub_from_patron(patron)


def _ctx(sub: str) -> dict:
    return resolve_hub_context(sub)


def _team_count_for_ctx(ctx: dict) -> int:
    if ctx.get("mode") == "league" and ctx.get("league_id"):
        league = storage.get_league(str(ctx["league_id"]))
        if league:
            return int(league.get("team_count") or 12)
    return 12


def _assert_league_access(league_id: str, sub: str) -> None:
    league = storage.get_league(league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    if league.get("commissioner_sub") == sub:
        return
    if storage.get_team_by_user(league_id, sub):
        return
    raise HTTPException(status_code=403, detail="Not a member of this league")


def _assert_league_commissioner(league_id: str, sub: str) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    if league.get("commissioner_sub") != sub:
        raise HTTPException(status_code=403, detail="Commissioner only")
    return league


@router.get("/context")
def hub_get_context(_user=Depends(require_hub_user)) -> dict:
    return _ctx(_sub(_user))


@router.get("/presets")
def hub_presets(_user=Depends(require_hub_user)) -> dict:
    return {"presets": list_presets()}


@router.get("/workspace")
def hub_get_workspace(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    ws = storage.get_or_create_workspace(sub)
    if ctx.get("mode") == "league":
        team = storage.get_team(str(ctx["team_id"])) if ctx.get("team_id") else None
        ws = {
            **ws,
            "rules": ctx["rules"],
            "season": ctx["season"],
            "hub_context": ctx,
            "sleeper_league_id": ctx.get("sleeper_league_id"),
            "sleeper_roster_id": ctx.get("sleeper_roster_id"),
            "sleeper_team_name": ctx.get("sleeper_team_name"),
            "sleeper_player_ids": (team or {}).get("sleeper_player_ids") or [],
            "sleeper_synced_at": (team or {}).get("sleeper_synced_at"),
        }
    else:
        ws = {**ws, "hub_context": ctx}
    return ws


@router.put("/workspace")
def hub_put_workspace(body: WorkspaceUpdate, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") == "league" and body.rules and not ctx.get("is_commissioner"):
        raise HTTPException(status_code=403, detail="Only the league commissioner can change league rules")
    rules = body.rules
    ws = storage.update_workspace(
        sub,
        name=body.name,
        season=body.season,
        rules=rules,
        preset_id=body.preset_id,
    )
    if ctx.get("mode") == "league" and ctx.get("is_commissioner") and ctx.get("league_id") and rules:
        storage.update_league_rules(str(ctx["league_id"]), rules)
        ws["rules"] = rules.model_dump()
    ws["hub_context"] = _ctx(sub)
    return ws


@router.get("/draft-pool")
def hub_draft_pool(season: Optional[int] = None, _user=Depends(require_hub_user)) -> dict:
    """Projections + fair values without roster overlay (cache-friendly)."""
    sub = _sub(_user)
    ctx = _ctx(sub)
    ws_id, _team_id = roster_scope(ctx)
    target_season = season or ctx["season"]
    rules = LeagueRules.model_validate(ctx["rules"])
    ranges = storage.list_salary_ranges(ctx.get("personal_workspace_id") or ws_id)
    payload = build_draft_pool_payload(
        target_season,
        rules,
        ranges,
        team_count=_team_count_for_ctx(ctx),
    )
    payload["hub_context"] = ctx
    return payload


@router.get("/value-sheet")
def hub_value_sheet(
    season: Optional[int] = None,
    overlay_only: bool = False,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    ws_id, team_id = roster_scope(ctx)
    target_season = season or ctx["season"]
    rules = LeagueRules.model_validate(ctx["rules"])
    ranges = storage.list_salary_ranges(ctx.get("personal_workspace_id") or ws_id)
    roster = storage.list_roster(ws_id, team_id)
    league_roster = None
    if ctx.get("mode") == "league" and ws_id:
        league_roster = storage.list_league_roster(ws_id)
    sleeper_ids = sleeper_player_id_set(sub)
    team_count = _team_count_for_ctx(ctx)
    if overlay_only:
        pool_payload = build_draft_pool_payload(
            target_season, rules, ranges, team_count=team_count
        )
        sheet = build_value_overlay(
            pool_payload,
            rules,
            roster,
            league_roster=league_roster,
            my_team_id=team_id,
            sleeper_player_ids=sleeper_ids,
        )
    else:
        sheet = build_value_sheet(
            target_season,
            rules,
            ranges,
            roster,
            league_roster=league_roster,
            my_team_id=team_id,
            sleeper_player_ids=sleeper_ids,
            team_count=team_count,
        )
    sheet["sleeper"] = get_sleeper_context(sub)
    sheet["hub_context"] = ctx
    return sheet


@router.post("/salary-ranges/import")
async def hub_import_salary_ranges(
    file: UploadFile = File(...),
    season: Optional[int] = None,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ws = storage.get_or_create_workspace(sub, season or 2025)
    raw = await file.read()
    try:
        parsed = parse_salary_range_csv(raw)
        pool = _load_draft_pool(season or ws["season"])
        rows, stats = match_ranges_to_pool(pool, parsed)
        count = storage.upsert_salary_ranges(ws["id"], rows)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"imported": count, "stats": stats}


@router.post("/salary-ranges/generate")
def hub_generate_salary_ranges(season: Optional[int] = None, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ws = storage.get_or_create_workspace(sub, season or 2025)
    rules = LeagueRules.model_validate(ws["rules"])
    target_season = season or ws["season"]
    pool = _load_draft_pool(target_season)
    storage.clear_model_salary_ranges(ws["id"])
    tiers = generate_tiers(pool, rules)
    # Skip players that already have import ranges
    existing = {r["player_id"] for r in storage.list_salary_ranges(ws["id"]) if r.get("source") == "import"}
    to_write = [t for t in tiers if t["player_id"] not in existing]
    count = storage.upsert_salary_ranges(ws["id"], to_write)
    return {"generated": count, "season": target_season}


@router.get("/roster")
def hub_list_roster(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    roster = list_roster_for_context(ctx)
    return {"roster": roster, "count": len(roster), "hub_context": ctx}


@router.post("/roster")
def hub_add_roster(body: RosterAddRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") == "league" and not can_edit_roster(ctx):
        raise HTTPException(status_code=403, detail="Join a league team to edit your roster")
    ws_id, team_id = roster_scope(ctx)
    rules = LeagueRules.model_validate(ctx["rules"])
    contract = build_contract_from_roster_edit(
        rules,
        current_salary=float(body.salary),
        years_remaining=int(body.contract_years or 1),
    )
    row = storage.add_roster_slot(
        ws_id,
        {
            "player_id": body.player_id,
            "player_name": body.player_name,
            "team": body.team,
            "position": body.position,
            "salary": contract["current_salary"],
            "contract_years": contract["years_remaining"],
            "contract": contract,
        },
        team_id=team_id,
    )
    roster = list_roster_for_context(ctx)
    errors = validate_roster(rules, roster)
    return {"slot": row, "validation_errors": errors}


@router.delete("/roster")
def hub_remove_roster(body: RosterRemoveRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") == "league" and not can_edit_roster(ctx):
        raise HTTPException(status_code=403, detail="Join a league team to edit your roster")
    ws_id, _team_id = roster_scope(ctx)
    ok = storage.remove_roster_slot(ws_id, body.player_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Player not on roster")
    return {"removed": body.player_id}


@router.patch("/roster")
def hub_update_roster(body: RosterUpdateRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    ws_id, team_id = roster_scope(ctx)
    draft_completed = bool(ctx.get("draft_completed"))
    salary_fields = body.salary is not None or body.contract_years is not None or body.salary_schedule is not None
    if salary_fields and ctx.get("mode") == "league" and not ctx.get("can_edit_salaries"):
        raise HTTPException(status_code=403, detail="Only the league commissioner can update salaries")
    if body.roster_status is not None and body.roster_status not in (ROSTER_ACTIVE, ROSTER_CUT_BEFORE_DRAFT):
        raise HTTPException(status_code=400, detail="roster_status must be active or cut_before_draft")
    if body.roster_status is not None and draft_completed:
        raise HTTPException(status_code=400, detail="Cannot change pre-draft cut status after the draft is completed")
    rules = LeagueRules.model_validate(ctx["rules"])
    max_years = int(rules.contracts.max_years)
    yrs_in = body.contract_years
    if yrs_in is not None and (yrs_in < 1 or yrs_in > max_years):
        raise HTTPException(
            status_code=400,
            detail=f"Years remaining must be between 1 and {max_years}",
        )
    if body.salary is not None and body.salary < 0:
        raise HTTPException(status_code=400, detail="Salary cannot be negative")
    existing = storage.get_roster_slot(ws_id, body.player_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Player not on roster")
    if ctx.get("mode") == "league" and not ctx.get("is_commissioner"):
        if existing.get("team_id") and str(existing["team_id"]) != str(team_id):
            raise HTTPException(status_code=403, detail="Cannot edit another team's roster")
    cur_sal = float(body.salary if body.salary is not None else existing["salary"])
    cur_yrs = int(yrs_in if yrs_in is not None else existing.get("contract_years") or 1)
    contract = None
    if salary_fields:
        contract = build_contract_from_roster_edit(
            rules,
            current_salary=cur_sal,
            years_remaining=cur_yrs,
            existing=existing.get("contract"),
            step_up=float(rules.contracts.extension_step_up),
            salary_schedule=body.salary_schedule,
        )
    elif body.roster_status is not None:
        contract = contract_on_cut_status_change(existing, roster_status=body.roster_status)
    try:
        slot = storage.update_roster_slot(
            ws_id,
            body.player_id,
            team_id=team_id,
            contract=contract,
            roster_status=body.roster_status,
            any_team=bool(ctx.get("mode") == "league" and ctx.get("is_commissioner")),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    roster = list_roster_for_context(ctx)
    errors = validate_roster(rules, roster)
    plan = multi_year_cap_plan(rules, roster, draft_completed=draft_completed)
    pre_draft = pre_draft_cap_summary(rules, roster, draft_completed=draft_completed)
    return {"slot": slot, "validation_errors": errors, "multi_year_plan": plan, "pre_draft": pre_draft}


@router.get("/cap-sheet")
def hub_cap_sheet(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    rules = LeagueRules.model_validate(ctx["rules"])
    roster = list_roster_for_context(ctx)
    draft_completed = bool(ctx.get("draft_completed"))
    summary = cap_summary_for_phase(rules, roster, draft_completed=draft_completed)
    errors = validate_roster(rules, roster)
    plan = multi_year_cap_plan(rules, roster, draft_completed=draft_completed)
    pre_draft = pre_draft_cap_summary(rules, roster, draft_completed=draft_completed)
    sleeper = get_sleeper_context(sub)
    return {
        "summary": summary,
        "validation_errors": errors,
        "multi_year_plan": plan,
        "pre_draft": pre_draft,
        "sleeper": sleeper,
        "hub_context": ctx,
        "season": ctx.get("season"),
    }


# --- Phase B: League / draft room ---


@router.get("/draft-room/enrichment")
def hub_draft_room_enrichment_get(
    season: Optional[int] = None,
    week: Optional[int] = None,
    player_ids: Optional[str] = None,
    _user=Depends(require_hub_user),
) -> dict:
    ids = [p.strip() for p in (player_ids or "").split(",") if p.strip()]
    players = [{"player_id": pid} for pid in ids]
    try:
        return build_draft_room_enrichment(season=season, week=week, players=players or None)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/draft-room/enrichment")
def hub_draft_room_enrichment_post(body: DraftEnrichmentRequest, _user=Depends(require_hub_user)) -> dict:
    players = [p.model_dump() for p in body.players]
    try:
        return build_draft_room_enrichment(
            season=body.season,
            week=body.week,
            players=players or None,
            llm_player_ids=body.llm_player_ids,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/draft-room/beat-digest/{player_id}")
def hub_draft_beat_digest(
    player_id: str,
    player_name: Optional[str] = None,
    season: Optional[int] = None,
    week: Optional[int] = None,
    _user=Depends(require_hub_user),
) -> dict:
    try:
        return beat_digest_single(player_id, player_name=player_name, season=season, week=week)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league")
def hub_create_league(body: LeagueCreateRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    if not body.test_mode:
        existing = storage.get_primary_league_membership(sub)
        if existing:
            league, _team = existing
            return {**league, "hub_context": _ctx(sub), "already_in_league": True}
    ws = storage.get_or_create_workspace(sub, body.season)
    rules = body.rules or load_preset(body.preset_id or "salary_cap_auction_v1")
    league = storage.create_league(
        sub,
        body.name,
        body.season,
        rules,
        body.team_count,
        ws["id"] if not body.test_mode else None,
        commissioner_team_name=body.commissioner_team_name or "Commissioner",
        test_mode=body.test_mode,
    )
    return {**league, "hub_context": _ctx(sub)}


@router.post("/league/join")
def hub_join_league(body: LeagueJoinRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        team = storage.join_league(sub, body.room_code, body.team_name)
        with storage.get_conn() as conn:
            row = conn.execute(
                "SELECT league_id FROM team WHERE id = ?",
                (team["id"],),
            ).fetchone()
        league_id = row["league_id"] if row else None
        league = storage.get_league(league_id) if league_id else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"team": team, "league_id": league_id, "league": league, "hub_context": _ctx(sub)}


@router.get("/league/{league_id}/members")
def hub_league_members(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    teams = storage.list_league_teams(league_id)
    invites = storage.list_league_invites(league_id) if ctx.get("is_commissioner") else []
    return {"teams": teams, "invites": invites, "hub_context": ctx}


@router.get("/league/{league_id}/rosters")
def hub_league_rosters(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    _assert_league_commissioner(league_id, sub)
    ctx = _ctx(sub)
    ws_id = str(ctx.get("workspace_id") or "")
    league = storage.get_league(league_id) or {}
    league_ws = str(league.get("workspace_id") or "")
    if league_ws and storage.list_orphan_roster_slots(league_ws):
        from src.draft_hub.league_sleeper_sync import reattach_league_roster_slots

        reattach_league_roster_slots(league_id)
    elif ws_id and storage.list_orphan_roster_slots(ws_id):
        from src.draft_hub.league_sleeper_sync import reattach_league_roster_slots

        reattach_league_roster_slots(league_id)
    try:
        overview = storage.league_roster_overview(league_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**overview, "hub_context": ctx}


@router.get("/league/{league_id}/insights")
def hub_league_insights(
    league_id: str,
    team_id: Optional[str] = None,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    try:
        overview = storage.league_roster_overview(league_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    league = overview.get("league") or {}
    draft_completed = bool(league.get("draft_completed"))
    my_team_id = str(team_id or ctx.get("team_id") or "")
    analytics = build_league_analytics(overview, draft_completed=draft_completed)
    trade = build_trade_insights(
        overview,
        my_team_id=my_team_id,
        season=int(league.get("season") or 2025),
        draft_completed=draft_completed,
    )
    draft_recap = build_draft_recap(league_id, overview=overview)
    from src.draft_hub.league_history import build_player_ownership_history, build_sleeper_scoring_history
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id

    hub_teams = [
        {
            **(b.get("team") or {}),
            "name": (b.get("team") or {}).get("name"),
        }
        for b in overview.get("teams") or []
    ]
    sleeper_lid = (
        resolve_sleeper_league_id(league_id)
        or league.get("sleeper_league_id")
        or ctx.get("sleeper_league_id")
        or ""
    )
    if sleeper_lid and not league.get("sleeper_league_id"):
        storage.update_league_sleeper_id(league_id, str(sleeper_lid))
    scoring = (
        build_sleeper_scoring_history(str(sleeper_lid), hub_teams=hub_teams)
        if sleeper_lid
        else {
            "available": False,
            "reason": "no_sleeper_league",
            "hint": "Link your Sleeper league on Setup or All teams to pull weekly fantasy points.",
        }
    )
    ownership = build_player_ownership_history(league_id, overview)
    return {
        "analytics": analytics,
        "trade": trade,
        "draft_recap": draft_recap,
        "scoring": scoring,
        "ownership": ownership,
        "hub_context": ctx,
    }


@router.get("/league/{league_id}/draft-recap")
def hub_draft_recap(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    _assert_league_access(league_id, sub)
    try:
        overview = storage.league_roster_overview(league_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    recap = build_draft_recap(league_id, overview=overview)
    if not recap:
        raise HTTPException(status_code=404, detail="No completed draft recap for this league")
    return recap


@router.post("/league/{league_id}/trade")
def hub_league_trade(
    league_id: str,
    body: LeagueTradeRequest,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    require_commissioner(ctx)
    try:
        result = execute_league_trade(
            league_id,
            team_a_id=body.team_a_id,
            team_b_id=body.team_b_id,
            send_a=body.send_a,
            send_b=body.send_b,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "hub_context": _ctx(sub)}


@router.patch("/league/{league_id}/settings")
def hub_league_settings(
    league_id: str,
    body: LeagueSettingsUpdate,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    require_commissioner(ctx)
    league = storage.update_league_settings(
        league_id,
        lock_team_claims=body.lock_team_claims,
        draft_completed=body.draft_completed,
    )
    return {"league": league, "hub_context": _ctx(sub)}


@router.post("/league/{league_id}/teams/{team_id}/release-claim")
def hub_release_team_claim(league_id: str, team_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    require_commissioner(ctx)
    try:
        team = storage.release_team_claim(league_id, team_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"team": team, "hub_context": _ctx(sub)}


@router.post("/league/{league_id}/invites")
def hub_create_league_invite(
    league_id: str,
    body: LeagueInviteCreateRequest,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    require_commissioner(ctx)
    try:
        invite = create_invite(league_id, body.email, body.team_name, sub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"invite": invite, "hub_context": _ctx(sub)}


@router.get("/league/{league_id}/invites")
def hub_list_league_invites(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    require_commissioner(ctx)
    invites = []
    for inv in storage.list_league_invites(league_id):
        inv = dict(inv)
        inv["invite_url"] = build_invite_url(inv["token"])
        invites.append(inv)
    return {"invites": invites}


@router.delete("/league/{league_id}/invites/{invite_id}")
def hub_revoke_league_invite(league_id: str, invite_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    require_commissioner(ctx)
    if not storage.revoke_league_invite(league_id, invite_id):
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"revoked": invite_id}


@router.get("/invites/{token}")
def hub_preview_invite(token: str) -> dict:
    invite = storage.get_invite_by_token(token)
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    return {
        "status": invite["status"],
        "email": invite["email"],
        "team_name": invite["team_name"],
        "league_name": invite.get("league_name"),
        "league_season": invite.get("league_season"),
        "expires_at": invite["expires_at"],
    }


@router.post("/invites/accept")
def hub_accept_invite(body: LeagueInviteAcceptRequest, user=Depends(require_hub_user)) -> dict:
    sub = _sub(user)
    email = user.get("email") or ""
    if not email:
        raise HTTPException(status_code=400, detail="Your account must have an email to accept an invite")
    try:
        result = storage.accept_league_invite(body.token, sub, email)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "hub_context": _ctx(sub)}


@router.get("/league/{league_id}")
def hub_get_league(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        state = check_timers(league_id, sub)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return state


@router.get("/league/{league_id}/nomination-pool")
def hub_nomination_pool(league_id: str, _user=Depends(require_hub_user)) -> dict:
    league = storage.get_league(league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    session = storage.get_draft_session(league_id) or {}
    workspace_id = league.get("workspace_id")
    if not workspace_id:
        raise HTTPException(status_code=400, detail="League has no linked workspace")
    ws = storage.get_workspace_by_id(workspace_id)
    rules = LeagueRules.model_validate(league["rules"])
    sleeper_ids = set((ws or {}).get("sleeper_player_ids") or [])
    return build_nomination_pool(
        league_id=league_id,
        pool_mode=session.get("pool_mode"),
        season=int(league["season"]),
        rules=rules,
        workspace_id=workspace_id,
        sleeper_player_ids=sleeper_ids,
    )


@router.patch("/league/{league_id}/auction-rules")
async def hub_auction_rules(
    league_id: str,
    body: AuctionRulesUpdate,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    try:
        state = update_auction_rules(league_id, sub, body.model_dump(exclude_none=True))
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/league/{league_id}/nomination-order")
async def hub_nomination_order(
    league_id: str,
    body: NominationOrderUpdate,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    try:
        state = set_nomination_order(league_id, sub, body.team_ids)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/league/{league_id}/pool-mode")
async def hub_set_pool_mode(league_id: str, body: DraftPoolModeRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        state = set_pool_mode(league_id, sub, body.pool_mode)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/start")
async def hub_start_draft(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        state = start_draft(league_id, sub)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/end")
async def hub_end_draft(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        state = end_draft(league_id, sub)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/nominate")
async def hub_nominate(league_id: str, body: DraftNominateRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        state = nominate(league_id, sub, body.model_dump())
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/bid")
async def hub_bid(league_id: str, body: DraftBidRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        state = place_bid(league_id, sub, body.amount)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/award")
async def hub_award(league_id: str, _user=Depends(require_hub_user)) -> dict:
    try:
        state = award_nominee(league_id)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.websocket("/ws/{league_id}")
async def hub_ws(
    websocket: WebSocket,
    league_id: str,
    token: Optional[str] = Query(None),
):
    user = ws_user_from_token(token)
    if user is None:
        await websocket.close(code=1008, reason="Missing or invalid authentication token.")
        return

    sub = user_sub_from_patron(user)
    if hub_auth_enabled() and not storage.verify_league_membership(sub, league_id):
        await websocket.close(code=1008, reason="Not a league member.")
        return

    await draft_room_manager.connect(league_id, websocket)
    try:
        state = get_room_state(league_id)
        await websocket.send_json({"type": "state", "payload": state})
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
            elif msg == "refresh":
                state = check_timers(league_id)
                await websocket.send_json({"type": "state", "payload": state})
    except WebSocketDisconnect:
        pass
    finally:
        await draft_room_manager.disconnect(league_id, websocket)


async def broadcast_room(league_id: str) -> None:
    state = check_timers(league_id)
    await draft_room_manager.broadcast(league_id, {"type": "state", "payload": state})


# --- Phase C: lifecycle ---


@router.post("/league/{league_id}/cut")
async def hub_cut(league_id: str, body: DraftCutRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        state = cut_player(league_id, sub, body.player_id)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/contract/extend")
def hub_extend_contract(body: ContractExtendRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") == "league" and not ctx.get("can_edit_salaries"):
        raise HTTPException(status_code=403, detail="Only the league commissioner can extend contracts")
    ws_id, team_id = roster_scope(ctx)
    rules = LeagueRules.model_validate(ctx["rules"])
    roster = storage.list_roster(ws_id, team_id)
    row = next((r for r in roster if r["player_id"] == body.player_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="Player not on roster")
    try:
        contract = renew_player_contract(
            row, rules, extension_years=body.extension_years, start_salary=body.new_salary
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    slot = storage.extend_contract(ws_id, body.player_id, body.extension_years, body.new_salary, contract=contract)
    roster = storage.list_roster(ws_id, team_id)
    return {
        "slot": slot,
        "validation_errors": validate_roster(rules, roster),
        "multi_year_plan": multi_year_cap_plan(rules, roster, draft_completed=bool(ctx.get("draft_completed"))),
    }


@router.post("/contract/renew")
def hub_renew_contract(body: ContractRenewRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") == "league" and not ctx.get("can_edit_salaries"):
        raise HTTPException(status_code=403, detail="Only the league commissioner can renew contracts")
    ws_id, team_id = roster_scope(ctx)
    rules = LeagueRules.model_validate(ctx["rules"])
    roster = storage.list_roster(ws_id, team_id)
    row = next((r for r in roster if r["player_id"] == body.player_id), None)
    if not row:
        raise HTTPException(status_code=404, detail="Player not on roster")
    try:
        contract = renew_player_contract(
            row, rules, extension_years=body.extension_years, start_salary=body.start_salary
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    slot = storage.extend_contract(ws_id, body.player_id, body.extension_years, body.start_salary, contract=contract)
    roster = storage.list_roster(ws_id, team_id)
    return {
        "slot": slot,
        "validation_errors": validate_roster(rules, roster),
        "multi_year_plan": multi_year_cap_plan(rules, roster, draft_completed=bool(ctx.get("draft_completed"))),
    }


@router.post("/trade/swap")
def hub_trade_swap(body: TradeSwapRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") == "league" and not ctx.get("can_manage_roster"):
        raise HTTPException(status_code=403, detail="Only the league commissioner can swap contracts")
    ws_id, team_id = roster_scope(ctx)
    rules = LeagueRules.model_validate(ctx["rules"])
    roster = storage.list_roster(ws_id, team_id)
    a = next((r for r in roster if r["player_id"] == body.player_id_a), None)
    b = next((r for r in roster if r["player_id"] == body.player_id_b), None)
    if not a or not b:
        raise HTTPException(status_code=404, detail="Both players must be on roster")
    na, nb = swap_contracts(a, b)
    storage.add_roster_slot(ws_id, na, team_id=team_id)
    storage.add_roster_slot(ws_id, nb, team_id=team_id)
    roster = storage.list_roster(ws_id, team_id)
    return {"roster": roster, "validation_errors": validate_roster(rules, roster)}


@router.post("/league-sheet/import")
async def hub_league_sheet_import(
    file: UploadFile = File(...),
    manager_team_name: Optional[str] = None,
    replace_existing: bool = True,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") == "league" and not ctx.get("can_import_league_sheet"):
        raise HTTPException(status_code=403, detail="Only the league commissioner can import league sheets")
    ws_id, team_id = roster_scope(ctx)
    rules = LeagueRules.model_validate(ctx["rules"])
    raw = await file.read()
    commissioner_import = bool(ctx.get("mode") == "league" and ctx.get("is_commissioner") and not manager_team_name)
    try:
        parsed = parse_league_sheet_csv(
            raw,
            season=ctx["season"],
            manager_team_name=None if commissioner_import else manager_team_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    rows = []
    for r in parsed["rows"]:
        try:
            row = roster_row_from_import(
                player_id=r["player_id"],
                player_name=r["player_name"],
                team=r.get("team") or "",
                position=r["position"],
                salary=r["salary"],
                contract_type=r.get("contract_type") or "veteran",
                years=int(r.get("years") or 1),
                rules=rules,
            )
            row["source"] = "sheet"
            row["manager_team"] = r.get("manager_team") or ""
            rows.append(row)
        except ValueError:
            continue
    if commissioner_import:
        result = storage.import_commissioner_league_sheet(
            str(ctx["league_id"]),
            ws_id,
            rows,
            rules,
            replace_existing=replace_existing,
        )
        roster = list_roster_for_context(ctx)
        return {
            **result,
            "stats": parsed.get("stats"),
            "teams_found": parsed.get("teams_found"),
            "unmatched": parsed.get("unmatched"),
            "validation_errors": validate_roster(rules, roster),
        }
    if replace_existing:
        storage.remove_roster_by_source(ws_id, "sheet", team_id=team_id)
    count = storage.import_roster_snapshot(ws_id, team_id, rows)
    roster = list_roster_for_context(ctx)
    return {
        "imported": count,
        "stats": parsed.get("stats"),
        "teams_found": parsed.get("teams_found"),
        "unmatched": parsed.get("unmatched"),
        "validation_errors": validate_roster(rules, roster),
    }


@router.post("/league/{league_id}/test/setup")
def hub_test_draft_setup(league_id: str, body: TestDraftSetupRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        return setup_test_draft(league_id, sub, body.bot_count, body.bot_budget)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/test/reset")
async def hub_test_draft_reset(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        result = reset_test_draft(league_id, sub)
        await broadcast_room(league_id)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- Sleeper linking ---


@router.get("/sleeper/league/{league_id}/teams")
def hub_sleeper_teams(league_id: str, _user=Depends(require_hub_user)) -> dict:
    try:
        return discover_teams(league_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sleeper/link")
def hub_sleeper_get_link(_user=Depends(require_hub_user)) -> dict:
    return get_sleeper_context(_sub(_user))


@router.put("/sleeper/link")
def hub_sleeper_put_link(body: SleeperLinkRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        result = link_sleeper_team(
            sub,
            sleeper_league_id=body.sleeper_league_id,
            sleeper_roster_id=body.sleeper_roster_id,
            sleeper_team_name=body.sleeper_team_name,
            import_to_hub=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "workspace": result.get("workspace"),
        "imported_to_hub": result.get("imported_to_hub", 0),
        "trade_count": result.get("trade_count", 0),
        "teams_synced": result.get("teams_synced", 0),
        "full_league_import": result.get("full_league_import", False),
        "snapshot": result.get("snapshot"),
        "sleeper": get_sleeper_context(sub),
        "hub_context": result.get("hub_context") or _ctx(sub),
    }


@router.delete("/sleeper/link")
def hub_sleeper_clear_link(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ws = storage.update_sleeper_link(sub, clear=True)
    return {"workspace": ws, "sleeper": get_sleeper_context(sub)}


@router.get("/sleeper/roster")
def hub_sleeper_roster(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = get_sleeper_context(sub)
    if not ctx.get("linked"):
        raise HTTPException(status_code=400, detail="Link a Sleeper league and team first.")
    try:
        from src.integrations.sleeper_league import fetch_linked_roster

        snapshot = fetch_linked_roster(ctx["sleeper_league_id"], ctx["sleeper_roster_id"])
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"sleeper": ctx, "roster": snapshot}


@router.post("/league/{league_id}/sleeper/connect")
def hub_connect_sleeper_league(
    league_id: str,
    body: SleeperLeagueConnectRequest,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    require_commissioner(ctx)
    mappings = [m.model_dump() for m in body.mappings] if body.mappings else None
    try:
        result = connect_sleeper_league(
            league_id,
            body.sleeper_league_id,
            mappings=mappings,
            commissioner_sleeper_roster_id=body.commissioner_sleeper_roster_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "hub_context": _ctx(sub)}


@router.post("/league/{league_id}/sleeper/sync")
def hub_league_sleeper_sync(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        result = sync_league_sleeper(league_id, sub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "hub_context": _ctx(sub)}


@router.post("/sleeper/sync")
def hub_sleeper_sync(body: SleeperSyncRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        result = sync_sleeper_roster(sub, import_to_hub=body.import_to_hub)
        result["hub_context"] = _ctx(sub)
        result["sleeper"] = get_sleeper_context(sub)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/sleeper/clear-roster")
def hub_sleeper_clear_roster(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    ws_id, team_id = roster_scope(ctx)
    if ctx.get("mode") == "league":
        removed = storage.remove_roster_by_source(ws_id, "sleeper", team_id=team_id)
        roster = storage.list_roster(ws_id, team_id)
        return {
            "removed": removed,
            "pruned_junk": 0,
            "roster_count": len(roster),
            "sleeper": get_sleeper_context(sub),
            "hub_context": ctx,
        }
    pruned = storage.prune_solo_roster_junk(ws_id)
    link_ctx = get_sleeper_context(sub)
    if link_ctx.get("linked"):
        pruned += storage.remove_solo_placeholder_imports(
            ws_id,
            preserve_player_ids=set(link_ctx.get("sleeper_player_ids") or []),
        )
    removed = storage.remove_roster_by_source(ws_id, "sleeper")
    roster = storage.list_roster(ws_id, team_id)
    return {
        "removed": removed,
        "pruned_junk": pruned,
        "roster_count": len(roster),
        "sleeper": get_sleeper_context(sub),
        "hub_context": ctx,
    }


@router.post("/sleeper/repair-roster")
def hub_sleeper_repair_roster(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    result = repair_solo_roster(sub)
    ws_id, team_id = roster_scope(ctx)
    result["roster_count"] = len(storage.list_roster(ws_id, team_id))
    result["hub_context"] = ctx
    return result


@router.post("/sleeper/import")
def hub_sleeper_import(body: SleeperImportRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ws = storage.get_or_create_workspace(sub)
    ctx = get_sleeper_context(sub)
    roster_id = body.team_id or ctx.get("sleeper_roster_id")
    try:
        rows = import_sleeper_roster(body.sleeper_league_id, roster_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    count = 0
    pruned = 0
    if body.import_to_hub:
        pruned = storage.prune_solo_roster_junk(ws["id"])
        pruned += storage.remove_solo_placeholder_imports(
            ws["id"],
            preserve_player_ids={r["player_id"] for r in rows},
        )
        count = storage.import_roster_snapshot(ws["id"], None, rows, replace_source="sleeper")
    if roster_id and body.sleeper_league_id:
        storage.update_sleeper_link(
            sub,
            sleeper_league_id=body.sleeper_league_id,
            sleeper_roster_id=str(roster_id),
            sleeper_player_ids=[r["player_id"] for r in rows],
        )
    return {"imported": count, "pruned_junk": pruned, "players": rows, "sleeper": get_sleeper_context(sub)}
