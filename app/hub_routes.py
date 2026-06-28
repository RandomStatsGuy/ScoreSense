"""Draft Hub API routes."""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

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
    ActiveLeagueUpdate,
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
    MockDraftStartRequest,
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
from src.draft_hub.mock_draft import start_mock_draft
from src.draft_hub.test_draft import reset_test_draft, setup_test_draft
from src.draft_hub.trade_executor import execute_league_trade
from src.draft_hub.trade_insights import build_trade_insights
from src.draft_hub.league_efficiency import build_cap_efficiency
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
from src.draft_hub.timing import HubTimer
from src.draft_hub.value_sheet import (
    _load_draft_pool,
    build_draft_pool_payload,
    build_value_overlay,
    build_value_overlay_sheet,
    build_value_sheet,
    peek_pool_payload_cache,
)
from src.draft_hub.ws_manager import draft_room_manager
from src.integrations.sleeper_league import import_sleeper_roster

router = APIRouter(prefix="/api/hub", tags=["draft-hub"])
logger = logging.getLogger(__name__)


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


def _hub_teams_for_scoring(league_id: str) -> list[dict[str, Any]]:
    return [
        {
            "id": t.get("id"),
            "name": t.get("name"),
            "sleeper_roster_id": t.get("sleeper_roster_id"),
            "sleeper_team_name": t.get("sleeper_team_name"),
        }
        for t in storage.list_league_teams(league_id)
    ]


def _refresh_scoring_cache_for_league(league_id: str) -> None:
    from src.draft_hub.league_history import refresh_sleeper_scoring_cache
    from src.draft_hub.league_live_scoring import refresh_sleeper_live_scoring_cache, resolve_current_week
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id

    sleeper_lid = resolve_sleeper_league_id(league_id)
    if not sleeper_lid:
        return
    hub_teams = _hub_teams_for_scoring(league_id)
    try:
        refresh_sleeper_scoring_cache(
            str(sleeper_lid),
            hub_teams=hub_teams,
        )
    except Exception:
        logger.warning("scoring cache refresh failed for league %s", league_id, exc_info=True)
    try:
        week, _ = resolve_current_week()
        refresh_sleeper_live_scoring_cache(
            str(sleeper_lid),
            hub_teams=hub_teams,
            week=week,
        )
    except Exception:
        logger.warning("live scoring cache refresh failed for league %s", league_id, exc_info=True)


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


def _value_overlay_inputs(
    ctx: dict,
    sub: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]] | None, str | None, set[str]]:
    ws_id, team_id = roster_scope(ctx)
    roster = list_roster_for_context(ctx, live_sleeper=False)
    league_roster = None
    if ctx.get("mode") == "league" and ws_id:
        league_roster = storage.list_league_roster(ws_id)
    sleeper_ids = sleeper_player_id_set(sub)
    return roster, league_roster, team_id, sleeper_ids


