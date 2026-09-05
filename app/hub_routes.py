"""Draft Hub API routes."""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.auth import hub_auth_enabled, optional_user, require_hub_user, ws_user_from_token
from src.draft_hub import storage
from src.draft_hub.draft_enrichment import build_draft_room_enrichment, fantasy_media_digest_single
from src.draft_hub.draft_state import (
    award_nominee,
    user_is_draft_staff,
    check_timers,
    cut_player,
    end_draft,
    get_room_state,
    make_pick,
    nominate,
    place_bid,
    reset_live_draft,
    set_draft_contracts,
    set_nomination_order,
    set_pool_mode,
    pause_draft,
    resume_draft,
    set_draft_schedule,
    set_nomination_queue,
    skip_nomination,
    update_auction_rules,
)
from src.draft_hub.draft_pool import build_nomination_pool
from src.draft_hub.hub_media import resolve_hub_media_file
from src.draft_hub.draft_recap import build_draft_recap
from src.draft_hub.presets import list_presets, load_preset
from src.draft_hub.pre_draft_cap import (
    ROSTER_ACTIVE,
    ROSTER_CUT_BEFORE_DRAFT,
    cap_summary_for_phase,
    contract_on_cut_status_change,
    pre_draft_cap_summary,
    roster_for_pre_draft_validation,
)
from src.draft_hub.rules_engine import cap_summary, multi_year_cap_plan, validate_roster
from src.draft_hub.salary_import import match_ranges_to_pool, parse_salary_range_csv
from src.draft_hub.schemas import (
    ActiveLeagueUpdate,
    AuctionRulesUpdate,
    ContractExtendRequest,
    ContractRenewRequest,
    RookieExtendRequest,
    DraftBidRequest,
    DraftCutRequest,
    DraftEnrichmentRequest,
    DraftNominateRequest,
    DraftPoolModeRequest,
    LeagueCreateRequest,
    LeagueInviteAcceptRequest,
    LeagueInviteCreateRequest,
    LeagueClaimAcceptRequest,
    DraftAvailabilityUpdate,
    LeagueJoinRequest,
    LobbyJoinRequest,
    LobbyNameRequest,
    LobbySlotRequest,
    LeagueSettingsUpdate,
    NominationOrderUpdate,
    NominationQueueUpdate,
    LeagueRules,
    LeagueSheetImportRequest,
    ContractTypeDecisionRequest,
    ContractTypeUpdateRequest,
    FranchiseAddRequest,
    RosterAddRequest,
    RosterRemoveRequest,
    RosterUpdateRequest,
    HistoricCorrectionRequest,
    SleeperImportRequest,
    SleeperLeagueConnectRequest,
    SleeperLinkRequest,
    SleeperSyncRequest,
    DraftContractsRequest,
    MockDraftStartRequest,
    MockKeepRequest,
    SimulateDraftRequest,
    TestDraftSetupRequest,
    TradeSwapRequest,
    LeagueTradeRequest,
    TradeProposalCreate,
    TradeProposalRespond,
    ChatMessageCreateRequest,
    TeamCoCommissionerRequest,
    WorkspaceUpdate,
    FaBidRequest,
    AtmospherePrefsUpdate,
    TeamIdentityUpdate,
    WeekPollVoteRequest,
    VictoryEmoteRequest,
    LineupSetRequest,
    LineupSwapRequest,
    ScoreWeekRequest,
)
from src.draft_hub.contracts import (
    apply_rookie_extension_command,
    roster_row_from_import,
    swap_contracts,
    build_contract_from_roster_edit,
)
from src.draft_hub.contract_typing import CONTRACT_TYPES, apply_type_to_contract
from src.draft_hub.hub_context import list_roster_for_context, resolve_hub_context, roster_scope
from src.draft_hub.fa_market import (
    ensure_bidding_window,
    list_market,
    place_fa_bid,
    process_due_windows,
    process_window,
)
from src.draft_hub.league_permissions import can_edit_roster, require_commissioner, require_primary_commissioner
from src.draft_hub.league_resize import (
    LeagueResizeError,
    apply_add_franchise,
    apply_remove_franchise,
    league_resize_snapshot,
)
from src.draft_hub.league_analytics import build_league_analytics
from src.draft_hub.league_invites import build_invite_url, create_invite
from src.draft_hub.league_claim import (
    accept_claim_link,
    build_claim_preview,
    rotate_claim_link,
    staff_claim_payload,
)
from src.draft_hub.draft_availability import build_availability_payload, save_availability
from src.draft_hub.league_sleeper_sync import connect_sleeper_league
from src.draft_hub.league_sheet_import import parse_league_sheet_csv
from src.draft_hub.mock_draft import start_mock_draft
from src.draft_hub.draft_expire_preview import build_draft_expire_preview
from src.draft_hub.draft_recap import build_owner_draft_report
from src.draft_hub.test_draft import reset_test_draft, setup_test_draft, simulate_draft
from src.draft_hub.trade_executor import execute_league_trade
from src.draft_hub.trade_proposals import (
    cancel_proposal,
    force_execute_proposal,
    propose_trade,
    respond_to_proposal,
    validate_trade_package,
)
from src.draft_hub.roster_overview_enrich import enrich_league_roster_overview
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
            "owner_name": t.get("owner_name"),
        }
        for t in storage.list_league_teams(league_id)
    ]


def _refresh_scoring_cache_for_league(league_id: str) -> None:
    from src.draft_hub.insights_cache import build_and_store_fair_values, invalidate_cap_cache
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
        _warm_scoring_derived_for_league(league_id, str(sleeper_lid), hub_teams)
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
    try:
        invalidate_cap_cache(league_id)
        overview = storage.league_roster_overview(league_id)
        league = overview.get("league") or {}
        season = int(league.get("season") or 2025)
        build_and_store_fair_values(league_id, overview, season)
        # Re-materialize Spend tab so the next Insights visit skips overview rebuild.
        from src.draft_hub.insights_cache import write_cap_cache
        from src.draft_hub.league_analytics import build_league_analytics

        analytics = build_league_analytics(
            overview,
            draft_completed=bool(league.get("draft_completed")),
        )
        historic = _historic_insights_block(
            league_id,
            overview,
            mode="current",
            season_year=None,
            analytics=analytics,
        )
        write_cap_cache(
            league_id,
            history_mode="current",
            history_year=None,
            payload={"historic": historic, "analytics": analytics},
        )
    except Exception:
        logger.warning("fair value / cap warm failed for league %s", league_id, exc_info=True)


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


def _ctx_for_league(sub: str, league_id: str) -> dict[str, Any]:
    """Verify membership and auto-switch active league when URL targets a joined league."""
    _assert_league_access(league_id, sub)
    ctx = _ctx(sub)
    if ctx.get("league_id") != league_id:
        storage.set_hub_focus(sub, league_id=league_id)
        ctx = _ctx(sub)
    return ctx


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
            _clear_insights_response_cache(league_id)
            try:
                from src.draft_hub.insights_cache import invalidate_cap_cache

                invalidate_cap_cache(league_id)
            except Exception:
                pass
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
                draft_completed=bool(ctx.get("draft_completed")),
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
                    draft_completed=bool(ctx.get("draft_completed")),
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
                    draft_completed=bool(ctx.get("draft_completed")),
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


@router.get("/week")
def hub_weekly_command_center(
    response: Response,
    season: Optional[int] = Query(None, description="NFL season (defaults from hub + mlready)"),
    week: Optional[int] = Query(None, description="NFL week (defaults from mlready context)"),
    apply_injury_adjustments: bool = Query(True),
    bench_over_starter_threshold: float = Query(
        2.0,
        ge=0.0,
        description="Bench P50 must exceed starter P50 by this amount to recommend a swap",
    ),
    _user=Depends(require_hub_user),
) -> dict:
    """Personalized Your Week command center — roster × weekly artifacts (no live Sleeper)."""
    from fastapi.encoders import jsonable_encoder

    from src.draft_hub.weekly_command_center import build_weekly_command_center

    with HubTimer("week", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
        with timer.phase("build"):
            payload = build_weekly_command_center(
                ctx,
                season=season,
                week=week,
                apply_injury_adjustments=apply_injury_adjustments,
                bench_over_starter_threshold=bench_over_starter_threshold,
            )
    return jsonable_encoder(payload)


@router.post("/week/refresh")
def hub_refresh_weekly_command_center(
    response: Response,
    season: Optional[int] = Query(None, description="NFL season (defaults from hub + mlready)"),
    week: Optional[int] = Query(None, description="NFL week (defaults from mlready context)"),
    apply_injury_adjustments: bool = Query(True),
    bench_over_starter_threshold: float = Query(2.0, ge=0.0),
    _user=Depends(require_hub_user),
) -> dict:
    """Force-rebuild weekly projection artifacts, then return the Your Week payload."""
    from fastapi.encoders import jsonable_encoder

    from app.process_pool import get_process_executor
    from src.draft_hub.weekly_command_center import (
        build_weekly_command_center,
        resolve_week_context,
    )
    from src.projections.weekly_cache import rebuild_weekly_predictions

    with HubTimer("week-refresh", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
            hub_season = int(ctx["season"]) if ctx.get("season") is not None else None
            try:
                resolved_season, resolved_week = resolve_week_context(
                    season, week, hub_season=hub_season
                )
            except Exception:
                resolved_season = int(season or hub_season or 2026)
                resolved_week = int(week or 1)
        with timer.phase("rebuild"):
            try:
                counts = get_process_executor().submit(
                    rebuild_weekly_predictions,
                    int(resolved_season),
                    int(resolved_week),
                ).result()
            except Exception as exc:
                raise HTTPException(
                    status_code=503,
                    detail=f"Failed to rebuild weekly projections: {exc}",
                ) from exc
            # Worker invalidate() only clears that process. Fingerprint does not
            # change on rebuild, so the parent would keep serving stale frames.
            from src.projections.weekly_cache import invalidate_weekly_cache

            invalidate_weekly_cache()
        with timer.phase("build"):
            payload = build_weekly_command_center(
                ctx,
                season=resolved_season,
                week=resolved_week,
                apply_injury_adjustments=apply_injury_adjustments,
                bench_over_starter_threshold=bench_over_starter_threshold,
            )
    payload.setdefault("meta", {})
    payload["meta"]["rebuilt"] = True
    payload["meta"]["rebuild_counts"] = counts
    return jsonable_encoder(payload)


def _lineup_week_args(ctx: dict[str, Any], week: int | None, season: int | None) -> tuple[int, int]:
    from src.draft_hub.weekly_command_center import resolve_week_context

    hub_season = int(ctx["season"]) if ctx.get("season") is not None else None
    try:
        return resolve_week_context(season, week, hub_season=hub_season)
    except Exception:
        return int(season or hub_season or 2026), int(week or 1)


def _lineup_target_team(ctx: dict[str, Any], requested_team_id: str | None) -> str:
    own = str(ctx.get("team_id") or "")
    requested = str(requested_team_id or "").strip()
    if requested and requested != own and not ctx.get("is_commissioner"):
        raise HTTPException(status_code=403, detail="Commissioner managed")
    team_id = requested or own
    if not team_id:
        raise HTTPException(status_code=400, detail="No team on this league")
    return team_id


def _require_hub_hosted_scoring(ctx: dict[str, Any]) -> None:
    if ctx.get("sleeper_league_id"):
        raise HTTPException(status_code=409, detail="Lineups and scoring stay in Sleeper")


@router.get("/league/{league_id}/lineup")
def hub_get_lineup(
    league_id: str,
    week: Optional[int] = Query(None),
    season: Optional[int] = Query(None),
    team_id: Optional[str] = Query(None),
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.hub_scoring import ensure_team_lineup
    from src.draft_hub.schemas import LeagueRules

    ctx = _ctx_for_league(_sub(_user), league_id)
    _require_hub_hosted_scoring(ctx)
    resolved_season, resolved_week = _lineup_week_args(ctx, week, season)
    target = _lineup_target_team(ctx, team_id)
    rules = LeagueRules.model_validate(ctx.get("rules") or {})
    rows = ensure_team_lineup(league_id, target, resolved_season, resolved_week, rules=rules)
    return {
        "league_id": league_id,
        "team_id": target,
        "season": resolved_season,
        "week": resolved_week,
        "lineup": rows,
        "locked": any(row.get("locked") for row in rows),
    }


@router.put("/league/{league_id}/lineup")
def hub_set_lineup(
    league_id: str,
    body: LineupSetRequest,
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.hub_scoring import LineupError, set_team_starters
    from src.draft_hub.schemas import LeagueRules

    ctx = _ctx_for_league(_sub(_user), league_id)
    _require_hub_hosted_scoring(ctx)
    resolved_season, resolved_week = _lineup_week_args(ctx, body.week, body.season)
    target = _lineup_target_team(ctx, body.team_id)
    rules = LeagueRules.model_validate(ctx.get("rules") or {})
    try:
        rows = set_team_starters(
            league_id,
            target,
            resolved_season,
            resolved_week,
            [item.model_dump() for item in body.starters],
            rules=rules,
        )
    except LineupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "league_id": league_id,
        "team_id": target,
        "season": resolved_season,
        "week": resolved_week,
        "lineup": rows,
        "locked": any(row.get("locked") for row in rows),
    }


@router.post("/league/{league_id}/lineup/swap")
def hub_swap_lineup(
    league_id: str,
    body: LineupSwapRequest,
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.hub_scoring import LineupError, swap_lineup_players
    from src.draft_hub.schemas import LeagueRules

    ctx = _ctx_for_league(_sub(_user), league_id)
    _require_hub_hosted_scoring(ctx)
    resolved_season, resolved_week = _lineup_week_args(ctx, body.week, body.season)
    target = _lineup_target_team(ctx, body.team_id)
    rules = LeagueRules.model_validate(ctx.get("rules") or {})
    try:
        rows = swap_lineup_players(
            league_id,
            target,
            resolved_season,
            resolved_week,
            starter_player_id=body.starter_player_id,
            bench_player_id=body.bench_player_id,
            rules=rules,
        )
    except LineupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "league_id": league_id,
        "team_id": target,
        "season": resolved_season,
        "week": resolved_week,
        "lineup": rows,
        "locked": any(row.get("locked") for row in rows),
    }


@router.get("/league/{league_id}/schedule")
def hub_get_schedule(
    league_id: str,
    season: Optional[int] = Query(None),
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.hub_scoring import ensure_season_schedule
    from src.draft_hub.schemas import LeagueRules

    ctx = _ctx_for_league(_sub(_user), league_id)
    rules = LeagueRules.model_validate(ctx.get("rules") or {})
    payload = ensure_season_schedule(
        league_id,
        season=season or ctx.get("season"),
        rules=rules,
    )
    return payload


@router.post("/league/{league_id}/score-week")
def hub_score_week(
    league_id: str,
    body: ScoreWeekRequest,
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.hub_scoring import LineupError, apply_week_scores

    ctx = _ctx_for_league(_sub(_user), league_id)
    _require_hub_hosted_scoring(ctx)
    require_commissioner(ctx)
    resolved_season, resolved_week = _lineup_week_args(ctx, body.week, body.season)
    try:
        result = apply_week_scores(league_id, resolved_season, resolved_week)
    except LineupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@router.get("/atmosphere-catalog")
def hub_atmosphere_catalog(_user=Depends(require_hub_user)) -> dict:
    from src.draft_hub.league_atmosphere import atmosphere_catalog

    return atmosphere_catalog()


@router.get("/prefs")
def hub_get_prefs(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    prefs = storage.get_workspace_prefs(sub)
    return {"prefs": prefs, "hub_context": _ctx(sub)}


@router.patch("/prefs")
def hub_patch_prefs(body: AtmospherePrefsUpdate, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    prefs = storage.update_workspace_prefs(sub, body.model_dump(exclude_none=True))
    return {"prefs": prefs, "hub_context": _ctx(sub)}


def _viewer_can_edit_team(ctx: dict[str, Any], team: dict[str, Any]) -> bool:
    if not team:
        return False
    if str(team.get("id") or "") == str(ctx.get("team_id") or ""):
        return True
    return bool(ctx.get("is_commissioner"))


def _identity_payload(identity: dict[str, Any]) -> dict[str, Any]:
    photo_id = identity.get("photo_media_id")
    banner_id = identity.get("banner_media_id")
    return {
        **identity,
        "photo_url": f"/api/hub/media/{photo_id}" if photo_id else None,
        "banner_url": f"/api/hub/media/{banner_id}" if banner_id else None,
    }


@router.get("/league/{league_id}/identities")
def hub_league_identities(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    identities = {
        team_id: _identity_payload(identity)
        for team_id, identity in storage.list_league_identities(league_id).items()
    }
    return {
        "identities": identities,
        "catalog": __import__("src.draft_hub.league_atmosphere", fromlist=["atmosphere_catalog"]).atmosphere_catalog(),
        "hub_context": ctx,
    }


@router.patch("/league/{league_id}/teams/{team_id}/identity")
def hub_patch_team_identity(
    league_id: str,
    team_id: str,
    body: TeamIdentityUpdate,
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.league_atmosphere import locker_players_from_roster

    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    team = storage.get_team(team_id)
    if not team or str(team.get("league_id")) != str(league_id):
        raise HTTPException(status_code=404, detail="Team not found")
    if not _viewer_can_edit_team(ctx, team):
        raise HTTPException(status_code=403, detail="You can only customize your own team look")
    identity = storage.update_team_identity(team_id, body.model_dump(exclude_unset=True))
    ws_id, _team_id = roster_scope(ctx)
    roster = storage.list_roster(ws_id, team_id) if ws_id else []
    return {
        "identity": _identity_payload(identity),
        "lockers": locker_players_from_roster(identity, roster),
        "hub_context": _ctx(sub),
    }


@router.post("/league/{league_id}/teams/{team_id}/identity/media")
async def hub_upload_team_identity_media(
    league_id: str,
    team_id: str,
    kind: str = Query("photo"),
    attach: bool = Query(True),
    file: UploadFile = File(...),
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.league_atmosphere import MAX_MEDIA_BYTES, detect_image_type

    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    team = storage.get_team(team_id)
    if not team or str(team.get("league_id")) != str(league_id):
        raise HTTPException(status_code=404, detail="Team not found")
    if not _viewer_can_edit_team(ctx, team):
        raise HTTPException(status_code=403, detail="You can only customize your own team look")
    kind_clean = str(kind or "photo").strip().lower()
    if kind_clean not in {"photo", "banner"}:
        raise HTTPException(status_code=400, detail="Upload a photo or a banner")
    payload = await file.read(MAX_MEDIA_BYTES + 1)
    if len(payload) > MAX_MEDIA_BYTES:
        raise HTTPException(status_code=400, detail="Keep the image under 2 MB")
    content_type = detect_image_type(payload, file.content_type)
    if not content_type:
        raise HTTPException(status_code=400, detail="Use a JPEG, PNG, or WebP image")
    media = storage.store_hub_media(
        owner_sub=sub,
        league_id=league_id,
        team_id=team_id,
        kind=kind_clean,
        content_type=content_type,
        payload=payload,
    )
    if attach:
        field = "photo_media_id" if kind_clean == "photo" else "banner_media_id"
        identity = storage.update_team_identity(team_id, {field: media["id"]})
    else:
        identity = team.get("identity") or {}
    return {
        "media": media,
        "identity": _identity_payload(identity),
        "hub_context": _ctx(sub),
    }


@router.get("/media/{media_id}")
def hub_get_media(
    media_id: str,
    w: int | None = Query(None),
    _user=Depends(require_hub_user),
):
    media = storage.get_hub_media(media_id)
    if not media:
        raise HTTPException(status_code=404, detail="Image not found")
    if media.get("league_id"):
        _assert_league_access(str(media["league_id"]), _sub(_user))
    path, content_type = resolve_hub_media_file(media, w)
    return FileResponse(
        path,
        media_type=content_type,
        headers={"Cache-Control": "private, max-age=86400"},
    )


def _week_culture_matchup(league_id: str, ctx: dict[str, Any], week: int | None) -> dict[str, Any]:
    from src.draft_hub.league_live_scoring import get_sleeper_live_week
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id

    sleeper_lid = resolve_sleeper_league_id(league_id) or ctx.get("sleeper_league_id") or ""
    return get_sleeper_live_week(
        str(sleeper_lid),
        hub_teams=_hub_teams_for_scoring(league_id),
        week=week,
        viewer_roster_id=str(ctx.get("sleeper_roster_id") or "") or None,
        viewer_team_id=str(ctx.get("team_id") or "") or None,
        rules=ctx.get("rules"),
        refresh=False,
        hub_pre_draft=ctx.get("draft_completed") is False,
    )


def _normalize_scoring_matchups(
    scoring: dict[str, Any],
    hub_teams: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    by_sleeper = {
        str(team.get("sleeper_roster_id") or ""): str(team.get("id") or "")
        for team in (hub_teams or [])
        if team.get("sleeper_roster_id") and team.get("id")
    }
    out = []
    for matchup in scoring.get("matchups") or []:
        teams = []
        for team in matchup.get("teams") or []:
            hub_id = (
                team.get("hub_team_id")
                or team.get("team_id")
                or by_sleeper.get(str(team.get("roster_id") or ""))
                or team.get("id")
            )
            teams.append({**team, "hub_team_id": hub_id, "id": hub_id})
        out.append({**matchup, "teams": teams})
    return out


@router.get("/league/{league_id}/week-culture")
def hub_week_culture(
    league_id: str,
    week: Optional[int] = Query(None),
    season: Optional[int] = Query(None),
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.league_atmosphere import (
        TROPHY_POLLS,
        can_send_victory_emote,
        locker_players_from_roster,
        tally_poll_votes,
        viewer_matchup,
    )

    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    league = storage.get_league(league_id) or {}
    resolved_season = int(season or league.get("season") or ctx.get("season") or 0)
    scoring = _week_culture_matchup(league_id, ctx, week)
    resolved_week = int(week or scoring.get("week") or 1)
    teams = storage.list_league_teams(league_id)
    polls = storage.ensure_week_trophy_polls(league_id, resolved_season, resolved_week)
    poll_payload = []
    for poll in polls:
        votes = storage.list_week_poll_votes(str(poll["id"]))
        tally = tally_poll_votes(votes, teams, viewer_team_id=ctx.get("team_id"))
        meta = TROPHY_POLLS.get(str(poll["poll_key"]), {})
        poll_payload.append(
            {
                "id": poll["id"],
                "key": poll["poll_key"],
                "title": poll.get("title") or meta.get("title"),
                "support": meta.get("support"),
                **tally,
            }
        )
    matchups = _normalize_scoring_matchups(scoring, teams)
    mine = viewer_matchup(matchups, ctx.get("team_id"))
    opponent = None
    if mine:
        for team in mine.get("teams") or []:
            if str(team.get("hub_team_id") or team.get("id") or "") != str(ctx.get("team_id") or ""):
                opponent = team
                break
    emotes = storage.list_week_emotes(league_id, resolved_season, resolved_week)
    can_react = can_send_victory_emote(
        from_team_id=ctx.get("team_id"),
        to_team_id=str((opponent or {}).get("hub_team_id") or (opponent or {}).get("id") or "") or None,
        matchup=mine,
    )
    identities = {
        team_id: _identity_payload(identity)
        for team_id, identity in storage.list_league_identities(league_id).items()
    }
    ws_id, team_id = roster_scope(ctx)
    roster = storage.list_roster(ws_id, team_id) if ws_id and team_id else []
    viewer_identity = identities.get(str(ctx.get("team_id") or ""), {})
    return {
        "season": resolved_season,
        "week": resolved_week,
        "polls": poll_payload,
        "emotes": emotes,
        "matchup": mine,
        "opponent": opponent,
        "can_react": can_react,
        "scoring_available": bool(scoring.get("available")),
        "identities": identities,
        "lockers": locker_players_from_roster(viewer_identity, roster),
        "hub_context": ctx,
    }


@router.post("/league/{league_id}/week-culture/polls/{poll_id}/vote")
def hub_week_poll_vote(
    league_id: str,
    poll_id: str,
    body: WeekPollVoteRequest,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    if ctx.get("mode") != "league" or not ctx.get("team_id"):
        raise HTTPException(status_code=400, detail="Join a league team to vote")
    poll = storage.get_week_poll(poll_id)
    if not poll or str(poll.get("league_id")) != str(league_id):
        raise HTTPException(status_code=404, detail="Poll not found")
    nominee = storage.get_team(body.nominee_team_id)
    if not nominee or str(nominee.get("league_id")) != str(league_id):
        raise HTTPException(status_code=400, detail="Vote for a team in this league")
    try:
        storage.cast_week_poll_vote(poll_id, str(ctx["team_id"]), str(nominee["id"]))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return hub_week_culture(
        league_id,
        week=int(poll["week"]),
        season=int(poll["season"]),
        _user=_user,
    )


@router.post("/league/{league_id}/week-culture/emotes")
def hub_week_emote(
    league_id: str,
    body: VictoryEmoteRequest,
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.league_atmosphere import VICTORY_EMOTES, can_send_victory_emote, viewer_matchup

    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    if ctx.get("mode") != "league" or not ctx.get("team_id"):
        raise HTTPException(status_code=400, detail="Join a league team to send a reaction")
    emote_key = str(body.emote_key or "").strip().lower()
    if emote_key not in VICTORY_EMOTES:
        raise HTTPException(status_code=400, detail="Choose a reaction from the catalog")
    league = storage.get_league(league_id) or {}
    scoring = _week_culture_matchup(league_id, ctx, body.week)
    week = int(body.week or scoring.get("week") or 1)
    season = int(body.season or league.get("season") or ctx.get("season") or 0)
    matchup = viewer_matchup(
        _normalize_scoring_matchups(scoring, storage.list_league_teams(league_id)),
        ctx.get("team_id"),
    )
    if not can_send_victory_emote(
        from_team_id=ctx.get("team_id"),
        to_team_id=body.to_team_id,
        matchup=matchup,
    ):
        raise HTTPException(status_code=400, detail="Reactions unlock after you win the matchup")
    storage.upsert_matchup_emote(
        league_id=league_id,
        season=season,
        week=week,
        from_team_id=str(ctx["team_id"]),
        to_team_id=str(body.to_team_id),
        emote_key=emote_key,
    )
    return hub_week_culture(league_id, week=week, season=season, _user=_user)


@router.get("/home")
def hub_league_home(
    response: Response,
    include_week: bool = Query(
        True,
        description="When in-season, include lineup decision counts from weekly artifacts",
    ),
    _user=Depends(require_hub_user),
) -> dict:
    """Phase-aware League Home + action center (SCORE-10). No live Sleeper."""
    from fastapi.encoders import jsonable_encoder

    from src.draft_hub.league_home import build_league_home

    with HubTimer("home", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx(sub)
        with timer.phase("build"):
            payload = build_league_home(ctx, include_week=include_week)
    return jsonable_encoder(payload)


def _resolve_roster_add_team(ctx: dict[str, Any], requested_team_id: str | None) -> tuple[str | None, str]:
    """Return (team_id, destination label). Label is 'your team' for the caller's roster."""
    _ws_id, own_team_id = roster_scope(ctx)
    requested = str(requested_team_id or "").strip()
    if not requested:
        return own_team_id, "your team"
    if ctx.get("mode") != "league":
        raise HTTPException(status_code=400, detail="team_id is only valid in a league")
    team = storage.get_team(requested)
    if not team or str(team.get("league_id") or "") != str(ctx.get("league_id") or ""):
        raise HTTPException(status_code=400, detail="Team not found in this league")
    target_id = str(team["id"])
    if str(own_team_id or "") != target_id and not ctx.get("is_commissioner"):
        raise HTTPException(
            status_code=403,
            detail="Only the commissioner can add a player to another team",
        )
    if own_team_id and str(own_team_id) == target_id:
        return target_id, "your team"
    return target_id, str(team.get("name") or "this team")


@router.post("/roster")
def hub_add_roster(body: RosterAddRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") == "league" and not can_edit_roster(ctx):
        raise HTTPException(status_code=403, detail="Join a league team to edit your roster")
    window = ctx.get("acquisition_window") or {}
    if ctx.get("mode") == "league":
        lid = str(ctx.get("league_id") or "")
        if lid:
            process_due_windows(lid, window.get("window_id"))
        staff_edit = bool(body.staff_edit)
        if staff_edit and not ctx.get("is_commissioner"):
            raise HTTPException(status_code=403, detail="Only commissioners can make roster-management edits")
        if not staff_edit and not window.get("can_instant_add"):
            raise HTTPException(
                status_code=403,
                detail=window.get("message") or "Adding players is not open right now",
            )
    ws_id, _own_team_id = roster_scope(ctx)
    team_id, dest_label = _resolve_roster_add_team(ctx, body.team_id)
    existing = storage.get_roster_slot(ws_id, body.player_id)
    if existing:
        existing_team_id = str(existing.get("team_id") or "") or None
        same_team = bool(
            (team_id and existing_team_id == str(team_id))
            or (not team_id and not existing_team_id)
        )
        if same_team:
            already = (
                "your roster" if dest_label == "your team" else "this roster"
            )
            raise HTTPException(
                status_code=409,
                detail=f"{body.player_name or 'Player'} is already on {already}",
            )
        owner_label = "another team"
        if existing_team_id:
            owner = storage.get_team(existing_team_id)
            if owner and owner.get("name"):
                owner_label = str(owner["name"])
        pname = body.player_name or existing.get("player_name") or "Player"
        if ctx.get("mode") == "league" and not ctx.get("is_commissioner"):
            raise HTTPException(
                status_code=409,
                detail=f"{pname} is already on {owner_label}'s roster",
            )
        if not body.force:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"{pname} is already on {owner_label}'s roster. "
                    f"Confirm to reassign them to {dest_label}."
                ),
            )
    rules = LeagueRules.model_validate(ctx["rules"])
    ctype = str(body.contract_type or "").strip().lower() or None
    if ctype and ctype not in CONTRACT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="contract_type must be rookie, veteran, or extension",
        )
    contract = build_contract_from_roster_edit(
        rules,
        current_salary=float(body.salary),
        years_remaining=int(body.contract_years or 1),
        contract_type=ctype,
    )
    if ctype:
        contract["contract_type_manual"] = True
    sleeper_id = str(body.sleeper_player_id or "").strip() or None
    if not sleeper_id and str(body.player_id).isdigit():
        sleeper_id = str(body.player_id)
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
            "sleeper_player_id": sleeper_id,
        },
        team_id=team_id,
    )
    roster = storage.list_roster(ws_id, team_id) if team_id else list_roster_for_context(ctx)
    errors = validate_roster(rules, roster)
    _invalidate_league_rosters_from_ctx(ctx)
    return {"slot": row, "validation_errors": errors}


@router.delete("/roster")
def hub_remove_roster(body: RosterRemoveRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") == "league" and not can_edit_roster(ctx):
        raise HTTPException(status_code=403, detail="Join a league team to edit your roster")
    window = ctx.get("acquisition_window") or {}
    if ctx.get("mode") == "league" and window.get("roster_locked") and not ctx.get("is_commissioner"):
        raise HTTPException(
            status_code=403,
            detail=window.get("message") or "Rosters are locked",
        )
    ws_id, _team_id = roster_scope(ctx)
    ok = storage.remove_roster_slot(ws_id, body.player_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Player not on roster")
    _invalidate_league_rosters_from_ctx(ctx)
    return {"removed": body.player_id}


@router.get("/fa-market")
def hub_fa_market(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") != "league" or not ctx.get("league_id"):
        raise HTTPException(status_code=400, detail="Join a league to use FA bidding")
    window = ctx.get("acquisition_window") or {}
    lid = str(ctx["league_id"])
    processed = process_due_windows(lid, window.get("window_id"))
    market = list_market(lid, window_id=window.get("window_id"), team_id=ctx.get("team_id"))
    return {
        "window": window,
        "market": market,
        "processed": processed,
        "hub_context": ctx,
    }


@router.post("/fa-market/bid")
def hub_fa_market_bid(body: FaBidRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") != "league" or not ctx.get("league_id") or not ctx.get("team_id"):
        raise HTTPException(status_code=403, detail="Join a league team to bid")
    try:
        window = ensure_bidding_window(ctx)
        lid = str(ctx["league_id"])
        process_due_windows(lid, window.get("window_id"))
        result = place_fa_bid(
            league_id=lid,
            team_id=str(ctx["team_id"]),
            player_id=body.player_id,
            player_name=body.player_name,
            team=body.team,
            position=body.position,
            bid_amount=body.bid_amount,
            window_id=str(window["window_id"]),
            user_sub=sub,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "window": window, "hub_context": ctx}


@router.post("/fa-market/process")
def hub_fa_market_process(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    require_commissioner(ctx)
    if ctx.get("mode") != "league" or not ctx.get("league_id"):
        raise HTTPException(status_code=400, detail="Join a league first")
    window = ctx.get("acquisition_window") or {}
    wid = window.get("window_id")
    if not wid:
        processed = process_due_windows(str(ctx["league_id"]), None)
        return {"processed": processed, "window": window, "hub_context": ctx}
    try:
        result = process_window(str(ctx["league_id"]), str(wid))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _invalidate_league_rosters_from_ctx(ctx)
    return {**result, "window": window, "hub_context": ctx}


@router.post("/roster/contract-type")
def hub_set_roster_contract_type(body: ContractTypeUpdateRequest, _user=Depends(require_hub_user)) -> dict:
    """Dedicated contract-type writer — avoids general roster PATCH field-drop issues."""
    sub = _sub(_user)
    ctx = _ctx(sub)
    ws_id, team_id = roster_scope(ctx)
    ctype = str(body.contract_type or "").strip().lower()
    if ctype not in CONTRACT_TYPES:
        raise HTTPException(status_code=400, detail="contract_type must be rookie, veteran, or extension")
    if ctx.get("mode") == "league" and not (ctx.get("is_commissioner") or can_edit_roster(ctx)):
        raise HTTPException(status_code=403, detail="Join a league team to change contract type")

    can_apply = bool(
        ctx.get("mode") == "solo"
        or ctx.get("is_commissioner")
        or ctx.get("can_edit_salaries")
    )
    pending = False
    try:
        if can_apply:
            slot = storage.set_roster_contract_type(
                ws_id,
                body.player_id,
                ctype,
                team_id=team_id,
                any_team=bool(ctx.get("mode") == "league" and ctx.get("is_commissioner")),
                manual=True,
            )
        else:
            slot = storage.set_roster_contract_type(
                ws_id,
                body.player_id,
                ctype,
                team_id=team_id,
                any_team=False,
                pending_type=ctype,
                pending_by=sub,
            )
            pending = True
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    saved = (slot.get("contract") or {}).get("contract_type")
    if can_apply and saved != ctype:
        raise HTTPException(
            status_code=500,
            detail=f"Contract type failed to persist (got {saved!r}, wanted {ctype!r})",
        )

    _invalidate_league_rosters_from_ctx(ctx)
    rules = LeagueRules.model_validate(ctx["rules"])
    roster = list_roster_for_context(ctx)
    draft_completed = bool(ctx.get("draft_completed"))
    return {
        "slot": slot,
        "pending_type": pending,
        "received_contract_type": ctype,
        "saved_contract_type": saved if can_apply else (slot.get("contract") or {}).get("pending_type"),
        "validation_errors": validate_roster(rules, roster),
        "pre_draft": pre_draft_cap_summary(rules, roster, draft_completed=draft_completed),
        "hub_context": ctx,
    }


@router.patch("/roster")
def hub_update_roster(body: RosterUpdateRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    ws_id, team_id = roster_scope(ctx)
    draft_completed = bool(ctx.get("draft_completed"))
    salary_fields = body.salary is not None or body.contract_years is not None or body.salary_schedule is not None
    type_field = body.contract_type is not None
    status_field = body.roster_status is not None
    if salary_fields and ctx.get("mode") == "league" and not ctx.get("can_edit_salaries"):
        raise HTTPException(status_code=403, detail="Only the league commissioner can update salaries")
    if type_field and ctx.get("mode") == "league" and not (
        ctx.get("is_commissioner") or can_edit_roster(ctx)
    ):
        raise HTTPException(status_code=403, detail="Join a league team to propose contract type changes")
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
    if type_field and body.contract_type not in CONTRACT_TYPES:
        raise HTTPException(status_code=400, detail="contract_type must be rookie, veteran, or extension")
    existing = storage.get_roster_slot(ws_id, body.player_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Player not on roster")
    if ctx.get("mode") == "league" and not ctx.get("is_commissioner"):
        if existing.get("team_id") and str(existing["team_id"]) != str(team_id):
            raise HTTPException(status_code=403, detail="Cannot edit another team's roster")

    # SCORE-43: commissioner Office Current overrides require a reason + before/after.
    commissioner_override = bool(
        ctx.get("mode") == "league"
        and ctx.get("is_commissioner")
        and (salary_fields or status_field or (type_field and ctx.get("can_edit_salaries")))
    )
    note = str(body.note or "").strip() or None
    if commissioner_override and (salary_fields or status_field):
        if not note or len(note) < 3:
            raise HTTPException(
                status_code=400,
                detail="Commissioner override requires a reason (note, at least 3 characters)",
            )
    from src.draft_hub.historic_corrections import commissioner_override_before_after

    before_snap, after_snap = commissioner_override_before_after(
        existing,
        salary=body.salary,
        contract_years=yrs_in,
        roster_status=body.roster_status,
        contract_type=body.contract_type,
    )

    cur_sal = float(body.salary if body.salary is not None else existing["salary"])
    cur_yrs = int(yrs_in if yrs_in is not None else existing.get("contract_years") or 1)
    contract = None
    pending = False
    # Anyone who can edit salaries (commish / solo) applies type immediately.
    can_apply_type = bool(
        ctx.get("mode") == "solo"
        or ctx.get("is_commissioner")
        or ctx.get("can_edit_salaries")
    )

    if type_field and not can_apply_type and ctx.get("mode") == "league":
        try:
            slot = storage.set_roster_contract_type(
                ws_id,
                body.player_id,
                str(body.contract_type),
                team_id=team_id,
                any_team=False,
                pending_type=str(body.contract_type),
                pending_by=sub,
                edited_by_sub=sub,
                note=note,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        pending = True
        contract = slot.get("contract")
    elif type_field and can_apply_type:
        try:
            slot = storage.set_roster_contract_type(
                ws_id,
                body.player_id,
                str(body.contract_type),
                team_id=team_id,
                any_team=bool(ctx.get("mode") == "league" and ctx.get("is_commissioner")),
                manual=True,
                edited_by_sub=sub,
                note=note,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if not salary_fields and body.roster_status is None:
            roster = list_roster_for_context(ctx)
            _invalidate_league_rosters_from_ctx(ctx)
            payload = {
                "slot": slot,
                "validation_errors": validate_roster(rules, roster),
                "multi_year_plan": multi_year_cap_plan(rules, roster, draft_completed=draft_completed),
                "pre_draft": pre_draft_cap_summary(rules, roster, draft_completed=draft_completed),
                "pending_type": False,
                "received_contract_type": body.contract_type,
                "saved_contract_type": (slot.get("contract") or {}).get("contract_type"),
            }
            if commissioner_override:
                lid = ctx.get("league_id")
                revs = storage.league_cache_revisions(str(lid)) if lid else {}
                payload.update(
                    {
                        "before": before_snap,
                        "after": {
                            **after_snap,
                            "contract_type": (slot.get("contract") or {}).get("contract_type"),
                        },
                        "note": note,
                        "live_roster_revision": revs.get("live_roster_revision"),
                    }
                )
            return payload
        contract = build_contract_from_roster_edit(
            rules,
            current_salary=cur_sal,
            years_remaining=cur_yrs,
            existing=slot.get("contract"),
            step_up=float(rules.contracts.extension_step_up),
            salary_schedule=body.salary_schedule,
            contract_type=str(body.contract_type),
        )
        contract["contract_type_manual"] = True
    elif salary_fields:
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

    if type_field and not can_apply_type and ctx.get("mode") == "league":
        # Already persisted pending above.
        roster = list_roster_for_context(ctx)
        errors = validate_roster(rules, roster)
        plan = multi_year_cap_plan(rules, roster, draft_completed=draft_completed)
        pre_draft = pre_draft_cap_summary(rules, roster, draft_completed=draft_completed)
        _invalidate_league_rosters_from_ctx(ctx)
        return {
            "slot": slot,
            "validation_errors": errors,
            "multi_year_plan": plan,
            "pre_draft": pre_draft,
            "pending_type": True,
        }

    if type_field and contract is None:
        raise HTTPException(status_code=400, detail="Could not update contract type")

    try:
        from src.draft_hub.contract_service import apply_roster_edit

        slot = apply_roster_edit(
            ctx.get("league_id"),
            ws_id,
            body.player_id,
            team_id=team_id,
            contract=contract,
            roster_status=body.roster_status,
            any_team=bool(ctx.get("mode") == "league" and ctx.get("is_commissioner")),
            edited_by_sub=sub,
            note=note,
            op="edit",
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Re-read so the response reflects persisted JSON (catches write mismatches).
    persisted = storage.get_roster_slot(ws_id, body.player_id) or slot
    if type_field and can_apply_type:
        saved_type = (persisted.get("contract") or {}).get("contract_type")
        if saved_type != body.contract_type:
            raise HTTPException(
                status_code=500,
                detail=f"Contract type failed to persist (got {saved_type!r})",
            )

    roster = list_roster_for_context(ctx)
    errors = validate_roster(rules, roster)
    plan = multi_year_cap_plan(rules, roster, draft_completed=draft_completed)
    pre_draft = pre_draft_cap_summary(rules, roster, draft_completed=draft_completed)
    _invalidate_league_rosters_from_ctx(ctx)
    payload = {
        "slot": persisted,
        "validation_errors": errors,
        "multi_year_plan": plan,
        "pre_draft": pre_draft,
        "pending_type": pending,
    }
    if commissioner_override:
        lid = ctx.get("league_id")
        revs = storage.league_cache_revisions(str(lid)) if lid else {}
        payload.update(
            {
                "before": before_snap,
                "after": {
                    "player_id": persisted.get("player_id"),
                    "player_name": persisted.get("player_name"),
                    "salary": persisted.get("salary"),
                    "contract_years": persisted.get("contract_years"),
                    "roster_status": persisted.get("roster_status"),
                    "contract_type": (persisted.get("contract") or {}).get("contract_type"),
                },
                "note": note,
                "live_roster_revision": revs.get("live_roster_revision"),
            }
        )
    return payload


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
            errors = validate_roster(
                rules,
                roster_for_pre_draft_validation(rules, roster, draft_completed=draft_completed),
            )
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
            media_only=bool(body.media_only),
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/draft-room/fantasy-media-digest/{player_id}")
def hub_draft_fantasy_media_digest(
    player_id: str,
    player_name: Optional[str] = None,
    season: Optional[int] = None,
    week: Optional[int] = None,
    _user=Depends(require_hub_user),
) -> dict:
    try:
        return fantasy_media_digest_single(
            player_id, player_name=player_name, season=season, week=week
        )
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
    ctx = _ctx_for_league(sub, league_id)
    league = storage.get_league(league_id)
    try:
        from src.draft_hub.league_sleeper_sync import refresh_sleeper_display_names

        refresh_sleeper_display_names(league_id)
    except Exception:
        logger.debug("sleeper display-name refresh skipped", exc_info=True)
    teams = storage.list_league_teams(league_id)
    invites = storage.list_league_invites(league_id) if ctx.get("is_commissioner") else []
    out = {
        "teams": teams,
        "invites": invites,
        "hub_context": ctx,
        "commissioner_sub": league.get("commissioner_sub") if league else None,
    }
    if ctx.get("can_invite_members") and league:
        out["claim"] = staff_claim_payload(league)
    if ctx.get("is_commissioner") and league:
        try:
            out["resize"] = league_resize_snapshot(league_id)
        except LeagueResizeError:
            out["resize"] = None
    return out


@router.get("/league/{league_id}/rosters")
def hub_league_rosters(
    response: Response,
    league_id: str,
    refresh: bool = Query(False, description="Bypass cached league rosters payload"),
    _user=Depends(require_hub_user),
) -> dict:
    """All-team roster browser — any league member (read-only)."""
    from src.draft_hub import storage as hub_storage

    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    source_version = hub_storage.roster_source_version(league_id)
    from src.draft_hub.insights_cache import FAIR_VALUE_ALGO

    cache_key = f"{league_id}:{source_version}:{FAIR_VALUE_ALGO}:enriched"
    if not refresh:
        cached = _LEAGUE_ROSTERS_CACHE.get(cache_key)
        if cached and (time.time() - cached[0]) < _LEAGUE_ROSTERS_CACHE_TTL:
            response.headers["X-Roster-Cache"] = "hit"
            return cached[1]

    with HubTimer("league-rosters", response) as timer:
        with timer.phase("reattach"):
            ws_id = str(ctx.get("workspace_id") or "")
            league = storage.get_league(league_id) or {}
            league_ws = str(league.get("workspace_id") or "")
            if league_ws and storage.list_orphan_roster_slots(league_ws):
                from src.draft_hub.league_sleeper_sync import reattach_league_roster_slots

                reattach_league_roster_slots(league_id)
            elif ws_id and storage.list_orphan_roster_slots(ws_id):
                from src.draft_hub.league_sleeper_sync import reattach_league_roster_slots

                reattach_league_roster_slots(league_id)
        with timer.phase("overview"):
            try:
                overview = storage.league_roster_overview(league_id)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
        with timer.phase("enrich"):
            from src.draft_hub.insights_cache import build_and_store_fair_values, read_fair_values

            league_meta = overview.get("league") or {}
            season_int = int(league_meta.get("season") or 0)
            fair_map = read_fair_values(league_id, season_int) if season_int else None
            if not fair_map and season_int:
                with timer.phase("fair-warm"):
                    fair_map = build_and_store_fair_values(league_id, overview, season_int)
            overview = enrich_league_roster_overview(overview, fair_map=fair_map or {})

    payload = {
        **overview,
        "hub_context": ctx,
        "source_version": source_version,
        **hub_storage.league_cache_revisions(league_id),
    }
    _LEAGUE_ROSTERS_CACHE[cache_key] = (time.time(), payload)
    response.headers["X-Roster-Cache"] = "miss"
    return payload


@router.get("/league/{league_id}/trades")
def hub_list_trade_proposals(
    league_id: str,
    status: Optional[str] = Query(None),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    proposals = storage.list_trade_proposals(league_id, status=status)
    return {"proposals": proposals, "count": len(proposals), "hub_context": ctx}


@router.post("/league/{league_id}/trades")
async def hub_create_trade_proposal(
    league_id: str,
    body: TradeProposalCreate,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    if not ctx.get("team_id"):
        raise HTTPException(status_code=403, detail="Join a league team to propose trades")
    parties = [p.model_dump() for p in body.parties]
    assignments = [a.model_dump() for a in body.dead_cap_assignments]
    try:
        if body.validate_only:
            check = validate_trade_package(league_id, parties, assignments)
            return {**check, "hub_context": ctx}
        proposal = propose_trade(
            league_id,
            created_by_sub=sub,
            proposer_team_id=str(ctx["team_id"]),
            parties=parties,
            dead_cap_assignments=assignments,
            note=body.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _invalidate_league_rosters_from_ctx(ctx)
    await broadcast_room(league_id)
    return {"proposal": proposal, "hub_context": ctx}


@router.get("/league/{league_id}/trades/{proposal_id}")
def hub_get_trade_proposal(
    league_id: str,
    proposal_id: str,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    prop = storage.get_trade_proposal(proposal_id)
    if not prop or prop.get("league_id") != league_id:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return {"proposal": prop, "hub_context": ctx}


@router.post("/league/{league_id}/trades/{proposal_id}/respond")
async def hub_respond_trade_proposal(
    league_id: str,
    proposal_id: str,
    body: TradeProposalRespond,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    team_id = str(ctx.get("team_id") or "")
    if not team_id:
        raise HTTPException(status_code=403, detail="Join a league team to respond")
    try:
        prop = respond_to_proposal(
            proposal_id, team_id=team_id, approve=body.approve, user_sub=sub
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if prop.get("status") == "executed":
        _invalidate_league_rosters_from_ctx(ctx)
    await broadcast_room(league_id)
    return {"proposal": prop, "hub_context": ctx}


@router.post("/league/{league_id}/trades/{proposal_id}/force")
async def hub_force_trade_proposal(
    league_id: str,
    proposal_id: str,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    try:
        prop = force_execute_proposal(proposal_id, commissioner_sub=sub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _invalidate_league_rosters_from_ctx(ctx)
    await broadcast_room(league_id)
    return {"proposal": prop, "hub_context": ctx}


@router.post("/league/{league_id}/trades/{proposal_id}/cancel")
async def hub_cancel_trade_proposal(
    league_id: str,
    proposal_id: str,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    try:
        prop = cancel_proposal(
            proposal_id,
            user_sub=sub,
            is_commissioner=bool(ctx.get("is_commissioner")),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await broadcast_room(league_id)
    return {"proposal": prop, "hub_context": ctx}


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


def _league_award_titles(league: dict | None) -> dict[str, str]:
    from src.draft_hub.insight_awards import normalize_award_titles

    rules = (league or {}).get("rules") or {}
    return normalize_award_titles(rules.get("insight_award_titles"))


def _with_award_titles(awards: list | None, league: dict | None) -> list:
    from src.draft_hub.insight_awards import apply_award_titles

    return apply_award_titles(awards or [], _league_award_titles(league))


def _parse_insights_sections(value: str | None) -> set[str] | None:
    """None = full payload; otherwise only build listed sections."""
    if not value or not str(value).strip():
        return None
    return {part.strip().lower() for part in str(value).split(",") if part.strip()}


def _insights_section(wanted: set[str] | None, name: str) -> bool:
    return wanted is None or name in wanted


_INSIGHTS_RESPONSE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_INSIGHTS_CACHE_TTL = 900.0
_INSIGHTS_SCORING_CACHE_TTL = 120.0
_LEAGUE_ROSTERS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_LEAGUE_ROSTERS_CACHE_TTL = 120.0


def _clear_league_rosters_cache(league_id: str | None = None) -> None:
    if not league_id:
        _LEAGUE_ROSTERS_CACHE.clear()
        return
    prefix = f"{league_id}:"
    for key in list(_LEAGUE_ROSTERS_CACHE):
        if key.startswith(prefix):
            del _LEAGUE_ROSTERS_CACHE[key]


def _clear_insights_response_cache(league_id: str | None = None) -> None:
    if not league_id:
        _INSIGHTS_RESPONSE_CACHE.clear()
        return
    prefix = f"{league_id}:"
    for key in list(_INSIGHTS_RESPONSE_CACHE):
        if key.startswith(prefix):
            del _INSIGHTS_RESPONSE_CACHE[key]


def _invalidate_league_rosters_from_ctx(ctx: dict[str, Any]) -> None:
    lid = str(ctx.get("league_id") or "")
    if lid:
        _clear_league_rosters_cache(lid)
        _clear_insights_response_cache(lid)


def _insights_cache_key(
    league_id: str,
    *,
    sections: str | None,
    history_season: str | None,
    scoring_season: str | None,
    source_version: str | None = None,
) -> str:
    from src.draft_hub import storage

    sec = sections or "all"
    ver = source_version or storage.insights_source_version(league_id)
    return f"{league_id}:{sec}:{history_season or 'current'}:{scoring_season or ''}:{ver}"


def _enrich_cap_analytics(
    analytics: dict,
    league_id: str,
    *,
    year_specific: bool,
    season_year: int | None = None,
) -> dict:
    from src.draft_hub.owner_display import enrich_team_row, team_owner_map_for_league

    if analytics.get("identity") == "owner":
        return {**analytics, "teams": analytics.get("teams") or []}
    owner_map = team_owner_map_for_league(league_id, season_year=season_year)
    teams = [
        enrich_team_row(t, owner_map, year_specific=year_specific)
        for t in (analytics.get("teams") or [])
    ]
    return {**analytics, "teams": teams}


def _resolve_cap_for_insights(
    league_id: str,
    season_year: int | None,
    default_cap: float,
) -> float:
    if season_year is not None:
        return storage.resolve_salary_cap_for_season(league_id, int(season_year), default_cap)
    return default_cap


def _contract_view_for_season(league: dict[str, Any], season_year: int | None) -> str:
    """Use effective Sleeper projection for planning season when draft is complete."""
    if season_year is None:
        return "snapshot"
    planning = league.get("season")
    if planning is None or int(season_year) != int(planning):
        return "snapshot"
    if league.get("draft_completed"):
        return "effective"
    return "snapshot"


def _historic_insights_block(
    league_id: str,
    overview: dict,
    *,
    mode: str,
    season_year: int | None,
    analytics: dict | None = None,
) -> dict:
    from src.draft_hub.historic_insights import (
        build_contract_analytics,
        build_contract_awards,
        build_current_spend_awards,
        build_historic_meta,
    )

    meta = build_historic_meta(league_id)
    league = overview.get("league") or {}
    default_cap = float(overview.get("salary_cap") or (league.get("rules") or {}).get("salary_cap") or 200)

    if not meta.get("available"):
        awards = (
            build_current_spend_awards(overview, salary_cap=default_cap, analytics=analytics)
            if mode == "current"
            else []
        )
        return {**meta, "mode": mode, "season": season_year, "awards": _with_award_titles(awards, league)}

    view = _contract_view_for_season(league, season_year if mode == "year" else None)

    if mode == "year" and season_year is not None:
        cap = _resolve_cap_for_insights(league_id, season_year, default_cap)
        analytics = build_contract_analytics(
            league_id, season_year=season_year, salary_cap=cap, view=view,
        )
        awards = build_contract_awards(league_id, season_year=season_year, salary_cap=cap)
    elif mode == "all":
        analytics = build_contract_analytics(league_id, season_year=None, salary_cap=default_cap)
        awards = build_contract_awards(league_id, season_year=None, salary_cap=default_cap)
    else:
        cap = default_cap
        if season_year is not None:
            cap = _resolve_cap_for_insights(league_id, season_year, default_cap)
        awards = build_current_spend_awards(overview, salary_cap=cap, analytics=analytics)

    return {
        **meta,
        "mode": mode,
        "season": season_year,
        "contract_view": view,
        "analytics": analytics,
        "awards": _with_award_titles(awards, league),
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
    from src.draft_hub.league_efficiency import build_cap_efficiency
    from src.draft_hub.owner_display import scoring_owner_maps_for_league, scoring_year_specific

    league = overview.get("league") or {}
    default_cap = float(overview.get("salary_cap") or (league.get("rules") or {}).get("salary_cap") or 200)
    eff_cap_year: int | None = None
    if cap_efficiency_season and str(cap_efficiency_season).isdigit():
        eff_cap_year = int(cap_efficiency_season)
    elif history_mode == "year" and history_year is not None:
        eff_cap_year = history_year

    eff_analytics = analytics
    if eff_cap_year is not None:
        cap = _resolve_cap_for_insights(league_id, eff_cap_year, default_cap)
        view = _contract_view_for_season(league, eff_cap_year)
        contract_cap = build_contract_analytics(
            league_id, season_year=eff_cap_year, salary_cap=cap, view=view,
        )
        if contract_cap:
            eff_analytics = contract_cap

    display_season = str(
        cap_efficiency_season
        or scoring.get("requested_season")
        or scoring.get("season")
        or ""
    )
    owner_map, sleeper_owner_map = scoring_owner_maps_for_league(
        league_id,
        season_year=eff_cap_year or (int(display_season) if display_season.isdigit() else None),
        sleeper_league_id=scoring.get("sleeper_league_id"),
    )
    plan = str(planning_season or (overview.get("league") or {}).get("season") or "")
    year_specific = scoring_year_specific(display_season, plan)
    return build_cap_efficiency(
        eff_analytics,
        scoring,
        owner_map=owner_map,
        sleeper_owner_map=sleeper_owner_map,
        year_specific=year_specific,
    )


def _warm_scoring_derived_for_league(
    league_id: str,
    sleeper_lid: str,
    hub_teams: list[dict[str, Any]],
) -> None:
    from src.draft_hub.insights_cache import scoring_season_key, write_scoring_derived
    from src.draft_hub.league_analytics import build_league_analytics
    from src.draft_hub.league_history import get_sleeper_scoring_history
    from src.draft_hub.owner_display import planning_season_for_user, scoring_owner_maps_for_league
    from src.draft_hub.scoring_insights import build_scoring_awards

    try:
        overview = storage.league_roster_overview(league_id)
    except ValueError:
        return
    league = overview.get("league") or {}
    draft_completed = bool(league.get("draft_completed"))
    analytics = build_league_analytics(overview, draft_completed=draft_completed)
    scoring = get_sleeper_scoring_history(str(sleeper_lid), hub_teams=hub_teams, refresh=False)
    if not isinstance(scoring, dict) or not scoring.get("available"):
        return
    sub = str(league.get("commissioner_sub") or "")
    planning_season = planning_season_for_user(sub, league) if sub else None
    efficiency = _build_cap_efficiency_for_insights(
        league_id,
        overview,
        analytics,
        scoring,
        cap_efficiency_season=None,
        history_mode="current",
        history_year=None,
        planning_season=planning_season,
    )
    display_season = str(scoring.get("requested_season") or scoring.get("season") or "current")
    owner_map, sleeper_owner_map = scoring_owner_maps_for_league(
        league_id,
        season_year=display_season if display_season.isdigit() else None,
        sleeper_league_id=scoring.get("sleeper_league_id") or str(sleeper_lid),
    )
    awards = build_scoring_awards(
        scoring,
        efficiency=efficiency,
        owner_map=owner_map,
        sleeper_owner_map=sleeper_owner_map,
        planning_season=planning_season,
    )
    resolved_sleeper = str(scoring.get("sleeper_league_id") or sleeper_lid)
    write_scoring_derived(
        resolved_sleeper,
        scoring_season_key(display_season),
        awards=awards,
        efficiency=efficiency,
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
        description="Comma-separated blocks: overview,cap,scoring,trades,ownership (default all except overview)",
    ),
    ownership_only: bool = Query(False, description="Return Sleeper ownership history only"),
    _user=Depends(require_hub_user),
) -> dict:
    history_mode, history_year = _parse_history_season(history_season)
    wanted_sections = _parse_insights_sections(sections)
    from src.draft_hub import storage as hub_storage

    source_version = hub_storage.insights_source_version(league_id)
    cache_key: str | None = None
    cache_ttl = _INSIGHTS_SCORING_CACHE_TTL if wanted_sections == {"scoring"} else _INSIGHTS_CACHE_TTL
    if not refresh and not ownership_only:
        cache_key = _insights_cache_key(
            league_id,
            sections=sections,
            history_season=history_season,
            scoring_season=scoring_season,
            source_version=source_version,
        )
        cached = _INSIGHTS_RESPONSE_CACHE.get(cache_key)
        if cached and (time.time() - cached[0]) < cache_ttl:
            return cached[1]
    with HubTimer("league-insights", response) as timer:
        with timer.phase("ctx"):
            sub = _sub(_user)
            ctx = _ctx_for_league(sub, league_id)

        # Cap-only Spend tab: serve SQLite materialization without reloading every roster.
        if (
            not refresh
            and not ownership_only
            and wanted_sections == {"cap"}
        ):
            from src.draft_hub.insights_cache import read_cap_cache
            from src.draft_hub.owner_display import planning_season_for_user, team_owner_map_for_league

            with timer.phase("cap_cache"):
                cached_cap, _cap_version = read_cap_cache(
                    league_id,
                    history_mode=history_mode,
                    history_year=history_year,
                )
            analytics_hit = (cached_cap or {}).get("analytics") or {}
            if cached_cap and (analytics_hit.get("teams") or []):
                league = storage.get_league(league_id) or {}
                historic_hit = cached_cap.get("historic") or {"available": False, "awards": []}
                if historic_hit.get("awards"):
                    historic_hit = {
                        **historic_hit,
                        "awards": _with_award_titles(historic_hit.get("awards"), league),
                    }
                payload = {
                    "analytics": analytics_hit,
                    "trade": {
                        "my_team_id": str(team_id or ctx.get("team_id") or ""),
                        "balance": {},
                        "actionable_needs": [],
                        "partners": [],
                        "suggestions": [],
                    },
                    "draft_recap": None,
                    "scoring": {"available": False, "reason": "not_loaded"},
                    "scoring_awards": [],
                    "efficiency": {"available": False, "teams": []},
                    "ownership": {"players": [], "player_count": 0},
                    "historic": historic_hit,
                    "owner_map": team_owner_map_for_league(league_id),
                    "planning_season": planning_season_for_user(sub, league),
                    "hub_context": ctx,
                    "cache_status": {"cap": "hit"},
                    "timing_ms": round(sum(timer.phases.values()), 1) if timer.phases else None,
                }
                if cache_key:
                    _INSIGHTS_RESPONSE_CACHE[cache_key] = (time.time(), payload)
                return payload

        # Overview landing: champions / records / scoring leaders without roster rebuild.
        if (
            not refresh
            and not ownership_only
            and wanted_sections == {"overview"}
        ):
            from src.draft_hub.insight_awards import award_catalog
            from src.draft_hub.league_history import build_insights_landing
            from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id
            from src.draft_hub.owner_display import planning_season_for_user, team_owner_map_for_league

            with timer.phase("landing"):
                league = storage.get_league(league_id) or {}
                sleeper_lid = resolve_sleeper_league_id(league_id) or ""
                landing = build_insights_landing(
                    str(sleeper_lid),
                    hub_teams=_hub_teams_for_scoring(league_id),
                    refresh=False,
                    award_titles=_league_award_titles(league),
                )
                payload = {
                    "analytics": {"teams": [], "positions": []},
                    "trade": {
                        "my_team_id": str(team_id or ctx.get("team_id") or ""),
                        "balance": {},
                        "actionable_needs": [],
                        "partners": [],
                        "suggestions": [],
                    },
                    "draft_recap": None,
                    "scoring": {"available": False, "reason": "not_loaded"},
                    "scoring_awards": [],
                    "efficiency": {"available": False, "teams": []},
                    "ownership": {"players": [], "player_count": 0},
                    "historic": {"available": False, "awards": []},
                    "landing": landing,
                    "award_catalog": landing.get("award_catalog") or award_catalog(_league_award_titles(league)),
                    "owner_map": team_owner_map_for_league(league_id),
                    "planning_season": planning_season_for_user(sub, league),
                    "hub_context": ctx,
                    "cache_status": {"overview": "hit" if landing.get("available") else "miss"},
                    "timing_ms": round(sum(timer.phases.values()), 1) if timer.phases else None,
                }
                if cache_key:
                    _INSIGHTS_RESPONSE_CACHE[cache_key] = (time.time(), payload)
                return payload

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
        cache_status: dict[str, str] = {}

        with timer.phase("analytics"):
            if _insights_section(wanted_sections, "cap") or _insights_section(wanted_sections, "trades"):
                from src.draft_hub.insights_cache import read_cap_cache, write_cap_cache

                cached_cap, cap_version = read_cap_cache(
                    league_id,
                    history_mode=history_mode,
                    history_year=history_year,
                )
                if cached_cap and not refresh:
                    historic = cached_cap.get("historic") or {"available": False, "awards": []}
                    analytics = cached_cap.get("analytics") or analytics
                    needs_teams = _insights_section(wanted_sections, "trades") or _insights_section(wanted_sections, "cap")
                    if needs_teams and not (analytics.get("teams") or []):
                        cached_cap = None
                    else:
                        cache_status["cap"] = "hit"
                if not cached_cap or refresh:
                    cache_status["cap"] = "miss"
                    try:
                        if history_mode in {"year", "all"}:
                            historic = _historic_insights_block(
                                league_id,
                                overview,
                                mode=history_mode,
                                season_year=history_year,
                            )
                            if historic.get("analytics"):
                                analytics = historic["analytics"]
                                if history_mode in {"year", "all"}:
                                    analytics = _enrich_cap_analytics(
                                        analytics,
                                        league_id,
                                        year_specific=(history_mode == "year"),
                                        season_year=history_year if history_mode == "year" else None,
                                    )
                            else:
                                analytics = build_league_analytics(overview, draft_completed=draft_completed)
                        else:
                            analytics = build_league_analytics(overview, draft_completed=draft_completed)
                            historic = _historic_insights_block(
                                league_id,
                                overview,
                                mode=history_mode,
                                season_year=history_year,
                                analytics=analytics,
                            )
                        if _insights_section(wanted_sections, "cap"):
                            write_cap_cache(
                                league_id,
                                history_mode=history_mode,
                                history_year=history_year,
                                payload={"historic": historic, "analytics": analytics},
                                source_version=cap_version,
                            )
                    except Exception as exc:
                        logging.getLogger(__name__).exception(
                            "insights cap block failed league=%s", league_id,
                        )
                        historic = {"available": False, "awards": [], "error": str(exc)}
                        analytics = build_league_analytics(overview, draft_completed=draft_completed)
            if _insights_section(wanted_sections, "trades"):
                from src.draft_hub.insights_cache import read_fair_values

                try:
                    season_int = int(league.get("season") or 2025)
                    fair_map = read_fair_values(league_id, season_int)
                    if fair_map:
                        cache_status["fair_values"] = "hit"
                    else:
                        cache_status["fair_values"] = "miss"
                    trade = build_trade_insights(
                        overview,
                        my_team_id=my_team_id,
                        season=season_int,
                        draft_completed=draft_completed,
                        analytics=analytics,
                        fair_map=fair_map,
                    )
                    if not fair_map and not trade.get("suggestions"):
                        trade["hint"] = (
                            trade.get("hint")
                            or "Fair values not warmed yet — sync Sleeper or open Available players, then retry."
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
                from src.draft_hub.insights_cache import read_scoring_derived, scoring_season_key

                if not (analytics.get("teams") or []):
                    from src.draft_hub.insights_cache import read_cap_cache

                    cap_hit, _ = read_cap_cache(
                        league_id,
                        history_mode=history_mode,
                        history_year=history_year,
                    )
                    if cap_hit and (cap_hit.get("analytics") or {}).get("teams"):
                        analytics = cap_hit["analytics"]
                    else:
                        analytics = build_league_analytics(overview, draft_completed=draft_completed)

                try:
                    effective_scoring_season = scoring_season
                    if not effective_scoring_season and history_mode == "all":
                        effective_scoring_season = "all"
                    elif not effective_scoring_season and history_mode == "year" and history_year is not None:
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
                    cache_status["scoring"] = "hit" if scoring.get("cached") else "miss"
                    from src.draft_hub.owner_display import (
                        enrich_team_row,
                        planning_season_for_user,
                        scoring_owner_maps_for_league,
                        scoring_year_specific,
                    )
                    from src.draft_hub.scoring_insights import build_scoring_awards

                    planning_season = planning_season_for_user(sub, league)
                    season_key = scoring_season_key(effective_scoring_season)
                    resolved_sleeper = str(
                        (scoring.get("sleeper_league_id") if isinstance(scoring, dict) else None)
                        or sleeper_lid
                        or ""
                    )
                    derived = (
                        read_scoring_derived(resolved_sleeper, season_key)
                        if resolved_sleeper and not refresh
                        else None
                    )
                    if derived:
                        cache_status["scoring_derived"] = "hit"
                        efficiency = derived.get("efficiency") or {"available": False, "teams": []}
                        prebuilt_awards = derived.get("awards") or []
                    else:
                        cache_status["scoring_derived"] = "miss"
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
                        prebuilt_awards = None

                    if isinstance(scoring, dict):
                        scoring = dict(scoring)
                        if effective_scoring_season:
                            scoring["season"] = str(effective_scoring_season)
                            scoring["requested_season"] = str(effective_scoring_season)
                        display_season = str(
                            effective_scoring_season
                            or scoring.get("requested_season")
                            or scoring.get("season")
                            or ""
                        )
                        owner_map, sleeper_owner_map = scoring_owner_maps_for_league(
                            league_id,
                            season_year=display_season if display_season.isdigit() else None,
                            sleeper_league_id=scoring.get("sleeper_league_id") or str(sleeper_lid or ""),
                        )
                        year_specific = scoring_year_specific(display_season, planning_season)
                        if scoring.get("standings"):
                            scoring["standings"] = [
                                enrich_team_row(
                                    s,
                                    owner_map,
                                    year_specific=year_specific,
                                    sleeper_owner_map=sleeper_owner_map,
                                )
                                for s in scoring["standings"]
                            ]
                        scoring["owner_map"] = owner_map
                        if prebuilt_awards is not None:
                            scoring["awards"] = prebuilt_awards
                        else:
                            scoring["awards"] = build_scoring_awards(
                                scoring,
                                efficiency=efficiency,
                                owner_map=owner_map,
                                sleeper_owner_map=sleeper_owner_map,
                                planning_season=planning_season,
                            )
                            if resolved_sleeper:
                                from src.draft_hub.insights_cache import write_scoring_derived

                                write_scoring_derived(
                                    resolved_sleeper,
                                    season_key,
                                    awards=scoring["awards"],
                                    efficiency=efficiency,
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

    landing = None
    if wanted_sections and "overview" in wanted_sections:
        from src.draft_hub.insight_awards import award_catalog
        from src.draft_hub.league_history import build_insights_landing
        from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id

        with timer.phase("landing"):
            sleeper_lid = resolve_sleeper_league_id(league_id) or ""
            landing = build_insights_landing(
                str(sleeper_lid),
                hub_teams=_hub_teams_for_scoring(league_id),
                refresh=refresh,
                award_titles=_league_award_titles(league),
            )

    if scoring.get("awards"):
        scoring = {**scoring, "awards": _with_award_titles(scoring.get("awards"), league)}
    if historic.get("awards"):
        historic = {**historic, "awards": _with_award_titles(historic.get("awards"), league)}

    payload = {
        "analytics": analytics,
        "trade": trade,
        "draft_recap": draft_recap,
        "scoring": scoring,
        "scoring_awards": scoring.get("awards") or [],
        "efficiency": efficiency,
        "ownership": ownership,
        "historic": historic,
        "landing": landing,
        "award_catalog": (landing or {}).get("award_catalog"),
        "owner_map": team_owner_map_for_league(league_id),
        "planning_season": planning_season_for_user(sub, league),
        "hub_context": ctx,
        "cache_status": cache_status,
        "timing_ms": round(sum(timer.phases.values()), 1) if timer.phases else None,
    }
    if cache_key:
        _INSIGHTS_RESPONSE_CACHE[cache_key] = (time.time(), payload)
    return payload


@router.get("/league/{league_id}/insights/status")
def hub_league_insights_status(
    league_id: str,
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.insights_cache import insights_status
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id

    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    sleeper_lid = resolve_sleeper_league_id(league_id) or ""
    league = storage.get_league(league_id) or {}
    chain_seasons: list[str] = []
    if sleeper_lid:
        from src.draft_hub.league_history import sleeper_league_season_chain

        chain_seasons = [str(c["season"]) for c in sleeper_league_season_chain(str(sleeper_lid))]
    status = insights_status(league_id, str(sleeper_lid) if sleeper_lid else None)
    return {
        **status,
        "planning_season": str(league.get("season") or ""),
        "available_scoring_seasons": chain_seasons,
    }


@router.get("/league/{league_id}/insights/overview")
def hub_league_insights_overview(
    response: Response,
    league_id: str,
    refresh: bool = Query(False),
    _user=Depends(require_hub_user),
) -> dict:
    return hub_league_insights(
        response=response,
        league_id=league_id,
        refresh=refresh,
        sections="overview",
        ownership_only=False,
        _user=_user,
    )


@router.get("/league/{league_id}/insights/cap")
def hub_league_insights_cap(
    response: Response,
    league_id: str,
    history_season: Optional[str] = Query(None),
    refresh: bool = Query(False),
    _user=Depends(require_hub_user),
) -> dict:
    return hub_league_insights(
        response=response,
        league_id=league_id,
        refresh=refresh,
        history_season=history_season,
        sections="cap",
        ownership_only=False,
        _user=_user,
    )


@router.get("/league/{league_id}/insights/scoring")
def hub_league_insights_scoring(
    response: Response,
    league_id: str,
    refresh: bool = Query(False),
    scoring_season: Optional[str] = Query(None),
    cap_efficiency_season: Optional[str] = Query(None),
    history_season: Optional[str] = Query(None),
    _user=Depends(require_hub_user),
) -> dict:
    return hub_league_insights(
        response=response,
        league_id=league_id,
        refresh=refresh,
        scoring_season=scoring_season,
        cap_efficiency_season=cap_efficiency_season,
        history_season=history_season,
        sections="scoring",
        ownership_only=False,
        _user=_user,
    )


@router.get("/league/{league_id}/insights/trades")
def hub_league_insights_trades(
    response: Response,
    league_id: str,
    team_id: Optional[str] = None,
    refresh: bool = Query(False),
    _user=Depends(require_hub_user),
) -> dict:
    return hub_league_insights(
        response=response,
        league_id=league_id,
        team_id=team_id,
        refresh=refresh,
        sections="trades",
        ownership_only=False,
        _user=_user,
    )


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
            ctx = _ctx_for_league(sub, league_id)
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
                from src.draft_hub.owner_display import planning_season_for_user, scoring_owner_maps_for_league

                display_season = str(
                    scoring.get("requested_season") or scoring.get("season") or scoring_season or ""
                )
                owner_map, sleeper_owner_map = scoring_owner_maps_for_league(
                    league_id,
                    season_year=display_season if display_season.isdigit() else None,
                    sleeper_league_id=scoring.get("sleeper_league_id") or str(sleeper_lid or ""),
                )
                planning_season = planning_season_for_user(sub, league)
                awards = _with_award_titles(
                    build_scoring_awards(
                        scoring,
                        efficiency=efficiency,
                        owner_map=owner_map,
                        sleeper_owner_map=sleeper_owner_map,
                        planning_season=planning_season,
                    ),
                    league,
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
            ctx = _ctx_for_league(sub, league_id)
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
            if sleeper_lid:
                scoring = get_sleeper_live_week(
                    str(sleeper_lid),
                    hub_teams=hub_teams,
                    week=week,
                    viewer_roster_id=str(viewer_rid) if viewer_rid else None,
                    viewer_team_id=str(ctx.get("team_id") or "") or None,
                    rules=ctx.get("rules"),
                    refresh=refresh,
                    hub_pre_draft=ctx.get("draft_completed") is False,
                )
            else:
                from src.draft_hub.hub_scoring import build_hub_live_week

                scoring = build_hub_live_week(
                    league_id,
                    week=week,
                    viewer_team_id=str(ctx.get("team_id") or "") or None,
                    rules=ctx.get("rules"),
                    refresh=refresh,
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
    all_seasons: bool = Query(False, description="Return all seasons (default is latest only)"),
    owner: Optional[str] = Query(None, description="Filter to commissioner owner label"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    from src.draft_hub.legacy_contract_history import build_contract_history_payload

    return build_contract_history_payload(
        league_id,
        season_year=season,
        owner_label=owner,
        all_seasons=all_seasons,
    )


@router.get("/league/{league_id}/contract-history/audit")
def hub_contract_history_audit(
    league_id: str,
    season: int = Query(..., description="Season year to audit"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    from src.draft_hub.contract_history_audit import audit_contract_history

    return audit_contract_history(league_id, season_year=int(season))


@router.get("/league/{league_id}/contract-history/sleeper-hints")
def hub_contract_history_sleeper_hints(
    league_id: str,
    season: int = Query(..., description="Season year for owner-change hints"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    from src.draft_hub.sleeper_acquisition_hints import build_sleeper_hints_payload

    return build_sleeper_hints_payload(league_id, season_year=int(season))


@router.get("/league/{league_id}/team-salary-sheets")
def hub_team_salary_sheets(
    league_id: str,
    response: Response,
    season: Optional[int] = Query(None, description="Season year for roster sheets"),
    view: Optional[str] = Query(None, description="snapshot or effective"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    from src.draft_hub.team_salary_sheets import build_team_salary_sheets_payload

    league = storage.get_league(league_id) or {}
    cap = float((league.get("rules") or ctx.get("rules") or {}).get("salary_cap") or 200)
    sheet_view = view or "snapshot"
    if sheet_view not in ("snapshot", "effective"):
        sheet_view = "snapshot"
    response.headers["Cache-Control"] = "no-store"
    return build_team_salary_sheets_payload(
        league_id,
        season_year=int(season) if season is not None else None,
        salary_cap=cap,
        view=sheet_view,
    )


@router.get("/league/{league_id}/team-salary-sheets/audit")
def hub_team_salary_sheets_audit(
    league_id: str,
    season: Optional[int] = Query(None, description="Season year to audit"),
    owner: Optional[str] = Query(None, description="Owner label (omit for all teams)"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    from src.draft_hub.salary_sheet_audit import build_salary_sheet_audit

    return build_salary_sheet_audit(
        league_id,
        season_year=int(season) if season is not None else None,
        owner_label=owner.strip() if owner else None,
    )


@router.get("/league/{league_id}/contract-history/player-journey")
def hub_contract_history_player_journey(
    league_id: str,
    player: str = Query(..., min_length=1),
    season: Optional[int] = Query(None, description="Season being edited (highlights that row)"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    from src.draft_hub.legacy_contract_history import build_player_contract_journey
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id

    league = storage.get_league(league_id) or {}
    sleeper_lid = resolve_sleeper_league_id(league_id) or league.get("sleeper_league_id")

    return build_player_contract_journey(
        league_id,
        player.strip(),
        editing_season=int(season) if season is not None else None,
        sleeper_league_id=str(sleeper_lid) if sleeper_lid else None,
    )


class AuditPatchItem(BaseModel):
    row_id: Optional[int] = None
    season_year: Optional[int] = None
    patch: dict[str, Any]


class AuditApplyFlagsBody(BaseModel):
    patches: list[AuditPatchItem]


@router.post("/league/{league_id}/contract-history/audit/apply-flags")
def hub_contract_history_apply_flags(
    league_id: str,
    body: AuditApplyFlagsBody,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    from src.draft_hub.contract_history_audit import apply_audit_patches

    patches = [p.model_dump(exclude_none=True) for p in body.patches]
    return apply_audit_patches(league_id, patches, edited_by_sub=sub)


class MovementResolveBody(BaseModel):
    event_type: Optional[str] = None
    story: Optional[str] = None
    from_owner: Optional[str] = None
    to_owner: Optional[str] = None
    salary: Optional[float] = None
    dead_cap: Optional[float] = None


class MovementBulkResolveBody(BaseModel):
    movement_ids: list[int]
    story: str


@router.post("/league/{league_id}/contract-history/movements/bulk-resolve")
def hub_contract_history_movement_bulk_resolve(
    league_id: str,
    body: MovementBulkResolveBody,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    from src.draft_hub.contract_movement_resolve import apply_story_to_movements

    if not body.movement_ids:
        raise HTTPException(status_code=400, detail="movement_ids required")
    updated = apply_story_to_movements(league_id, body.movement_ids, body.story)
    return {"updated": updated, "count": len(updated)}


@router.post("/league/{league_id}/contract-history/movements/{movement_id}/resolve")
def hub_contract_history_movement_resolve(
    league_id: str,
    movement_id: int,
    body: MovementResolveBody,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    mov = storage.get_league_movement(movement_id)
    if not mov or mov.get("league_id") != league_id:
        raise HTTPException(status_code=404, detail="Movement not found")
    if body.story:
        from src.draft_hub.contract_movement_resolve import apply_story_to_movements

        updated = apply_story_to_movements(league_id, [movement_id], body.story)
        return updated[0] if updated else mov
    updates = body.model_dump(exclude_none=True)
    updates.pop("story", None)
    if not updates.get("event_type"):
        raise HTTPException(status_code=400, detail="event_type or story required")
    updates["confidence"] = "manual"
    updated = storage.update_league_movement(movement_id, updates)
    return updated or mov


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
    # SCORE-43: salary patches require a correction reason; prefer POST .../correct.
    note: Optional[str] = None


@router.patch("/league/{league_id}/contract-history/{row_id}")
def hub_contract_history_patch(
    league_id: str,
    row_id: int,
    body: ContractRowPatch,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    row = storage.get_league_contract_row(row_id)
    if not row or row.get("league_id") != league_id:
        raise HTTPException(status_code=404, detail="Contract row not found")
    updates = body.model_dump(exclude_none=True)
    note = updates.pop("note", None)
    if not updates:
        return row
    salary_touch = any(k in updates for k in ("cap_hit", "base_salary", "prior_salary"))
    if salary_touch and (not note or len(str(note).strip()) < 3):
        raise HTTPException(
            status_code=400,
            detail=(
                "Historic salary corrections require a reason. "
                "Use POST /contract-history/{row_id}/correct (history_only | preview_forward | apply_forward)."
            ),
        )
    if updates.get("roster_status") == "cut" or (
        str(row.get("roster_status") or "") == "cut" and "cap_hit" in updates
    ):
        from src.draft_hub.contract_history_audit import apply_cut_dead_cap_to_row_updates
        from src.draft_hub.schemas import LeagueRules

        league = storage.get_league(league_id) or {}
        pct = float(LeagueRules.model_validate(league.get("rules") or {}).contracts.cut_refund_pct)
        updates = apply_cut_dead_cap_to_row_updates(row, updates, cut_refund_pct=pct)
    updated = storage.update_league_contract_row(row_id, updates, edited_by_sub=sub, note=note)
    _clear_insights_response_cache(league_id)
    return updated


@router.get("/league/{league_id}/contract-history/corrections")
def hub_contract_corrections_list(
    league_id: str,
    season: Optional[int] = Query(None, description="Filter by season year"),
    row_id: Optional[int] = Query(None, description="Filter by contract row id"),
    limit: int = Query(50, ge=1, le=200),
    _user=Depends(require_hub_user),
) -> dict:
    """SCORE-43: list published historic correction events (snapshot versions)."""
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    rows = storage.list_historic_corrections(
        league_id,
        season_year=season,
        row_id=row_id,
        limit=limit,
    )
    revs = storage.league_cache_revisions(league_id)
    return {
        "corrections": rows,
        "historic_snapshot_revision": revs["historic_snapshot_revision"],
        "live_roster_revision": revs["live_roster_revision"],
    }


@router.get("/league/{league_id}/contract-history/{row_id}/correction-context")
def hub_contract_correction_context(
    league_id: str,
    row_id: int,
    _user=Depends(require_hub_user),
) -> dict:
    """SCORE-43: source, phase, original values, and snapshot revision for Correct historical record."""
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    from src.draft_hub.historic_corrections import correction_context

    try:
        return correction_context(league_id, int(row_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/league/{league_id}/contract-history/{row_id}/correct")
def hub_contract_correct(
    league_id: str,
    row_id: int,
    body: HistoricCorrectionRequest,
    _user=Depends(require_hub_user),
) -> dict:
    """SCORE-43: publish a historic correction (history-only or preview/apply forward)."""
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    from src.draft_hub.historic_corrections import correct_historic_row

    top_level = body.model_dump(
        exclude_none=True,
        exclude={"reason", "mode", "updates", "forward_rebuild_approved"},
    )
    updates = dict(body.updates or {})
    updates.update(top_level)
    try:
        result = correct_historic_row(
            league_id,
            int(row_id),
            reason=body.reason,
            mode=body.mode,
            updates=updates,
            edited_by_sub=sub,
            forward_rebuild_approved=bool(body.forward_rebuild_approved),
        )
    except ValueError as exc:
        msg = str(exc)
        code = 404 if "not found" in msg.lower() else 400
        raise HTTPException(status_code=code, detail=msg) from exc
    if result.get("applied"):
        _clear_insights_response_cache(league_id)
        if result.get("live_applied"):
            _invalidate_league_rosters_from_ctx(ctx)
    return result


class ContractRowCreate(BaseModel):
    season_year: int
    owner_label: str
    player_name: str
    cap_hit: float
    hub_team_name: Optional[str] = None
    player_id: Optional[str] = None
    position: Optional[str] = None
    base_salary: Optional[float] = None
    prior_salary: Optional[float] = None
    original_draft_year: Optional[int] = None
    roster_status: Optional[str] = "active"
    contract_phase: Optional[str] = None
    acquisition_type: Optional[str] = None
    status_note: Optional[str] = None


@router.post("/league/{league_id}/contract-history")
def hub_contract_history_create(
    league_id: str,
    body: ContractRowCreate,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    row = body.model_dump()
    if str(row.get("roster_status") or "active") == "cut":
        from src.draft_hub.contract_history_audit import normalize_cut_cap_hit
        from src.draft_hub.schemas import LeagueRules

        league = storage.get_league(league_id) or {}
        pct = float(LeagueRules.model_validate(league.get("rules") or {}).contracts.cut_refund_pct)
        prior = row.get("prior_salary")
        if prior is None:
            prior = row.get("cap_hit")
            row["prior_salary"] = prior
        dead = normalize_cut_cap_hit(
            cap_hit=row.get("cap_hit"),
            prior_salary=prior,
            cut_refund_pct=pct,
        )
        if dead is not None:
            row["cap_hit"] = dead
            row["base_salary"] = dead
    if row.get("base_salary") is None:
        row["base_salary"] = row["cap_hit"]
    if not row.get("hub_team_name"):
        row["hub_team_name"] = storage.resolve_hub_team_name(
            league_id, int(row["season_year"]), row["owner_label"].strip()
        )
    return storage.insert_league_contract_row(league_id, int(row.pop("season_year")), row)


@router.delete("/league/{league_id}/contract-history/{row_id}")
def hub_contract_history_delete(
    league_id: str,
    row_id: int,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
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
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    from src.draft_hub.contract_sync import sync_commissioner_sheets

    return sync_commissioner_sheets(league_id, imported_by_sub=sub, reconcile_sleeper=True)


@router.get("/league/{league_id}/contract-history/sync-status")
def hub_contract_history_sync_status(
    league_id: str,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    from src.draft_hub.contract_sync import commissioner_sync_status

    imports = storage.list_legacy_imports(league_id)
    return {
        **commissioner_sync_status(league_id),
        "imports": imports,
    }


@router.get("/league/{league_id}/contract-history/quarantine")
def hub_contract_history_quarantine(
    league_id: str,
    season: Optional[int] = Query(None, description="Optional season filter"),
    _user=Depends(require_hub_user),
) -> dict:
    """SCORE-44: quarantined import blocks + rows that must not be auto-resolved."""
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    from src.draft_hub.sourced_checkpoints import list_checkpoint_specs

    items = storage.list_league_import_quarantine(
        league_id,
        season_year=int(season) if season is not None else None,
    )
    by_reason: dict[str, int] = {}
    for item in items:
        code = str(item.get("reason_code") or "unknown")
        by_reason[code] = by_reason.get(code, 0) + 1
    return {
        "league_id": league_id,
        "season_year": int(season) if season is not None else None,
        "count": len(items),
        "by_reason": by_reason,
        "items": items,
        "checkpoints": list_checkpoint_specs(),
    }


@router.get("/league/{league_id}/contracts/archived")
def hub_contracts_archived(
    league_id: str,
    _user=Depends(require_hub_user),
) -> dict:
    """SCORE-45: list archived expired contracts (status + as_of + snapshot)."""
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    from src.draft_hub.contract_service import list_archived_contracts

    items = list_archived_contracts(league_id)
    return {
        "league_id": league_id,
        "count": len(items),
        "items": items,
    }


@router.get("/league/{league_id}/freshness")
def hub_league_freshness(
    league_id: str,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    from src.draft_hub.hub_freshness import league_data_freshness

    include_detail = bool(ctx.get("is_commissioner"))
    return league_data_freshness(league_id, include_contract_detail=include_detail)


class ContractSyncBody(BaseModel):
    snapshot_phases: Optional[dict[str, str]] = None
    reconcile_sleeper: bool = True


@router.post("/league/{league_id}/contract-history/sync")
def hub_contract_history_sync(
    league_id: str,
    body: Optional[ContractSyncBody] = None,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    from src.draft_hub.contract_sync import sync_commissioner_sheets

    phases_raw = (body.snapshot_phases if body else None) or {}
    phases = {int(k): str(v) for k, v in phases_raw.items()}
    return sync_commissioner_sheets(
        league_id,
        imported_by_sub=sub,
        reconcile_sleeper=body.reconcile_sleeper if body else True,
        snapshot_phases=phases or None,
    )


@router.post("/league/{league_id}/contract-history/build-week1")
def hub_contract_history_build_week1(
    league_id: str,
    season: int = Query(..., description="Season year to build from Sleeper week-1 matchups"),
    _user=Depends(require_hub_user),
) -> dict:
    """Build / replace year-sheet rows from Sleeper week-1 rosters (salary seeded from Excel/prior).

    Manual Historic overlays are preserved (SCORE-39); other seasons are untouched.
    """
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    from src.draft_hub.sheet_roster_sync import sync_sleeper_year_sheet

    try:
        return sync_sleeper_year_sheet(
            league_id,
            season_year=int(season),
            mode="week1",
            imported_by_sub=sub,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Week-1 build failed: {exc}") from exc


@router.post("/league/{league_id}/contract-history/build-pre-draft")
def hub_contract_history_build_pre_draft(
    league_id: str,
    season: int = Query(..., description="Season year to seed from current/pre-draft Sleeper rosters"),
    _user=Depends(require_hub_user),
) -> dict:
    """Seed a year sheet from live Sleeper rosters before the draft (salaries from prior year).

    Manual Historic overlays are preserved (SCORE-39); other seasons are untouched.
    """
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    from src.draft_hub.sheet_roster_sync import sync_sleeper_year_sheet

    try:
        return sync_sleeper_year_sheet(
            league_id,
            season_year=int(season),
            mode="pre_draft",
            imported_by_sub=sub,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Pre-draft build failed: {exc}") from exc


@router.get("/league/{league_id}/contract-history/apply-sleeper-moves")
def hub_contract_apply_sleeper_moves_preview(
    league_id: str,
    season: int = Query(..., description="Season year to preview"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    from src.draft_hub.in_season_contract_projection import diff_effective_vs_db

    return diff_effective_vs_db(league_id, int(season))


@router.post("/league/{league_id}/contract-history/apply-sleeper-moves")
def hub_contract_apply_sleeper_moves(
    league_id: str,
    season: int = Query(..., description="Season year to materialize"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    from src.draft_hub.in_season_contract_projection import materialize_sleeper_moves

    return materialize_sleeper_moves(league_id, int(season), edited_by_sub=sub)


@router.post("/league/{league_id}/contract-history/reconcile-sleeper")
def hub_contract_history_reconcile(
    league_id: str,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    from src.draft_hub.legacy_contract_history import reconcile_league_with_sleeper
    from src.draft_hub.league_sleeper_sync import resolve_sleeper_league_id

    sleeper_lid = resolve_sleeper_league_id(league_id) or ctx.get("sleeper_league_id")
    if not sleeper_lid:
        raise HTTPException(status_code=400, detail="Link Sleeper before reconciling history")
    return reconcile_league_with_sleeper(league_id, str(sleeper_lid))


class OwnerSeasonMapUpsert(BaseModel):
    season_year: int
    owner_label: str
    hub_team_name: str
    sleeper_user_id: Optional[str] = None


class SeasonSalaryCapUpsert(BaseModel):
    season_year: int
    salary_cap: float


@router.get("/league/{league_id}/owner-season-map")
def hub_owner_season_map_list(
    league_id: str,
    season: Optional[int] = Query(None, description="Filter to one season year"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    rows = storage.list_owner_season_map(league_id, season_year=season)
    return {"rows": rows, "season_year": season}


@router.put("/league/{league_id}/owner-season-map")
def hub_owner_season_map_upsert(
    league_id: str,
    body: OwnerSeasonMapUpsert,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    row = storage.upsert_owner_season_map(
        league_id,
        int(body.season_year),
        body.owner_label.strip(),
        body.hub_team_name.strip(),
        sleeper_user_id=body.sleeper_user_id,
        source_kind="manual",
    )
    return row


@router.put("/league/{league_id}/season-salary-cap")
def hub_season_salary_cap_upsert(
    league_id: str,
    body: SeasonSalaryCapUpsert,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    if body.salary_cap < 0:
        raise HTTPException(status_code=400, detail="salary_cap must be non-negative")
    try:
        return storage.upsert_season_salary_cap(
            league_id,
            int(body.season_year),
            float(body.salary_cap),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/league/{league_id}/owner-season-map/{map_id}")
def hub_owner_season_map_delete(
    league_id: str,
    map_id: int,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    if not storage.delete_owner_season_map(map_id, league_id):
        raise HTTPException(status_code=404, detail="Owner map row not found")
    return {"deleted": True, "id": map_id}


class PlayerNameAliasUpsert(BaseModel):
    alias_name: str
    canonical_name: Optional[str] = None
    sleeper_player_id: Optional[str] = None
    position: Optional[str] = None


@router.get("/league/{league_id}/player-name-aliases")
def hub_player_name_aliases_list(
    league_id: str,
    include_unmapped: bool = Query(
        False,
        description="Scan cap sheets for unmapped abbreviations (slow; omit after saves)",
    ),
    season: Optional[int] = Query(None, description="Season for unmapped scan"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    from src.draft_hub.player_name_aliases import enrich_alias_rows, find_unmapped_names

    league = storage.get_league(league_id) or {}
    draft_season = int(
        season
        if season is not None
        else league.get("draft_season") or league.get("season") or 2025
    )
    rows = enrich_alias_rows(
        league_id,
        storage.list_player_name_aliases(league_id),
        season=draft_season,
    )
    out: dict[str, Any] = {"rows": rows, "season_year": draft_season}
    if include_unmapped:
        out["unmapped_names"] = find_unmapped_names(league_id, season=draft_season)
    return out


@router.get("/league/{league_id}/player-name-aliases/lookup")
def hub_player_name_alias_lookup(
    league_id: str,
    sleeper_player_id: str = Query(..., min_length=1),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    from src.integrations.sleeper import player_by_sleeper_id

    info = player_by_sleeper_id(sleeper_player_id.strip())
    if not info:
        raise HTTPException(status_code=404, detail="Sleeper player not found")
    return info


@router.get("/league/{league_id}/player-name-aliases/suggest")
def hub_player_name_alias_suggest(
    league_id: str,
    name: Optional[str] = Query(None),
    sleeper_player_id: Optional[str] = Query(None),
    position: Optional[str] = Query(None),
    season: Optional[int] = Query(None),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    league = _ctx_for_league(sub, league_id)
    sid = str(sleeper_player_id or "").strip()
    if sid:
        from src.integrations.sleeper import player_by_sleeper_id

        info = player_by_sleeper_id(sid)
        if not info:
            return {"suggestions": []}
        return {"suggestions": [{**info, "source": "sleeper"}]}

    q = str(name or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="name or sleeper_player_id is required")

    from src.draft_hub.player_name_aliases import suggest_canonical_names

    yr = int(season) if season is not None else int(league.get("draft_season") or league.get("season") or 2025)
    return {
        "suggestions": suggest_canonical_names(
            q,
            position=position,
            season=yr,
            sleeper_only=False,
        ),
    }


@router.put("/league/{league_id}/player-name-aliases")
def hub_player_name_alias_upsert(
    league_id: str,
    body: PlayerNameAliasUpsert,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    from src.draft_hub.player_name_aliases import prepare_alias_upsert

    try:
        fields = prepare_alias_upsert(
            body.alias_name.strip(),
            canonical_name=body.canonical_name.strip() if body.canonical_name else None,
            sleeper_player_id=body.sleeper_player_id,
            position=body.position,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    row = storage.upsert_player_name_alias(
        league_id,
        fields["alias_name"],
        fields["canonical_name"],
        position=fields.get("position"),
        sleeper_player_id=fields.get("sleeper_player_id"),
        source_kind="manual",
    )
    return row


@router.delete("/league/{league_id}/player-name-aliases/{alias_id}")
def hub_player_name_alias_delete(
    league_id: str,
    alias_id: int,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    if not storage.delete_player_name_alias(alias_id, league_id):
        raise HTTPException(status_code=404, detail="Player name alias not found")
    return {"deleted": True, "id": alias_id}


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
            ctx = _ctx_for_league(sub, league_id)
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
    ctx = _ctx_for_league(sub, league_id)
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
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    prior = storage.get_league(league_id) or {}
    was_complete = bool(prior.get("draft_completed"))
    league = storage.update_league_settings(
        league_id,
        lock_team_claims=body.lock_team_claims,
        draft_completed=body.draft_completed,
        claim_link_enabled=body.claim_link_enabled,
    )
    if body.clear_draft_start or body.draft_starts_at is not None or body.draft_timezone is not None:
        try:
            from src.draft_hub.draft_state import set_draft_schedule as _set_sked

            state = _set_sked(
                league_id,
                sub,
                starts_at=body.draft_starts_at,
                timezone_name=body.draft_timezone,
                clear=bool(body.clear_draft_start),
            )
            league = state.get("league") or storage.get_league(league_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    year_tick = None
    if body.draft_completed is True and not was_complete:
        from src.draft_hub.contract_year_clock import tick_contracts_on_draft_complete

        year_tick = tick_contracts_on_draft_complete(league_id)
    out: dict = {"league": league, "hub_context": _ctx(sub)}
    if year_tick is not None:
        out["contract_year_tick"] = year_tick
    return out


@router.post("/league/{league_id}/teams/{team_id}/release-claim")
def hub_release_team_claim(league_id: str, team_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    try:
        team = storage.release_team_claim(league_id, team_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"team": team, "hub_context": _ctx(sub)}


@router.post("/league/{league_id}/franchises")
def hub_add_franchise(
    league_id: str,
    body: FranchiseAddRequest,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    try:
        result = apply_add_franchise(league_id, body.name)
    except LeagueResizeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result["hub_context"] = _ctx(sub)
    result["resize"] = league_resize_snapshot(league_id)
    return result


@router.delete("/league/{league_id}/franchises/{team_id}")
def hub_remove_franchise(
    league_id: str,
    team_id: str,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    try:
        result = apply_remove_franchise(league_id, team_id, actor_sub=sub)
    except LeagueResizeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result["hub_context"] = _ctx(sub)
    result["resize"] = league_resize_snapshot(league_id)
    return result


@router.post("/league/{league_id}/invites")
def hub_create_league_invite(
    league_id: str,
    body: LeagueInviteCreateRequest,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    if body.co_commissioner and not ctx.get("is_primary_commissioner"):
        raise HTTPException(
            status_code=403,
            detail="Only the primary commissioner can invite co-commissioners",
        )
    try:
        invite = create_invite(
            league_id,
            body.email,
            body.team_name,
            sub,
            co_commissioner=bool(body.co_commissioner),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"invite": invite, "hub_context": _ctx(sub)}


@router.get("/league/{league_id}/invites")
def hub_list_league_invites(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
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
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    if not storage.revoke_league_invite(league_id, invite_id):
        raise HTTPException(status_code=404, detail="Invite not found")
    return {"revoked": invite_id}


@router.post("/league/{league_id}/teams/{team_id}/co-commissioner")
def hub_set_co_commissioner(
    league_id: str,
    team_id: str,
    body: TeamCoCommissionerRequest,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_primary_commissioner(ctx)
    try:
        team = storage.set_team_co_commissioner(
            league_id, team_id, enabled=bool(body.enabled), actor_sub=sub,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"team": team, "hub_context": _ctx(sub)}


@router.get("/league/{league_id}/chat/{kind}/messages")
def hub_list_chat_messages(
    league_id: str,
    kind: str,
    before: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    kind_norm = str(kind or "").strip().lower()
    if kind_norm == "office":
        require_commissioner(ctx)
    elif kind_norm != "league":
        raise HTTPException(status_code=400, detail="Invalid chat channel")
    try:
        messages = storage.list_chat_messages(league_id, kind_norm, before=before, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"kind": kind_norm, "messages": messages}


@router.post("/league/{league_id}/chat/{kind}/messages")
async def hub_post_chat_message(
    league_id: str,
    kind: str,
    body: ChatMessageCreateRequest,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    kind_norm = str(kind or "").strip().lower()
    if kind_norm == "office":
        require_commissioner(ctx)
    elif kind_norm != "league":
        raise HTTPException(status_code=400, detail="Invalid chat channel")
    try:
        message = storage.post_chat_message(
            league_id,
            kind_norm,
            author_sub=sub,
            team_id=ctx.get("team_id"),
            body=body.body,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await draft_room_manager.broadcast(
        league_id,
        {"type": "chat", "kind": kind_norm, "message": message},
    )
    return {"message": message}


@router.delete("/league/{league_id}/chat/{kind}/messages")
async def hub_clear_chat_messages(
    league_id: str,
    kind: str,
    _user=Depends(require_hub_user),
) -> dict:
    """Primary commissioner: wipe all messages in a chat channel."""
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_primary_commissioner(ctx)
    kind_norm = str(kind or "").strip().lower()
    if kind_norm not in ("league", "office"):
        raise HTTPException(status_code=400, detail="Invalid chat channel")
    try:
        result = storage.clear_chat_messages(league_id, kind_norm)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await draft_room_manager.broadcast(
        league_id,
        {"type": "chat_cleared", "kind": kind_norm},
    )
    return result


@router.get("/claim/{token}")
def hub_preview_claim(token: str, request: Request) -> dict:
    user = optional_user(request)
    sub = _sub(user) if user else None
    try:
        return build_claim_preview(token, sub)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/claim/{token}")
def hub_accept_claim(token: str, body: LeagueClaimAcceptRequest, user=Depends(require_hub_user)) -> dict:
    sub = _sub(user)
    try:
        result = accept_claim_link(
            token,
            sub,
            team_id=body.team_id,
            team_name=body.team_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {**result, "hub_context": _ctx(sub)}


@router.post("/league/{league_id}/claim-link/rotate")
def hub_rotate_claim_link(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    try:
        claim = rotate_claim_link(league_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"claim": claim, "hub_context": _ctx(sub)}


@router.get("/league/{league_id}/availability")
def hub_get_availability(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    try:
        return build_availability_payload(league_id, sub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/league/{league_id}/availability")
def hub_put_availability(
    league_id: str,
    body: DraftAvailabilityUpdate,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    _ctx_for_league(sub, league_id)
    try:
        return save_availability(
            league_id,
            sub,
            [slot.model_dump() for slot in body.slots],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
        "co_commissioner": bool(invite.get("co_commissioner")),
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
async def hub_start_draft(
    league_id: str,
    force: bool = Query(False, description="Start now even if a future draft time is set"),
    allow_empty: bool = Query(
        False,
        description="Start even if some seats are still unclaimed (live rooms only)",
    ),
    fill_bots: bool = Query(
        False,
        description="Fill leftover mock seats with bots before starting",
    ),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    try:
        from src.draft_hub.lobby import start_from_lobby

        state = start_from_lobby(
            league_id,
            sub,
            force=force,
            allow_empty=allow_empty,
            fill_bots=fill_bots,
        )
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/pause")
async def hub_pause_draft(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        state = pause_draft(league_id, sub)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/resume")
async def hub_resume_draft(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        state = resume_draft(league_id, sub)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/skip-nomination")
async def hub_skip_nomination(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    try:
        state = skip_nomination(league_id, sub)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/league/{league_id}/nomination-queue")
async def hub_nomination_queue(
    league_id: str,
    body: NominationQueueUpdate,
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    try:
        state = set_nomination_queue(
            league_id, sub, body.player_ids, autodraft=body.autodraft
        )
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/end")
async def hub_end_draft(
    league_id: str,
    force: bool = Query(False, description="Override positional-minimum completion gate"),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    try:
        state = end_draft(league_id, sub, force=force)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/reset-draft")
async def hub_reset_live_draft(league_id: str, _user=Depends(require_hub_user)) -> dict:
    """Reset a live draft back to pre-start (keepers stay; auction picks cleared)."""
    sub = _sub(_user)
    try:
        result = reset_live_draft(league_id, sub)
        _invalidate_league_rosters_from_ctx(_ctx_for_league(sub, league_id))
        await broadcast_room(league_id)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/nominate")
async def hub_nominate(
    league_id: str,
    body: DraftNominateRequest,
    force: bool = Query(
        False,
        description="Commissioner nominates on behalf of the on-clock team",
    ),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    try:
        state = nominate(league_id, sub, body.model_dump(), force=force)
        await broadcast_room(league_id)
        return state
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/pick")
async def hub_pick(
    league_id: str,
    body: DraftNominateRequest,
    force: bool = Query(
        False,
        description="Commissioner picks on behalf of the on-clock team",
    ),
    _user=Depends(require_hub_user),
) -> dict:
    sub = _sub(_user)
    try:
        state = make_pick(league_id, sub, body.model_dump(), force=force)
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
    sub = _sub(_user)
    _assert_league_access(league_id, sub)
    if not user_is_draft_staff(league_id, sub):
        raise HTTPException(status_code=403, detail="Only commissioners can award an auction early")
    try:
        state = award_nominee(league_id, sub)
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
        state = get_room_state(league_id, sub)
        await websocket.send_json({"type": "state", "payload": state})
        while True:
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_text("pong")
            elif msg == "refresh":
                state = check_timers(league_id, sub)
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


def _hub_rookie_extend(
    *,
    player_id: str,
    extension_years: int,
    ctx: dict[str, Any],
) -> dict:
    """One server-calculated manager extension command (SCORE-42).

    Client salaries are ignored. Terms activate after the draft-complete tick.
    """
    ws_id, team_id = roster_scope(ctx)
    rules = LeagueRules.model_validate(ctx["rules"])
    draft_completed = bool(ctx.get("draft_completed"))

    existing = storage.get_roster_slot(ws_id, player_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Player not on roster")
    if ctx.get("mode") == "league":
        if not team_id:
            raise HTTPException(status_code=403, detail="Join a league team to extend contracts")
        if str(existing.get("team_id") or "") != str(team_id):
            raise HTTPException(status_code=403, detail="Can only extend contracts on your own team")

    try:
        contract, already_applied = apply_rookie_extension_command(
            existing,
            rules,
            extension_years=extension_years,
            draft_completed=draft_completed,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    pending = (contract or {}).get("pending_extension") or {}
    server_start = float(pending.get("start_salary") or 0) or None
    if already_applied:
        slot = storage.get_roster_slot(ws_id, player_id) or existing
    else:
        from src.draft_hub.contract_service import apply_roster_edit

        slot = apply_roster_edit(
            ctx.get("league_id"),
            ws_id,
            player_id,
            contract=contract,
            any_team=True,
            op="extension",
        )
    roster = list_roster_for_context(ctx)
    _invalidate_league_rosters_from_ctx(ctx)
    return {
        "slot": slot,
        "pending_extension": bool((slot.get("contract") or {}).get("pending_extension")),
        "already_applied": already_applied,
        "extension_years": int(pending.get("years") or extension_years),
        "start_salary": server_start,
        "validation_errors": validate_roster(rules, roster),
        "multi_year_plan": multi_year_cap_plan(rules, roster, draft_completed=draft_completed),
        "pre_draft": pre_draft_cap_summary(rules, roster, draft_completed=draft_completed),
        "hub_context": ctx,
    }


@router.post("/contract/rookie-extend")
def hub_rookie_extend(body: RookieExtendRequest, _user=Depends(require_hub_user)) -> dict:
    """Idempotent manager command: queue a server-calculated contract extension."""
    ctx = _ctx(_sub(_user))
    return _hub_rookie_extend(
        player_id=body.player_id,
        extension_years=body.extension_years,
        ctx=ctx,
    )


@router.post("/contract/extend")
def hub_extend_contract(body: ContractExtendRequest, _user=Depends(require_hub_user)) -> dict:
    """Legacy alias for ``/contract/rookie-extend`` (client ``new_salary`` ignored)."""
    ctx = _ctx(_sub(_user))
    return _hub_rookie_extend(
        player_id=body.player_id,
        extension_years=body.extension_years,
        ctx=ctx,
    )


@router.post("/contract/renew")
def hub_renew_contract(body: ContractRenewRequest, _user=Depends(require_hub_user)) -> dict:
    """Legacy alias for ``/contract/rookie-extend`` (client ``start_salary`` ignored)."""
    ctx = _ctx(_sub(_user))
    return _hub_rookie_extend(
        player_id=body.player_id,
        extension_years=body.extension_years,
        ctx=ctx,
    )


@router.get("/contract/pending-types")
def hub_list_pending_contract_types(_user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") != "league" or not ctx.get("league_id"):
        return {"pending": [], "hub_context": ctx}
    require_commissioner(ctx)
    by_team = storage.list_league_rosters_by_team(str(ctx["league_id"]))
    pending: list[dict[str, Any]] = []
    teams = {t["id"]: t for t in storage.list_league_teams(str(ctx["league_id"]))}
    for tid, rows in by_team.items():
        team = teams.get(tid) or {}
        for row in rows:
            contract = row.get("contract") or {}
            if not contract.get("pending_type"):
                continue
            pending.append(
                {
                    "player_id": row["player_id"],
                    "player_name": row.get("player_name"),
                    "position": row.get("position"),
                    "team_id": tid,
                    "team_name": team.get("name"),
                    "current_type": contract.get("contract_type") or "veteran",
                    "pending_type": contract.get("pending_type"),
                    "pending_type_by": contract.get("pending_type_by"),
                    "pending_type_at": contract.get("pending_type_at"),
                }
            )
    return {"pending": pending, "hub_context": ctx}


@router.post("/contract/pending-types/decide")
def hub_decide_pending_contract_type(body: ContractTypeDecisionRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    ctx = _ctx(sub)
    require_commissioner(ctx)
    ws_id, _team_id = roster_scope(ctx)
    rules = LeagueRules.model_validate(ctx["rules"])
    existing = None
    if ctx.get("league_id"):
        by_team = storage.list_league_rosters_by_team(str(ctx["league_id"]))
        for rows in by_team.values():
            hit = next((r for r in rows if str(r.get("player_id")) == str(body.player_id)), None)
            if hit:
                existing = hit
                break
    if not existing:
        existing = storage.get_roster_slot(ws_id, body.player_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Player not on roster")
    prior = dict(existing.get("contract") or {})
    pending_type = prior.get("pending_type")
    if not pending_type:
        raise HTTPException(status_code=400, detail="No pending contract type for this player")
    if body.approve:
        if pending_type not in CONTRACT_TYPES:
            raise HTTPException(status_code=400, detail="Invalid pending type")
        contract = apply_type_to_contract(
            rules,
            existing,
            contract_type=str(pending_type),
            manual=True,
            clear_pending=True,
        )
    else:
        contract = {**prior}
        contract.pop("pending_type", None)
        contract.pop("pending_type_by", None)
        contract.pop("pending_type_at", None)
    from src.draft_hub.contract_service import apply_roster_edit

    slot = apply_roster_edit(
        ctx.get("league_id"),
        ws_id,
        body.player_id,
        contract=contract,
        any_team=True,
        op="edit",
    )
    _invalidate_league_rosters_from_ctx(ctx)
    return {"slot": slot, "approved": bool(body.approve), "hub_context": _ctx(sub)}


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


@router.get("/lobby/{room_code}")
def hub_lobby_preview(room_code: str) -> dict:
    """Public lobby card — no account required."""
    from src.draft_hub.lobby import build_lobby_preview

    try:
        return build_lobby_preview(room_code)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/lobby/{room_code}/join")
async def hub_lobby_join(room_code: str, body: LobbyJoinRequest, request: Request) -> dict:
    """Claim a practice seat, or re-enter a live room as a league member."""
    from src.draft_hub.lobby import join_lobby

    user = optional_user(request)
    try:
        result = join_lobby(room_code, body.display_name, user=user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await broadcast_room(result["league_id"])
    return result


@router.post("/league/{league_id}/lobby/slot")
async def hub_lobby_claim_slot(
    league_id: str,
    body: LobbySlotRequest,
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.lobby import claim_draft_slot

    sub = _sub(_user)
    try:
        state = claim_draft_slot(
            league_id,
            sub,
            body.slot,
            team_id=body.team_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await broadcast_room(league_id)
    return state


@router.post("/league/{league_id}/lobby/name")
async def hub_lobby_rename(
    league_id: str,
    body: LobbyNameRequest,
    _user=Depends(require_hub_user),
) -> dict:
    from src.draft_hub.lobby import rename_lobby_team

    sub = _sub(_user)
    try:
        state = rename_lobby_team(league_id, sub, body.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await broadcast_room(league_id)
    return state


@router.post("/league/{league_id}/lobby/notify")
async def hub_lobby_notify(league_id: str, force: bool = Query(False), _user=Depends(require_hub_user)) -> dict:
    from fastapi.concurrency import run_in_threadpool
    from src.draft_hub.lobby import notify_managers_draft_open

    sub = _sub(_user)
    try:
        return await run_in_threadpool(notify_managers_draft_open, league_id, sub, force=force)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.get("/mock-drafts")
def hub_list_mock_drafts(_user=Depends(require_hub_user)) -> dict:
    """Saved favorites plus the latest unsaved practice rooms."""
    sub = _sub(_user)
    return {"rooms": storage.list_mock_drafts_for_sub(sub), "max_saved": storage.MAX_SAVED_MOCKS}


@router.put("/mock-draft/{league_id}/keep")
def hub_keep_mock_draft(
    league_id: str,
    body: MockKeepRequest,
    _user=Depends(require_hub_user),
) -> dict:
    """Pin a practice room as a favorite, or unpin it."""
    sub = _sub(_user)
    league = storage.get_league(league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    if not league.get("test_mode"):
        raise HTTPException(status_code=400, detail="Only practice rooms can be saved")
    if league.get("commissioner_sub") != sub:
        raise HTTPException(status_code=403, detail="Only the commissioner can save this mock")
    try:
        updated = storage.set_mock_saved(league_id, body.saved)
        return {"league": updated, "saved": bool(updated.get("mock_saved"))}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/mock-draft/start")
async def hub_mock_draft_start(body: MockDraftStartRequest, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    if body.mode == "keeper_sandbox":
        if not body.source_league_id:
            raise HTTPException(status_code=400, detail="source_league_id required for keeper_sandbox")
        src_ctx = _ctx_for_league(sub, body.source_league_id)
        require_commissioner(src_ctx)
    # Keeper sandbox stays in setup unless the client explicitly requests auto_start.
    auto_start = body.auto_start
    if body.mode == "keeper_sandbox" and "auto_start" not in body.model_fields_set:
        auto_start = False
    try:
        result = start_mock_draft(
            sub,
            mode=body.mode,
            season=body.season,
            team_count=body.team_count,
            bot_count=body.bot_count,
            source_league_id=body.source_league_id,
            auto_start=auto_start,
            name=body.name,
            relax_salary_roster_limits=body.relax_salary_roster_limits,
            preset_id=body.preset_id,
            lobby=bool(body.lobby),
        )
        await broadcast_room(result["league_id"])
        result["hub_context"] = _ctx(sub)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/league/{league_id}/draft-expire-preview")
def hub_draft_expire_preview(league_id: str, _user=Depends(require_hub_user)) -> dict:
    """Who is retained vs expires before draft (read-only)."""
    sub = _sub(_user)
    ctx = _ctx_for_league(sub, league_id)
    require_commissioner(ctx)
    try:
        return build_draft_expire_preview(league_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/league/{league_id}")
def hub_delete_test_league(league_id: str, _user=Depends(require_hub_user)) -> dict:
    """Delete a practice/sandbox league only (test_mode). Real leagues are blocked."""
    sub = _sub(_user)
    league = storage.get_league(league_id)
    if not league:
        raise HTTPException(status_code=404, detail="League not found")
    if not league.get("test_mode"):
        raise HTTPException(status_code=400, detail="Only practice / sandbox rooms can be deleted this way")
    if league.get("commissioner_sub") != sub:
        raise HTTPException(status_code=403, detail="Only the commissioner can delete this sandbox")
    try:
        return storage.delete_league(league_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/league/{league_id}/test/setup")
def hub_test_draft_setup(league_id: str, body: TestDraftSetupRequest, _user=Depends(require_hub_user)) -> dict:
    """Add bots to an existing practice/sandbox room. Live leagues are rejected."""
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


@router.post("/league/{league_id}/test/simulate")
async def hub_test_draft_simulate(
    league_id: str,
    body: SimulateDraftRequest = None,
    _user=Depends(require_hub_user),
) -> dict:
    """Run the rest of a practice draft instantly (dev tool)."""
    sub = _sub(_user)
    try:
        max_picks = body.max_picks if body else None
        state = simulate_draft(league_id, sub, max_picks=max_picks)
        await broadcast_room(league_id)
        return {"state": state}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Mock draft simulation failed for %s", league_id)
        raise HTTPException(
            status_code=500,
            detail=(
                "Simulation failed while finishing the draft. "
                "Open the mock from Recent mocks — it may have completed."
            ),
        ) from exc


@router.get("/league/{league_id}/owner-draft-report")
def hub_owner_draft_report(league_id: str, _user=Depends(require_hub_user)) -> dict:
    sub = _sub(_user)
    team = storage.get_team_by_user(league_id, sub)
    if not team:
        raise HTTPException(status_code=403, detail="Join this draft room to view your report")
    roster = storage.list_team_roster(league_id, team["id"])
    report = build_owner_draft_report(
        league_id,
        team["id"],
        roster=roster,
        budget_remaining=float(team.get("budget_remaining") or 0),
    )
    if not report:
        raise HTTPException(status_code=404, detail="No draft picks for your team yet")
    league = storage.get_league(league_id) or {}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    report["max_contract_years"] = int(rules.contracts.max_years)
    report["extension_step_up"] = float(rules.contracts.extension_step_up)
    report["team_name"] = team.get("name")
    report["contracts_locked"] = True
    return report


@router.post("/league/{league_id}/draft-contracts")
async def hub_set_draft_contracts(
    league_id: str,
    body: DraftContractsRequest,
    _user=Depends(require_hub_user),
) -> dict:
    """Auction years are assigned automatically; this endpoint is closed to owners."""
    sub = _sub(_user)
    try:
        state = set_draft_contracts(
            league_id,
            sub,
            [item.model_dump() for item in (body.contracts or [])],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await broadcast_room(league_id)
    return {"updated": 0, "state": state}


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
    hints = [{"player_id": pid} for pid in player_ids[:200]]
    media = build_player_media_batch(hints)
    return {"media": media}


@router.post("/cap-sheet/validate")
async def hub_cap_sheet_validate(
    file: UploadFile = File(...),
    replace_existing: bool = Query(True),
    sync_sleeper_first: bool = Query(False),
    contracts_only: bool = Query(False),
    _user=Depends(require_hub_user),
) -> dict:
    from pathlib import Path

    import yaml

    from src.config import DATA_DIR
    from src.draft_hub.cap_sheet_import import parse_cap_sheet_tsv, validate_cap_sheet_for_league
    from src.draft_hub.schemas import LeagueRules

    sub = _sub(_user)
    ctx = _ctx(sub)
    if ctx.get("mode") != "league" or not ctx.get("is_commissioner"):
        raise HTTPException(status_code=403, detail="Only the league commissioner can validate cap sheets")
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
    effective_replace = replace_existing and not (contracts_only or sync_sleeper_first)
    return validate_cap_sheet_for_league(
        league_id,
        parsed,
        manager_map,
        replace_existing=effective_replace,
        contracts_only=contracts_only or sync_sleeper_first,
    )


@router.post("/cap-sheet/import")
async def hub_cap_sheet_import(
    file: UploadFile = File(...),
    replace_existing: bool = Query(True),
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
            sheet_season = int(ctx.get("season") or league.get("season") or 2025)
            result = import_cap_sheet_to_league(
                league_id,
                parsed,
                manager_map,
                replace_existing=replace_existing,
                historic_season=sheet_season,
            )
            result["mode"] = "replace_rosters"
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _invalidate_league_rosters_from_ctx(ctx)
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
    ctx = _ctx_for_league(sub, league_id)
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
    _clear_league_rosters_cache(league_id)
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
    _clear_league_rosters_cache(league_id)
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


@router.get("/demo/config")
def hub_demo_config() -> dict:
    from src.draft_hub.hub_demo import demo_config

    return demo_config()


@router.get("/demo/workspace")
def hub_demo_workspace() -> dict:
    from src.draft_hub.hub_demo import build_demo_workspace

    return build_demo_workspace()


@router.get("/demo/league/{league_id}/insights/status")
def hub_demo_league_insights_status(league_id: str) -> dict:
    from src.draft_hub.hub_demo import assert_demo_league

    assert_demo_league(league_id)
    return {"cap": "hit", "scoring": "miss", "fair_values": "miss"}


@router.get("/demo/league/{league_id}/insights/overview")
def hub_demo_league_insights_overview(league_id: str) -> dict:
    from src.draft_hub.hub_demo import build_demo_insights

    return build_demo_insights(league_id, sections="overview")


@router.get("/demo/league/{league_id}/insights/cap")
def hub_demo_league_insights_cap(league_id: str) -> dict:
    from src.draft_hub.hub_demo import build_demo_insights

    return build_demo_insights(league_id, sections="cap")


@router.get("/demo/league/{league_id}/insights/scoring")
def hub_demo_league_insights_scoring(league_id: str) -> dict:
    from src.draft_hub.hub_demo import build_demo_insights

    return build_demo_insights(league_id, sections="scoring")


@router.get("/demo/league/{league_id}/insights")
def hub_demo_league_insights(
    league_id: str,
    sections: Optional[str] = Query(None, description="Comma-separated: cap,scoring,trades"),
) -> dict:
    from src.draft_hub.hub_demo import build_demo_insights

    return build_demo_insights(league_id, sections=sections or "cap,scoring,trades")


@router.get("/demo/league/{league_id}/freshness")
def hub_demo_league_freshness(league_id: str) -> dict:
    from src.draft_hub.hub_demo import build_demo_freshness

    return build_demo_freshness(league_id)