@router.get("/context")
def hub_get_context(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    return {
        **ctx,
        "memberships": storage.list_live_memberships_for_sub(sub),
    }


@router.get("/memberships")
def hub_list_memberships(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    ws = storage.get_or_create_workspace(sub)
    memberships = storage.list_live_memberships_for_sub(sub)
    focus = ws.get("active_league_id")
    return {
        "memberships": memberships,
        "active_league_id": ctx.get("league_id"),
        "hub_focus": ctx.get("hub_focus") or ("league" if ctx.get("mode") == "league" else "solo"),
        "saved_focus": focus,
        "hub_context": ctx,
    }


@router.put("/active-league")
@router.post("/active-league")
def hub_set_active_league(body: ActiveLeagueUpdate, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    if body.solo:
        storage.set_hub_focus(sub, solo=True)
    elif body.league_id:
        if not storage.get_league_membership(sub, body.league_id):
            raise HTTPException(status_code=403, detail="Not a member of this league")
        league = storage.get_league(body.league_id)
        if league and league.get("test_mode"):
            raise HTTPException(status_code=400, detail="Use the practice draft room for test leagues")
        storage.set_hub_focus(sub, league_id=body.league_id)
    else:
        storage.set_hub_focus(sub, solo=False)
    ctx = _ctx(sub)
    return {"hub_context": ctx, "hub_focus": ctx.get("hub_focus"), "active_league_id": ctx.get("league_id")}


@router.get("/presets")
def hub_presets(_user=Depends(require_hub_user)) -> dict:
    return {"presets": list_presets()}


@router.get("/workspace")
def hub_get_workspace(response: Response, _user=Depends(require_hub_user)) -> dict:
    with HubTimer("workspace", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
        with timer.phase("load"):
            ws = storage.get_or_create_workspace(sub)
            memberships = storage.list_live_memberships_for_sub(sub)
            if ctx.get("mode") == "league":
                team = storage.get_team(str(ctx["team_id"])) if ctx.get("team_id") else None
                ws = {
                    **ws,
                    "name": ctx.get("league_name") or ws.get("name"),
                    "rules": ctx["rules"],
                    "season": ctx["season"],
                    "hub_context": ctx,
                    "memberships": memberships,
                    "sleeper_league_id": ctx.get("sleeper_league_id"),
                    "sleeper_roster_id": ctx.get("sleeper_roster_id"),
                    "sleeper_team_name": ctx.get("sleeper_team_name"),
                    "sleeper_player_ids": (team or {}).get("sleeper_player_ids") or [],
                    "sleeper_synced_at": (team or {}).get("sleeper_synced_at"),
                }
            else:
                ws = {
                    **ws,
                    "hub_context": ctx,
                    "memberships": memberships,
                }
    return ws


@router.put("/workspace")
def hub_put_workspace(body: WorkspaceUpdate, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") == "league" and (body.rules or body.preset_id or body.season is not None or body.name):
        if not ctx.get("is_commissioner"):
            raise HTTPException(status_code=403, detail="Only the league commissioner can change league settings")
    rules = body.rules
    ws = storage.update_workspace(
        sub,
        name=body.name,
        season=body.season,
        rules=rules,
        preset_id=body.preset_id,
    )
    rules_to_apply = rules
    if rules_to_apply is None and ws.get("rules"):
        rules_to_apply = LeagueRules.model_validate(ws["rules"])
    if ctx.get("mode") == "league" and ctx.get("is_commissioner") and ctx.get("league_id"):
        league_id = str(ctx["league_id"])
        if body.season is not None:
            storage.update_league_season(league_id, int(body.season))
        if body.name is not None:
            storage.update_league_name(league_id, body.name)
        if rules_to_apply:
            storage.update_league_rules(league_id, rules_to_apply)
    ctx = _ctx(sub)
    if ctx.get("mode") == "league":
        team = storage.get_team(str(ctx["team_id"])) if ctx.get("team_id") else None
        ws = {
            **ws,
            "name": ctx.get("league_name") or ws.get("name"),
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
        ws["hub_context"] = ctx
    return ws


@router.get("/draft-pool")
def hub_draft_pool(
    response: Response,
    season: Optional[int] = None,
    _user=Depends(require_hub_user),
) -> dict:
    """Projections + fair values without roster overlay (cache-friendly)."""
    with HubTimer("draft-pool", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
            ws_id, _team_id = roster_scope(ctx)
            target_season = season or ctx["season"]
            rules = LeagueRules.model_validate(ctx["rules"])
            ranges = storage.list_salary_ranges(ctx.get("personal_workspace_id") or ws_id)
        with timer.phase("draft_pool"):
            payload = build_draft_pool_payload(
                target_season,
                rules,
                ranges,
                team_count=_team_count_for_ctx(ctx),
            )
            payload["hub_context"] = ctx
    return payload


@router.get("/value-overlay")
def hub_value_overlay(
    response: Response,
    season: Optional[int] = None,
    _user=Depends(require_hub_user),
) -> dict:
    """Roster availability overlay only — requires warm draft-pool cache (GET /draft-pool)."""
    with HubTimer("value-overlay", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
            target_season = season or ctx["season"]
            rules = LeagueRules.model_validate(ctx["rules"])
            ranges = storage.list_salary_ranges(ctx.get("personal_workspace_id") or ctx["workspace_id"])
            team_count = _team_count_for_ctx(ctx)
        with timer.phase("pool_peek"):
            pool_payload = peek_pool_payload_cache(target_season, rules, ranges, team_count=team_count)
            if pool_payload is None:
                raise HTTPException(
                    status_code=503,
                    detail="Draft pool cache is cold. Request GET /api/hub/draft-pool first.",
                )
        with timer.phase("overlay_inputs"):
            roster, league_roster, team_id, sleeper_ids = _value_overlay_inputs(ctx, sub)
        with timer.phase("overlay_build"):
            sheet = build_value_overlay_sheet(
                target_season,
                rules,
                ranges,
                roster,
                league_roster=league_roster,
                my_team_id=team_id,
                sleeper_player_ids=sleeper_ids,
                team_count=team_count,
                pool_payload=pool_payload,
            )
            sheet["sleeper"] = get_sleeper_context(sub)
            sheet["hub_context"] = ctx
    return sheet


@router.get("/value-sheet")
def hub_value_sheet(
    response: Response,
    season: Optional[int] = None,
    overlay_only: bool = False,
    _user=Depends(require_hub_user),
) -> dict:
    with HubTimer("value-sheet", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
            target_season = season or ctx["season"]
            rules = LeagueRules.model_validate(ctx["rules"])
            ranges = storage.list_salary_ranges(ctx.get("personal_workspace_id") or ctx["workspace_id"])
            team_count = _team_count_for_ctx(ctx)
            roster, league_roster, team_id, sleeper_ids = _value_overlay_inputs(ctx, sub)
        with timer.phase("build"):
            if overlay_only:
                pool_payload = peek_pool_payload_cache(target_season, rules, ranges, team_count=team_count)
                if pool_payload is None:
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
def hub_list_roster(
    response: Response,
    live_sleeper: bool = Query(False, description="One-off live Sleeper pull (default: DB only)"),
    _user=Depends(require_hub_user),
) -> dict:
    with HubTimer("roster", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
        with timer.phase("roster"):
            roster = list_roster_for_context(ctx, live_sleeper=live_sleeper)
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
def hub_cap_sheet(response: Response, _user=Depends(require_hub_user)) -> dict:
    with HubTimer("cap-sheet", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
            rules = LeagueRules.model_validate(ctx["rules"])
            draft_completed = bool(ctx.get("draft_completed"))
        with timer.phase("roster"):
            roster = list_roster_for_context(ctx, live_sleeper=False)
        with timer.phase("cap_math"):
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
    if not body.test_mode:
        storage.set_hub_focus(sub, league_id=league["id"])
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
    if league and not league.get("test_mode"):
        storage.set_hub_focus(sub, league_id=league_id)
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


def _parse_history_season(value: str | None) -> tuple[str, int | None]:
    """Return (mode, year) where mode is current | all | year."""
    if not value or str(value).strip().lower() in {"", "current"}:
        return "current", None
    if str(value).strip().lower() == "all":
        return "all", None
    try:
        return "year", int(str(value).strip())
    except (TypeError, ValueError):
        return "current", None


def _parse_insights_sections(value: str | None) -> set[str] | None:
    """None = full payload; otherwise only build listed sections."""
    if not value or not str(value).strip():
        return None
    return {part.strip().lower() for part in str(value).split(",") if part.strip()}


def _insights_section(wanted: set[str] | None, name: str) -> bool:
    return wanted is None or name in wanted


def _historic_insights_block(
    league_id: str,
    overview: dict,
    *,
    mode: str,
    season_year: int | None,
) -> dict:
    from src.draft_hub.historic_insights import (
        build_contract_analytics,
        build_contract_awards,
        build_current_spend_awards,
        build_historic_meta,
    )

    meta = build_historic_meta(league_id)
    league = overview.get("league") or {}
    cap = float(overview.get("salary_cap") or (league.get("rules") or {}).get("salary_cap") or 200)

    if not meta.get("available"):
        awards = build_current_spend_awards(overview, salary_cap=cap) if mode == "current" else []
        return {**meta, "mode": mode, "season": season_year, "awards": awards}

    if mode == "year" and season_year is not None:
        analytics = build_contract_analytics(league_id, season_year=season_year, salary_cap=cap)
        awards = build_contract_awards(league_id, season_year=season_year, salary_cap=cap)
    elif mode == "all":
        analytics = build_contract_analytics(league_id, season_year=None, salary_cap=cap)
        awards = build_contract_awards(league_id, season_year=None, salary_cap=cap)
    else:
        analytics = None
        awards = build_current_spend_awards(overview, salary_cap=cap)

    return {
        **meta,
        "mode": mode,
        "season": season_year,
        "analytics": analytics,
        "awards": awards,
    }


def _build_cap_efficiency_for_insights(
    league_id: str,
    overview: dict,
    analytics: dict,
    scoring: dict,
    *,
    cap_efficiency_season: str | None,
    history_mode: str,
    history_year: int | None,
    planning_season: str | None = None,
) -> dict:
    from src.draft_hub.historic_insights import build_contract_analytics
    from src.draft_hub.league_efficiency import align_contract_analytics_to_hub_teams, build_cap_efficiency
    from src.draft_hub.owner_display import scoring_year_specific, team_owner_map_for_league

    league = overview.get("league") or {}
    cap = float(overview.get("salary_cap") or (league.get("rules") or {}).get("salary_cap") or 200)
    eff_cap_year: int | None = None
    if cap_efficiency_season and str(cap_efficiency_season).isdigit():
        eff_cap_year = int(cap_efficiency_season)
    elif history_mode == "year" and history_year is not None:
        eff_cap_year = history_year

    eff_analytics = analytics
    if eff_cap_year is not None:
        contract_cap = build_contract_analytics(league_id, season_year=eff_cap_year, salary_cap=cap)
        if contract_cap:
            eff_analytics = align_contract_analytics_to_hub_teams(contract_cap, overview)

    owner_map = team_owner_map_for_league(league_id)
    display_season = str(
        cap_efficiency_season
        or scoring.get("requested_season")
        or scoring.get("season")
        or ""
    )
    plan = str(planning_season or (overview.get("league") or {}).get("season") or "")
    year_specific = scoring_year_specific(display_season, plan)
    return build_cap_efficiency(
        eff_analytics,
        scoring,
        owner_map=owner_map,
        year_specific=year_specific,
    )


def _hub_ownership_history_payload(
    league_id: str,
    overview: dict,
    ctx: dict,
    *,
    refresh: bool = False,
    history_mode: str = "current",
    history_year: int | None = None,
) -> dict:
    from src.draft_hub.league_history import (
        apply_sleeper_ownership_history,
        build_player_ownership_history,
        get_sleeper_ownership_history,
        sleeper_league_season_chain,
        OWNERSHIP_DB_MAX_AGE_HOURS,
        _scoring_cache_is_fresh,
    )
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id

    league = overview.get("league") or {}
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
    ownership = build_player_ownership_history(league_id, overview)

    def _finalize(payload: dict) -> dict:
        from src.draft_hub.historic_insights import enrich_ownership_with_contracts

        filter_year = history_year if history_mode == "year" else None
        out = enrich_ownership_with_contracts(payload, league_id, season_year=filter_year)
        out["history_mode"] = history_mode
        out["history_season"] = history_year
        return out

    if not sleeper_lid:
        return _finalize({
            **ownership,
            "hint": "Link your Sleeper league on Setup or All teams to pull season-by-season ownership.",
        })

    chain = sleeper_league_season_chain(str(sleeper_lid))
    available_seasons = [str(c["season"]) for c in chain]
    ownership["available_seasons"] = available_seasons

    if not refresh:
        cached = storage.get_sleeper_ownership_cache(str(sleeper_lid))
        if cached and _scoring_cache_is_fresh(cached["synced_at"], OWNERSHIP_DB_MAX_AGE_HOURS):
            sleeper_payload = {
                **cached["payload"],
                "synced_at": cached["synced_at"],
                "cached": True,
                "available_seasons": available_seasons,
            }
            return _finalize(apply_sleeper_ownership_history(ownership, sleeper_payload))
        ownership["hint"] = (
            "Tap Refresh history to load season-by-season ownership from Sleeper "
            "(first load may take a minute)."
        )
        return _finalize(ownership)

    sleeper_payload = get_sleeper_ownership_history(
        str(sleeper_lid),
        hub_teams=hub_teams,
        overview=overview,
        refresh=True,
    )
    ownership = apply_sleeper_ownership_history(ownership, sleeper_payload)
    if not ownership.get("has_sleeper_history"):
        ownership["hint"] = (
            "Could not load Sleeper season rosters yet — try Refresh in a moment."
        )
    return _finalize(ownership)


@router.get("/league/{league_id}/insights")
def hub_league_insights(
    response: Response,
    league_id: str,
    team_id: Optional[str] = None,
    refresh: bool = Query(False, description="Bypass cached Sleeper scoring history"),
    scoring_season: Optional[str] = Query(None, description="Sleeper season year e.g. 2024"),
    cap_efficiency_season: Optional[str] = Query(
        None,
        description="Cap sheet season for pts/$ efficiency e.g. 2024 (defaults to history_season when set)",
    ),
    history_season: Optional[str] = Query(
        None,
        description="Dynasty history filter: current, all, or year e.g. 2024",
    ),
    sections: Optional[str] = Query(
        None,
        description="Comma-separated blocks: cap,scoring,trades,ownership (default all)",
    ),
    ownership_only: bool = Query(False, description="Return Sleeper ownership history only"),
    _user=Depends(require_hub_user),
) -> dict:
    history_mode, history_year = _parse_history_season(history_season)
    wanted_sections = _parse_insights_sections(sections)
    with HubTimer("league-insights", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
            if ctx.get("league_id") != league_id:
                raise HTTPException(status_code=403, detail="Not a member of this league")
        with timer.phase("overview"):
            try:
                overview = storage.league_roster_overview(league_id)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            if ownership_only:
                with timer.phase("ownership"):
                    return _hub_ownership_history_payload(
                        league_id,
                        overview,
                        ctx,
                        refresh=refresh,
                        history_mode=history_mode,
                        history_year=history_year,
                    )
            league = overview.get("league") or {}
            draft_completed = bool(league.get("draft_completed"))
            my_team_id = str(team_id or ctx.get("team_id") or "")
        analytics: dict = {"teams": [], "positions": []}
        historic: dict = {"available": False, "awards": []}
        trade: dict = {
            "my_team_id": my_team_id,
            "balance": {},
            "actionable_needs": [],
            "partners": [],
            "suggestions": [],
        }
        draft_recap = None
        scoring: dict = {"available": False, "reason": "not_loaded"}
        efficiency: dict = {"available": False, "teams": []}
        ownership: dict = {"players": [], "player_count": 0}

        with timer.phase("analytics"):
            if _insights_section(wanted_sections, "cap") or _insights_section(wanted_sections, "trades"):
                try:
                    historic = _historic_insights_block(
                        league_id,
                        overview,
                        mode=history_mode,
                        season_year=history_year,
                    )
                    if history_mode in {"year", "all"} and historic.get("analytics"):
                        analytics = historic["analytics"]
                    else:
                        analytics = build_league_analytics(overview, draft_completed=draft_completed)
                except Exception as exc:
                    logging.getLogger(__name__).exception(
                        "insights cap block failed league=%s", league_id,
                    )
                    historic = {"available": False, "awards": [], "error": str(exc)}
                    analytics = build_league_analytics(overview, draft_completed=draft_completed)
            if _insights_section(wanted_sections, "trades"):
                try:
                    trade = build_trade_insights(
                        overview,
                        my_team_id=my_team_id,
                        season=int(league.get("season") or 2025),
                        draft_completed=draft_completed,
                        analytics=analytics,
                    )
                except Exception as exc:
                    logging.getLogger(__name__).exception(
                        "insights trades block failed league=%s", league_id,
                    )
                    trade = {
                        **trade,
                        "empty_reason": str(exc),
                        "hint": "Trade suggestions unavailable right now.",
                    }
            if wanted_sections is None:
                draft_recap = build_draft_recap(league_id, overview=overview)
        from src.draft_hub.league_history import (
            build_player_ownership_history,
            get_sleeper_scoring_history,
        )
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
        if _insights_section(wanted_sections, "scoring"):
            with timer.phase("scoring"):
                try:
                    effective_scoring_season = scoring_season
                    if not effective_scoring_season and history_mode == "year" and history_year is not None:
                        effective_scoring_season = str(history_year)
                    scoring = (
                        get_sleeper_scoring_history(
                            str(sleeper_lid),
                            hub_teams=hub_teams,
                            refresh=refresh,
                            scoring_season=effective_scoring_season,
                        )
                        if sleeper_lid
                        else {
                            "available": False,
                            "reason": "no_sleeper_league",
                            "hint": "Link Sleeper on Setup to load scoring.",
                        }
                    )
                    from src.draft_hub.owner_display import (
                        enrich_team_row,
                        planning_season_for_user,
                        scoring_year_specific,
                        team_owner_map_for_league,
                    )
                    from src.draft_hub.scoring_insights import build_scoring_awards

                    planning_season = planning_season_for_user(sub, league)
                    efficiency = _build_cap_efficiency_for_insights(
                        league_id,
                        overview,
                        analytics,
                        scoring,
                        cap_efficiency_season=cap_efficiency_season,
                        history_mode=history_mode,
                        history_year=history_year,
                        planning_season=planning_season,
                    )

                    if isinstance(scoring, dict):
                        scoring = dict(scoring)
                        if effective_scoring_season:
                            scoring["season"] = str(effective_scoring_season)
                            scoring["requested_season"] = str(effective_scoring_season)
                        owner_map = team_owner_map_for_league(league_id)
                        display_season = str(
                            effective_scoring_season
                            or scoring.get("requested_season")
                            or scoring.get("season")
                            or ""
                        )
                        year_specific = scoring_year_specific(display_season, planning_season)
                        if scoring.get("standings"):
                            scoring["standings"] = [
                                enrich_team_row(s, owner_map, year_specific=year_specific)
                                for s in scoring["standings"]
                            ]
                        scoring["awards"] = build_scoring_awards(
                            scoring,
                            efficiency=efficiency,
                            owner_map=owner_map,
                            planning_season=planning_season,
                        )
                except Exception as exc:
                    logging.getLogger(__name__).exception(
                        "insights scoring block failed league=%s", league_id,
                    )
                    scoring = {
                        "available": False,
                        "reason": "scoring_error",
                        "error": str(exc),
                        "hint": "Scoring could not load. Try Refresh from Sleeper.",
                    }
                    efficiency = {"available": False, "teams": []}
        if _insights_section(wanted_sections, "ownership"):
            with timer.phase("ownership"):
                try:
                    ownership = build_player_ownership_history(league_id, overview)
                    from src.draft_hub.historic_insights import enrich_ownership_with_contracts

                    filter_year = history_year if history_mode == "year" else None
                    ownership = enrich_ownership_with_contracts(
                        ownership,
                        league_id,
                        season_year=filter_year,
                    )
                    ownership["history_mode"] = history_mode
                    ownership["history_season"] = history_year
                except Exception as exc:
                    logging.getLogger(__name__).exception(
                        "insights ownership block failed league=%s", league_id,
                    )
                    ownership = {
                        "players": [],
                        "player_count": 0,
                        "hint": "Player history could not load. Try Refresh history.",
                        "error": str(exc),
                    }
        from src.draft_hub.owner_display import planning_season_for_user, team_owner_map_for_league

    return {
        "analytics": analytics,
        "trade": trade,
        "draft_recap": draft_recap,
        "scoring": scoring,
        "scoring_awards": scoring.get("awards") or [],
        "efficiency": efficiency,
        "ownership": ownership,
        "historic": historic,
        "owner_map": team_owner_map_for_league(league_id),
        "planning_season": planning_season_for_user(sub, league),
        "hub_context": ctx,
    }


@router.get("/league/{league_id}/scoring-awards")
def hub_league_scoring_awards(
    response: Response,
    league_id: str,
    refresh: bool = Query(False, description="Bypass cached Sleeper scoring history"),
    scoring_season: Optional[str] = Query(None, description="Sleeper season year e.g. 2024"),
    cap_efficiency_season: Optional[str] = Query(
        None,
        description="Cap sheet season for cap-efficiency awards e.g. 2024",
    ),
    _user=Depends(require_hub_user),
) -> dict:
    """Scoring superlatives for the Insights scoring tab (lightweight refresh)."""
    with HubTimer("scoring-awards", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
            if ctx.get("league_id") != league_id:
                raise HTTPException(status_code=403, detail="Not a member of this league")
        with timer.phase("overview"):
            try:
                overview = storage.league_roster_overview(league_id)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            league = overview.get("league") or {}
            draft_completed = bool(league.get("draft_completed"))
            analytics = build_league_analytics(overview, draft_completed=draft_completed)
        from src.draft_hub.league_history import get_sleeper_scoring_history
        from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id
        from src.draft_hub.scoring_insights import build_scoring_awards

        hub_teams = [
            {**(b.get("team") or {}), "name": (b.get("team") or {}).get("name")}
            for b in overview.get("teams") or []
        ]
        sleeper_lid = (
            resolve_sleeper_league_id(league_id)
            or league.get("sleeper_league_id")
            or ctx.get("sleeper_league_id")
            or ""
        )
        with timer.phase("scoring"):
            scoring = (
                get_sleeper_scoring_history(
                    str(sleeper_lid),
                    hub_teams=hub_teams,
                    refresh=refresh,
                    scoring_season=scoring_season,
                )
                if sleeper_lid
                else {"available": False, "reason": "no_sleeper_league"}
            )
            cap_season = cap_efficiency_season or scoring_season
            efficiency = _build_cap_efficiency_for_insights(
                league_id,
                overview,
                analytics,
                scoring,
                cap_efficiency_season=cap_season,
                history_mode="current",
                history_year=None,
            )
            awards = []
            if isinstance(scoring, dict):
                from src.draft_hub.owner_display import planning_season_for_user, team_owner_map_for_league

                owner_map = team_owner_map_for_league(league_id)
                planning_season = planning_season_for_user(sub, league)
                awards = build_scoring_awards(
                    scoring,
                    efficiency=efficiency,
                    owner_map=owner_map,
                    planning_season=planning_season,
                )
    return {
        "available": bool(scoring.get("available")) if isinstance(scoring, dict) else False,
        "season": scoring.get("season") if isinstance(scoring, dict) else scoring_season,
        "requested_season": scoring.get("requested_season") if isinstance(scoring, dict) else scoring_season,
        "awards": awards,
        "preseason": bool(scoring.get("preseason")) if isinstance(scoring, dict) else False,
    }


@router.get("/league/{league_id}/live-scoring")
def hub_league_live_scoring(
    response: Response,
    league_id: str,
    week: Optional[int] = Query(None, description="NFL week override"),
    refresh: bool = Query(False, description="Bypass cached live scoring (60s TTL)"),
    _user=Depends(require_hub_user),
) -> dict:
    """Current-week Sleeper matchup scores with starter-level points."""
    with HubTimer("live-scoring", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
            if ctx.get("league_id") != league_id:
                raise HTTPException(status_code=403, detail="Not a member of this league")
        from src.draft_hub.league_live_scoring import get_sleeper_live_week
        from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id

        sleeper_lid = (
            resolve_sleeper_league_id(league_id)
            or ctx.get("sleeper_league_id")
            or ""
        )
        hub_teams = _hub_teams_for_scoring(league_id)
        viewer_rid = ctx.get("sleeper_roster_id")
        with timer.phase("live"):
            scoring = (
                get_sleeper_live_week(
                    str(sleeper_lid),
                    hub_teams=hub_teams,
                    week=week,
                    viewer_roster_id=str(viewer_rid) if viewer_rid else None,
                    refresh=refresh,
                )
                if sleeper_lid
                else {
                    "available": False,
                    "reason": "no_sleeper_league",
                    "hint": "Link your Sleeper league on Setup or All teams to see live scoring.",
                }
            )
    return {
        **scoring,
        "hub_context": {
            "sleeper_roster_id": ctx.get("sleeper_roster_id"),
            "team_name": ctx.get("team_name"),
            "sleeper_league_id": sleeper_lid or None,
        },
    }


@router.get("/league/{league_id}/contract-history")
def hub_contract_history(
    league_id: str,
    season: Optional[int] = Query(None, description="Filter to one season year"),
    owner: Optional[str] = Query(None, description="Filter to commissioner owner label"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    from src.draft_hub.legacy_contract_history import build_contract_history_payload

    return build_contract_history_payload(
        league_id,
        season_year=season,
        owner_label=owner,
    )


class ContractRowPatch(BaseModel):
    owner_label: Optional[str] = None
    hub_team_name: Optional[str] = None
    player_name: Optional[str] = None
    player_id: Optional[str] = None
    position: Optional[str] = None
    base_salary: Optional[float] = None
    cap_hit: Optional[float] = None
    prior_salary: Optional[float] = None
    original_draft_year: Optional[int] = None
    roster_status: Optional[str] = None
    contract_phase: Optional[str] = None
    acquisition_type: Optional[str] = None
    status_note: Optional[str] = None
    confidence: Optional[str] = None
    needs_review: Optional[bool] = None
    review_reason: Optional[str] = None
    note: Optional[str] = None


@router.patch("/league/{league_id}/contract-history/{row_id}")
def hub_contract_history_patch(
    league_id: str,
    row_id: int,
    body: ContractRowPatch,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    require_commissioner(ctx)
    row = storage.get_league_contract_row(row_id)
    if not row or row.get("league_id") != league_id:
        raise HTTPException(status_code=404, detail="Contract row not found")
    updates = body.model_dump(exclude_none=True)
    note = updates.pop("note", None)
    if not updates:
        return row
    return row


@router.delete("/league/{league_id}/contract-history/{row_id}")
def hub_contract_history_delete(
    league_id: str,
    row_id: int,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    require_commissioner(ctx)
    row = storage.get_league_contract_row(row_id)
    if not row or row.get("league_id") != league_id:
        raise HTTPException(status_code=404, detail="Contract row not found")
    if not storage.delete_league_contract_row(row_id, league_id):
        raise HTTPException(status_code=404, detail="Contract row not found")
    return {"deleted": True, "id": row_id}


@router.post("/league/{league_id}/contract-history/import")
def hub_contract_history_import(
    league_id: str,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    require_commissioner(ctx)
    from src.draft_hub.legacy_contract_history import import_legacy_files

    return import_legacy_files(league_id, imported_by_sub=sub)


@router.post("/league/{league_id}/contract-history/reconcile-sleeper")
def hub_contract_history_reconcile(
    league_id: str,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        raise HTTPException(status_code=403, detail="Not a member of this league")
    require_commissioner(ctx)
    from src.draft_hub.legacy_contract_history import reconcile_league_with_sleeper
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id

    sleeper_lid = resolve_sleeper_league_id(league_id) or ctx.get("sleeper_league_id")
    if not sleeper_lid:
        raise HTTPException(status_code=400, detail="Link Sleeper before reconciling history")
    return reconcile_league_with_sleeper(league_id, str(sleeper_lid))


@router.get("/league/{league_id}/ownership-history")
def hub_ownership_history(
    response: Response,
    league_id: str,
    refresh: bool = Query(False, description="Bypass cached Sleeper ownership history"),
    history_season: Optional[str] = Query(
        None,
        description="Dynasty history filter: current, all, or year e.g. 2024",
    ),
    _user=Depends(require_hub_user),
) -> dict:
    """Player ownership with Sleeper season chain merged (cached separately from insights)."""
    history_mode, history_year = _parse_history_season(history_season)
    with HubTimer("ownership-history", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
            if ctx.get("league_id") != league_id:
                raise HTTPException(status_code=403, detail="Not a member of this league")
        with timer.phase("overview"):
            try:
                overview = storage.league_roster_overview(league_id)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        with timer.phase("ownership"):
            return _hub_ownership_history_payload(
                league_id,
                overview,
                ctx,
                refresh=refresh,
                history_mode=history_mode,
                history_year=history_year,
            )


@router.get("/league/{league_id}/draft-recap")
def hub_draft_recap(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    _assert_league_access(league_id, sub)
    league = storage.get_league(league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    session = storage.get_draft_session(league_id) or {}
    draft_completed = bool(league.get("draft_completed")) or session.get("status") == "completed"
    if not draft_completed:
        raise HTTPException(status_code=404, detail="No completed draft recap for this league")
    try:
        overview = storage.league_roster_overview(league_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    recap = build_draft_recap(league_id, overview=overview)
    if recap:
        return recap
    test_mode = storage.league_test_mode(league_id)
    return {
        "headline": "Practice draft ended" if test_mode else "Draft ended",
        "subheadline": "No players were drafted.",
        "test_mode": test_mode,
        "pick_count": 0,
        "awards": [],
        "notable_picks": [],
    }


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
    workspace_id = storage.roster_workspace_for_league(league)
    linked_ws = storage.get_workspace_by_id(workspace_id) if league.get("workspace_id") else None
    rules = LeagueRules.model_validate(league["rules"])
    sleeper_ids = set((linked_ws or {}).get("sleeper_player_ids") or [])
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


@router.post("/mock-draft/start")
async def hub_mock_draft_start(body: MockDraftStartRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        result = start_mock_draft(
            sub,
            mode=body.mode,
            season=body.season,
            team_count=body.team_count,
            bot_count=body.bot_count,
            source_league_id=body.source_league_id,
            auto_start=body.auto_start,
            name=body.name,
        )
        await broadcast_room(result["league_id"])
        result["hub_context"] = _ctx(sub)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


@router.get("/sleeper/user/{username}/leagues")
def hub_sleeper_user_leagues(
    username: str,
    season: int = Query(..., ge=2015, le=2035),
    _user=Depends(require_hub_user),
) -> dict:
    from src.integrations.sleeper_league import list_user_leagues

    try:
        leagues = list_user_leagues(username, season)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"username": username.strip().lstrip("@"), "season": season, "leagues": leagues}


@router.get("/players/media")
def hub_players_media(
    ids: str = Query("", description="Comma-separated player_id values"),
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.draft_enrichment import build_player_media_batch

    player_ids = [p.strip() for p in ids.split(",") if p.strip()]
    hints = [{"player_id": pid} for pid in player_ids[:80]]
    media = build_player_media_batch(hints)
    return {"media": media}


@router.post("/cap-sheet/import")
async def hub_cap_sheet_import(
    file: UploadFile = File(...),
    replace_existing: bool = True,
    sync_sleeper_first: bool = Query(False, description="Pull live Sleeper rosters before applying sheet"),
    contracts_only: bool = Query(
        False,
        description="Update salaries/contracts only; do not wipe rosters (implies sync_sleeper_first)",
    ),
    _user=Depends(require_hub_user),
) -> dict:
    from pathlib import Path

    import yaml

    from src.config import DATA_DIR
    from src.draft_hub.cap_sheet_import import (
        import_cap_sheet_to_league,
        overlay_cap_sheet_contracts,
        parse_cap_sheet_tsv,
        sync_league_rosters_and_contracts,
    )

    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") != "league" or not ctx.get("is_commissioner"):
        raise HTTPException(status_code=403, detail="Only the league commissioner can import cap sheets")
    league_id = str(ctx.get("league_id") or "")
    if not league_id:
        raise HTTPException(status_code=400, detail="Join or create a league first")
    league = storage.get_league(league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    rules = LeagueRules.model_validate(league.get("rules") or ctx["rules"])
    raw = await file.read()
    try:
        parsed = parse_cap_sheet_tsv(raw, season=int(ctx.get("season") or league.get("season") or 2025), rules=rules)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    map_path = DATA_DIR / "draft_hub" / "manager_team_map.yaml"
    manager_map: dict[str, str] = {}
    if map_path.is_file():
        data = yaml.safe_load(map_path.read_text(encoding="utf-8")) or {}
        manager_map = {str(k): str(v) for k, v in data.items()}
    try:
        if contracts_only or sync_sleeper_first:
            result = sync_league_rosters_and_contracts(league_id, parsed, manager_map)
            result = {
                "mode": "sync_and_contracts",
                "imported": (result.get("contracts") or {}).get("updated", 0)
                + (result.get("contracts") or {}).get("added", 0),
                "by_team": {},
                "skipped_managers": (result.get("contracts") or {}).get("skipped_managers") or [],
                "sleeper_sync": result.get("sleeper"),
                "contract_overlay": result.get("contracts"),
                "waived": result.get("waived"),
            }
        else:
            result = import_cap_sheet_to_league(
                league_id,
                parsed,
                manager_map,
                replace_existing=replace_existing,
            )
            result["mode"] = "replace_rosters"
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if sync_sleeper_first or contracts_only:
        _refresh_scoring_cache_for_league(league_id)
    overview = storage.league_roster_overview(league_id)
    roster = list_roster_for_context(ctx)
    return {
        **result,
        "stats": parsed.get("stats"),
        "teams_found": parsed.get("teams_found"),
        "unmatched": parsed.get("unmatched"),
        "validation_errors": validate_roster(rules, roster),
        "team_count": len(overview.get("teams") or []),
    }


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
    league_id = result.get("league_id")
    if league_id:
        _refresh_scoring_cache_for_league(str(league_id))
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
    _refresh_scoring_cache_for_league(league_id)
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
    _refresh_scoring_cache_for_league(league_id)
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
