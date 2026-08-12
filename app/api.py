"""FastAPI backend + React dashboard static serving."""

from __future__ import annotations

import asyncio
import math
import urllib.parse
from contextlib import asynccontextmanager
from typing import Any, Optional

import pandas as pd
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.process_pool import (
    get_process_executor,
    init_process_executor,
    shutdown_process_executor,
    submit_cpu_job,
)
from app.auth import (
    FRONTEND_URL,
    accept_native_terms,
    auth_enabled,
    auth_public_config,
    authenticate_native_user,
    change_native_password,
    create_access_token,
    delete_native_account,
    exchange_patreon_code,
    fetch_patron_identity,
    hub_auth_enabled,
    native_user_id_from_sub,
    optional_user,
    patreon_authorize_url,
    patreon_configured,
    register_native_user,
    request_password_reset,
    require_patron,
    require_admin,
    resend_verification_email,
    reset_password_with_token,
    resolve_native_user_id,
    session_user_public,
    sign_oauth_state,
    update_native_profile,
    user_terms_current,
    verify_email_token,
    verify_oauth_state,
)
from src.auth.rate_limit import check_rate_limit
from src.products.accuracy_report import load_accuracy_report
from src.analytics.season_long_eval import load_season_long_report
from src.analytics.upside_eval import load_upside_report
from src.jobs.accuracy_rebuild import (
    acknowledge_accuracy_rebuild,
    get_accuracy_rebuild_status,
    run_full_accuracy_rebuild,
    start_full_accuracy_rebuild,
)
from src.config import FRONTEND_DIST, TWA_PACKAGE_NAME, TWA_SHA256_FINGERPRINT
from src.auth import user_store
from src.integrations.sleeper import get_nfl_state, injured_players
from src.jobs.weekly_refresh import get_refresh_status, run_weekly_refresh
from src.projections.predict import get_model_metrics, predict_upcoming_week
from src.projections.projection_meta import get_projection_meta
from src.projections.draft_meta import get_draft_meta
from src.projections.draft_projections import draft_projection_note, predict_draft_season
from src.projections.weekly_cache import compute_weekly_artifact, load_weekly_prediction
from src.projections.player_compare import (
    build_player_compare,
    filter_projections_by_ids,
    parse_compare_player_ids,
)
from src.projections.projection_explanation import build_projection_explanation
from src.draft_hub.draft_pool_cache import draft_pool_for_position
from src.products.bestball_board import build_bestball_board
from src.products.dfs_config import list_site_configs
from src.products.dfs_salaries import attach_salaries_to_pool, parse_salary_csv
from src.products.lineup_optimizer import build_lineup_pool, optimize_from_pool_dataframe
from src.products.prop_scan import build_prop_scan, parse_prop_lines_csv
from src.sentiment.readout import build_sentiment_response
from src.sentiment.fantasy_readout import build_fantasy_season_response, build_fantasy_weekly_response
from src.integrations.dfs_slates import (
    SLATE_CATEGORIES,
    fetch_slate_salaries,
    list_slates,
    pick_default_slate,
)
from src.core.schedule_utils import teams_on_bye
from src.projections.ros_cache import load_ros_prediction
from app.hub_routes import router as hub_router
from app.admin_routes import router as admin_router
from app.auth import admin_configured


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_process_executor(max_workers=1)
    yield
    shutdown_process_executor(wait=False)


app = FastAPI(
    title="ScoreSense API",
    description="NFL fantasy projection API with intervals and injury context",
    version="4.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(hub_router)
app.include_router(admin_router)


class ProjectionRequest(BaseModel):
    position: str = "qb"
    season: Optional[int] = None
    week: Optional[int] = None
    apply_injury_adjustments: bool = True
    # Optional filter — comma-separated or list of player_id values (SCORE-4).
    player_ids: Optional[list[str]] = None
    ids: Optional[str] = None


class LineupOptimizeRequest(BaseModel):
    season: Optional[int] = None
    week: Optional[int] = None
    objective: str = "median"
    site: str = "seasonal"
    salary_cap: Optional[int] = None
    locked_player_ids: list[str] = []
    excluded_player_ids: list[str] = []
    candidate_player_ids: Optional[list[str]] = None
    apply_injury_adjustments: bool = True
    slate_salaries: Optional[list[dict[str, Any]]] = None
    block_bye_weeks: bool = True
    require_qb_stack: bool = False
    lineup_count: int = 1
    max_overlap: int = 4


def _collect_route_paths(routes) -> set[str]:
    paths: set[str] = set()
    for route in routes:
        path = getattr(route, "path", "")
        if path:
            paths.add(path)
        nested = getattr(route, "routes", None)
        if nested:
            paths.update(_collect_route_paths(nested))
    return paths


@app.get("/api/health")
def health() -> dict:
    route_paths = _collect_route_paths(app.routes)
    route_paths.update(_collect_route_paths(hub_router.routes))
    return {
        "status": "ok",
        "version": app.version,
        "auth_required": auth_enabled(),
        "patreon_configured": patreon_configured(),
        "features": {
            "lineup": "/api/lineup/pool" in route_paths,
            "draft": "/api/draft/{position}" in route_paths,
            "ros": "/api/ros/{position}" in route_paths,
            "draft_hub": "/api/hub/workspace" in route_paths,
            "player_compare": "/api/predict/compare" in route_paths,
            "projection_explanation": "/api/player/{player_id}/explanation" in route_paths,
        },
    }


@app.get("/api/players/media")
def players_media(
    ids: str = Query("", description="Comma-separated player_id values"),
    _user=Depends(require_patron),
) -> dict:
    from src.draft_hub.draft_enrichment import build_player_media_batch

    player_ids = [p.strip() for p in ids.split(",") if p.strip()]
    hints = [{"player_id": pid} for pid in player_ids[:80]]
    return {"media": build_player_media_batch(hints)}


@app.get("/api/player/{player_id}/explanation")
def player_explanation_get(
    player_id: str,
    season: Optional[int] = None,
    week: Optional[int] = None,
    position: Optional[str] = None,
    apply_injury_adjustments: bool = True,
    _user=Depends(require_patron),
) -> dict:
    """Structured \"Why this projection?\" panel — artifact signals + sentiment overlay."""
    from fastapi.encoders import jsonable_encoder

    def _compute(pos: str, s: int, w: int, apply_injury: bool) -> None:
        _warm_weekly_artifact(pos, s, w, apply_injury)

    try:
        return jsonable_encoder(
            build_projection_explanation(
                player_id,
                season=season,
                week=week,
                position=position.lower() if position else None,
                apply_injury_adjustments=apply_injury_adjustments,
                compute_fn=_compute,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/player/{player_id}/card")
def player_card_get(
    player_id: str,
    season: Optional[int] = None,
    week: Optional[int] = None,
    scope: str = Query("weekly", description="weekly or season narrative scope"),
    position: Optional[str] = None,
    apply_injury_adjustments: bool = True,
    _user=Depends(require_patron),
) -> dict:
    from fastapi.encoders import jsonable_encoder
    from src.projections.player_card import build_player_card

    try:
        return jsonable_encoder(
            build_player_card(
                player_id,
                season=season,
                week=week,
                scope=scope,
                position=position.lower() if position else None,
                apply_injury_adjustments=apply_injury_adjustments,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Player card failed: {exc}") from exc


@app.get("/api/auth/config")
def auth_config() -> dict:
    from src.draft_hub.hub_demo import demo_config

    return {
        "auth_required": auth_enabled(),
        "hub_auth_required": hub_auth_enabled(),
        "patreon_configured": patreon_configured(),
        "accounts_enabled": True,
        "admin_configured": admin_configured(),
        "hub_demo": demo_config(),
        **auth_public_config(),
    }


class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: Optional[str] = None
    accept_terms: bool = False


class LoginRequest(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    password: str


class ResendVerificationRequest(BaseModel):
    email: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    display_name: str


class DeleteAccountRequest(BaseModel):
    password: str


def _rate_limit_auth_credentials(request: Request, email: str | None, *, action: str) -> None:
    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"{action}:ip:{ip}", max_calls=30, window_seconds=3600):
        raise HTTPException(
            status_code=429,
            detail="Too many attempts. Try again in about an hour.",
        )
    if email:
        norm = str(email).strip().lower()
        if norm and not check_rate_limit(f"{action}:email:{norm}", max_calls=15, window_seconds=3600):
            raise HTTPException(
                status_code=429,
                detail="Too many attempts. Try again in about an hour.",
            )


def _rate_limit_forgot_password(request: Request, email: str | None) -> None:
    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"forgot-password:ip:{ip}", max_calls=10, window_seconds=3600):
        raise HTTPException(
            status_code=429,
            detail="Too many password reset requests. Try again in about an hour.",
        )
    if email:
        norm = str(email).strip().lower()
        if norm and not check_rate_limit(f"forgot-password:email:{norm}", max_calls=5, window_seconds=3600):
            raise HTTPException(
                status_code=429,
                detail="Too many password reset requests. Try again in about an hour.",
            )


def _rate_limit_resend_verification(
    request: Request,
    *,
    user_id: str | None,
    email: str | None,
) -> None:
    """Authenticated resend: one bucket per account. Anonymous: IP + email."""
    if user_id:
        if not check_rate_limit(
            f"resend-verification:user:{user_id}",
            max_calls=8,
            window_seconds=3600,
        ):
            raise HTTPException(
                status_code=429,
                detail="Too many verification emails. Wait an hour or open the link from your last email.",
            )
        return
    ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(f"resend-verification:ip:{ip}", max_calls=10, window_seconds=3600):
        raise HTTPException(
            status_code=429,
            detail="Too many verification emails. Try again in about an hour.",
        )
    if email:
        norm = str(email).strip().lower()
        if norm and not check_rate_limit(f"resend-verification:email:{norm}", max_calls=5, window_seconds=3600):
            raise HTTPException(
                status_code=429,
                detail="Too many verification emails. Try again in about an hour.",
            )


def _require_native_user(request: Request) -> tuple[dict, str]:
    user = optional_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    if user.get("auth_type") != "native":
        raise HTTPException(status_code=400, detail="This action is only available for email accounts")
    user_id = resolve_native_user_id(user)
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid account")
    return user, user_id


def _auth_user_payload(user: dict, auth_type: str = "native") -> dict:
    verified = user_store.is_email_verified(user) if auth_type == "native" else True
    terms_current = user_terms_current(user) if auth_type == "native" else True
    return {
        "name": user.get("display_name") or user.get("name"),
        "email": user.get("email"),
        "auth_type": auth_type,
        "email_verified": verified,
        "terms_current": terms_current,
        "terms_version": user.get("terms_version") if auth_type == "native" else None,
    }


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="scoresense_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 14,
    )


@app.post("/api/auth/register")
def auth_register(body: RegisterRequest, request: Request, response: Response) -> dict:
    _rate_limit_auth_credentials(request, body.email, action="register")
    try:
        user = register_native_user(
            body.email,
            body.password,
            body.display_name,
            accept_terms=body.accept_terms,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = create_access_token(user, auth_type="native")
    payload = {
        "token": token,
        "user": _auth_user_payload(user, "native"),
    }
    _set_auth_cookie(response, token)
    return payload


@app.post("/api/auth/login")
def auth_login(body: LoginRequest, request: Request, response: Response) -> dict:
    _rate_limit_auth_credentials(request, body.email, action="login")
    user = authenticate_native_user(body.email, body.password)
    row = user_store.get_user_by_id(user["id"])
    token = create_access_token(user, auth_type="native")
    payload = {
        "token": token,
        "user": _auth_user_payload(row or user, "native"),
    }
    _set_auth_cookie(response, token)
    return payload


@app.get("/api/auth/patreon/login")
def patreon_login(next: Optional[str] = None) -> dict:
    if not patreon_configured():
        raise HTTPException(status_code=503, detail="Patreon OAuth not configured")
    return_path = next or "/projections/weekly"
    state = sign_oauth_state(return_path)
    return {"url": patreon_authorize_url(state)}


@app.get("/api/auth/patreon/callback")
def patreon_callback(code: str, response: Response, state: Optional[str] = None) -> RedirectResponse:
    if not patreon_configured():
        raise HTTPException(status_code=503, detail="Patreon OAuth not configured")
    access_token = exchange_patreon_code(code)
    user = fetch_patron_identity(access_token)
    token = create_access_token(user, auth_type="patreon")
    next_path = verify_oauth_state(state)
    next_q = urllib.parse.quote(next_path, safe="")
    redirect = RedirectResponse(url=f"{FRONTEND_URL}/auth/callback?token={token}&next={next_q}")
    redirect.set_cookie(
        key="scoresense_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 14,
    )
    return redirect


@app.get("/api/auth/verify-email")
def auth_verify_email(token: str) -> RedirectResponse:
    user = verify_email_token(token)
    if not user:
        return RedirectResponse(url=f"{FRONTEND_URL}/auth/verify?error=invalid")
    return RedirectResponse(url=f"{FRONTEND_URL}/auth/verify?success=1")


@app.post("/api/auth/resend-verification")
def auth_resend_verification(body: ResendVerificationRequest, request: Request) -> dict:
    jwt_user = optional_user(request)
    user_id = resolve_native_user_id(jwt_user, email_hint=body.email)
    if not user_id and body.email:
        row = user_store.get_user_by_email(body.email)
        user_id = row["id"] if row else None
    if not user_id:
        return {"sent": False, "reason": "not_found"}

    row = user_store.get_user_by_id(user_id)
    if not row:
        return {"sent": False, "reason": "not_found"}
    if user_store.is_email_verified(row):
        return {"sent": False, "already_verified": True}

    _rate_limit_resend_verification(
        request,
        user_id=user_id,
        email=body.email or (row or {}).get("email"),
    )
    sent = resend_verification_email(user_id)
    if not sent:
        return {"sent": False, "reason": "smtp_failed"}
    return {"sent": True}


@app.post("/api/auth/forgot-password")
def auth_forgot_password(body: ForgotPasswordRequest, request: Request) -> dict:
    _rate_limit_forgot_password(request, body.email)
    request_password_reset(body.email)
    return {"status": "ok", "message": "If an account exists, a reset link was sent."}


@app.post("/api/auth/reset-password")
def auth_reset_password(body: ResetPasswordRequest) -> dict:
    try:
        user = reset_password_with_token(body.token, body.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link")
    return {"status": "ok", "message": "Password updated. You can sign in now."}


@app.post("/api/auth/change-password")
def auth_change_password(body: ChangePasswordRequest, request: Request, response: Response) -> dict:
    _, user_id = _require_native_user(request)
    try:
        updated = change_native_password(user_id, body.current_password, body.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = create_access_token(updated, auth_type="native")
    payload = {
        "status": "ok",
        "token": token,
        "user": _auth_user_payload(updated, "native"),
    }
    _set_auth_cookie(response, token)
    return payload


@app.patch("/api/auth/profile")
def auth_update_profile(body: UpdateProfileRequest, request: Request) -> dict:
    _, user_id = _require_native_user(request)
    updated = update_native_profile(user_id, body.display_name)
    return {"user": _auth_user_payload(updated, "native")}


@app.post("/api/auth/accept-terms")
def auth_accept_terms(request: Request) -> dict:
    user = optional_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Login required")
    if user.get("auth_type") == "native":
        user_id = resolve_native_user_id(user)
        if not user_id:
            raise HTTPException(status_code=400, detail="Invalid account")
        updated = accept_native_terms(user_id)
        return {"user": _auth_user_payload(updated, "native")}
    return {"user": session_user_public(user)}


@app.post("/api/auth/delete-account")
def auth_delete_account(body: DeleteAccountRequest, request: Request, response: Response) -> dict:
    _, user_id = _require_native_user(request)
    delete_native_account(user_id, body.password)
    response.delete_cookie("scoresense_token")
    return {"status": "deleted", "message": "Your account was deleted. Draft Hub league data may still exist."}


@app.get("/api/auth/me")
def auth_me(request: Request) -> dict:
    user = optional_user(request)
    if user:
        return {
            "authenticated": True,
            "auth_required": auth_enabled(),
            "hub_auth_required": hub_auth_enabled(),
            "admin_configured": admin_configured(),
            "user": session_user_public(user),
        }
    return {
        "authenticated": False,
        "auth_required": auth_enabled(),
        "hub_auth_required": hub_auth_enabled(),
        "admin_configured": admin_configured(),
    }


@app.post("/api/auth/logout")
def auth_logout(response: Response) -> dict:
    response.delete_cookie("scoresense_token")
    return {"status": "logged_out"}


@app.get("/api/metrics")
def metrics(_user=Depends(require_patron)) -> dict:
    return get_model_metrics()


@app.get("/api/state")
def nfl_state(_user=Depends(require_patron)) -> dict:
    try:
        return get_nfl_state()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/meta/projections/{position}")
def projection_meta(position: str, _user=Depends(require_patron)) -> dict:
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise HTTPException(status_code=400, detail="position must be qb, rb, or wr")
    try:
        return get_projection_meta(position)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/injuries")
def injuries(
    team: Optional[str] = None,
    position: Optional[str] = None,
    _user=Depends(require_patron),
) -> dict:
    try:
        from src.integrations.injury_timeline import attach_return_estimates

        df = injured_players()
        if team:
            teams = {t.strip().upper() for t in team.split(",") if t.strip()}
            if teams:
                df = df[df["team"].str.upper().isin(teams)]
        if position:
            pos = position.lower()
            pos_map = {"qb": {"QB"}, "rb": {"RB", "FB"}, "wr": {"WR", "TE"}}
            allowed = pos_map.get(pos)
            if allowed:
                df = df[df["position"].isin(allowed)]
        players = attach_return_estimates(df.to_dict(orient="records"))
        return {"count": len(players), "players": players}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/accuracy/season-long")
def season_long_accuracy(position: Optional[str] = None, _user=Depends(require_patron)) -> dict:
    report = load_season_long_report()
    if not report:
        raise HTTPException(
            status_code=503,
            detail="Season-long report not built. Run: python -m src.analytics.season_long_eval",
        )
    if position:
        pos = position.lower()
        if pos not in report:
            raise HTTPException(status_code=404, detail=f"No season-long report for {pos}")
        return report[pos]
    return report


@app.get("/api/accuracy")
def accuracy_report(position: Optional[str] = None, _user=Depends(require_patron)) -> dict:
    report = load_accuracy_report()
    if not report:
        raise HTTPException(
            status_code=503,
            detail="Accuracy report not built. Run: python -m src.products.accuracy_report",
        )
    if position:
        pos = position.lower()
        if pos not in report:
            raise HTTPException(status_code=404, detail=f"No report for {pos}")
        return _enrich_accuracy_report(report[pos])
    return {k: _enrich_accuracy_report(v) for k, v in report.items()}


def _enrich_accuracy_report(report: dict) -> dict:
    """Ensure post-hoc ffverse labeling and forecast/diagnostic keys in API responses."""
    out = dict(report)
    labels = dict(out.get("labels") or {})
    labels["ffopportunity"] = "Usage EP (post-hoc, ffverse)"
    out["labels"] = labels
    if "forecast_keys" not in out:
        out["forecast_keys"] = [
            "scoresense",
            "site_composite",
            "model_blended",
            "season_avg",
            "last_game",
        ]
        if out.get("espn_is_weekly_benchmark"):
            out["forecast_keys"].append("espn")
        if out.get("fantasypros_is_benchmark"):
            out["forecast_keys"].append("fantasypros")
    if "diagnostic_keys" not in out:
        out["diagnostic_keys"] = ["ffopportunity"]
        if not out.get("espn_is_weekly_benchmark"):
            out["diagnostic_keys"].append("espn")
        if not out.get("fantasypros_is_benchmark"):
            out["diagnostic_keys"].append("fantasypros")
    labels.setdefault("fantasypros", "FantasyPros consensus (PPR)")
    out["post_hoc_note"] = (
        "Usage EP (post-hoc) uses actual weekly opportunity from ffverse — not a pre-game forecast. "
        "Compare ScoreSense to the simple guess baseline, ESPN weekly (when available), and "
        "FantasyPros consensus (when cached) for fair accuracy. "
        "FANTASYPROS_USE_AS_FEATURE defaults to false so FP is not used as a model input during backtests."
    )
    return out


@app.get("/api/accuracy/status")
def accuracy_rebuild_status(_user=Depends(require_patron)) -> dict:
    return get_accuracy_rebuild_status()


@app.post("/api/accuracy/rebuild/ack")
def accuracy_rebuild_ack(_user=Depends(require_patron)) -> dict:
    return acknowledge_accuracy_rebuild()


@app.post("/api/accuracy/rebuild")
async def rebuild_accuracy(
    include_espn: bool = True,
    _user=Depends(require_admin),
) -> dict:
    try:
        queued = start_full_accuracy_rebuild(include_espn=include_espn)
        if queued.get("status") == "already_running":
            return {
                **queued,
                "message": "Accuracy rebuild already in progress",
            }
        submit_cpu_job(run_full_accuracy_rebuild, include_espn)
        return {
            **queued,
            "message": "Rebuilding yearly accuracy and upside reports (QB, RB, WR)",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/upside")
def upside_report(position: Optional[str] = None, _user=Depends(require_patron)) -> dict:
    report = load_upside_report()
    if not report:
        raise HTTPException(
            status_code=503,
            detail="Upside report not built. Run: python -m src.analytics.upside_eval",
        )
    if position:
        pos = position.lower()
        if pos not in report:
            raise HTTPException(status_code=404, detail=f"No upside report for {pos}")
        return report[pos]
    return report


@app.post("/api/upside/rebuild")
async def rebuild_upside(_user=Depends(require_admin)) -> dict:
    """Alias for the combined accuracy rebuild facade."""
    try:
        queued = start_full_accuracy_rebuild(include_espn=True)
        if queued.get("status") == "already_running":
            return {
                **queued,
                "message": "Accuracy rebuild already in progress",
            }
        submit_cpu_job(run_full_accuracy_rebuild, True)
        return {
            **queued,
            "message": "Rebuilding yearly accuracy and upside reports (QB, RB, WR)",
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/refresh/status")
def refresh_status(_user=Depends(require_patron)) -> dict:
    return get_refresh_status()


@app.post("/api/refresh")
async def refresh(
    retrain: bool = True,
    draft_only: bool = False,
    background_tasks: BackgroundTasks = None,
    _user=Depends(require_admin),
) -> dict:
    try:
        if background_tasks is not None:
            background_tasks.add_task(run_weekly_refresh, retrain, None, draft_only)
            return {"status": "started", "message": "Weekly refresh running in background"}
        loop = asyncio.get_event_loop()
        status = await loop.run_in_executor(None, run_weekly_refresh, retrain, None, draft_only)
        return {"status": "completed", **status}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _json_safe_records(df) -> list[dict[str, Any]]:
    """Convert dataframe rows to JSON-safe dicts (no NaN/Inf)."""
    records = df.to_dict(orient="records")
    for rec in records:
        for key, value in list(rec.items()):
            if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
                rec[key] = None
            elif value is None or (isinstance(value, float) and math.isnan(value)):
                rec[key] = None
    return records


def _ros_legacy_aliases(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep legacy column names so older frontend builds still render."""
    aliases = {
        "Reg Season Pts": "Points YTD",
        "Next Week P50": "Weekly Proj",
        "ROS P50": "ROS Proj",
        "ROS P10": "ROS Low",
        "ROS P90": "ROS High",
        "Season P50": "Season Proj",
        "Season P10": "Season Low",
        "Season P90": "Season High",
    }
    for rec in records:
        for new_key, old_key in aliases.items():
            if new_key in rec and old_key not in rec:
                rec[old_key] = rec[new_key]
    return records


def _warm_weekly_artifact(
    position: str,
    season: int,
    week: int,
    apply_injury_adjustments: bool,
) -> None:
    """Cold-cache warm via shared process pool (used by predict + compare)."""
    get_process_executor().submit(
        compute_weekly_artifact,
        position,
        int(season),
        int(week),
        apply_injury_adjustments,
    ).result()


def _predict_response(
    position: str,
    season: Optional[int] = None,
    week: Optional[int] = None,
    apply_injury_adjustments: bool = True,
    player_ids: Optional[list[str]] = None,
) -> dict:
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise HTTPException(status_code=400, detail="position must be qb, rb, or wr")
    try:
        if season is not None and week is not None:
            preds = load_weekly_prediction(
                position,
                season=season,
                week=week,
                apply_injury_adjustments=apply_injury_adjustments,
                allow_compute=False,
            )
            if preds.empty:
                # Cold cache: run inference in the shared process pool so it
                # doesn't stall other requests, then re-read the saved artifact.
                _warm_weekly_artifact(position, int(season), int(week), apply_injury_adjustments)
                preds = load_weekly_prediction(
                    position,
                    season=season,
                    week=week,
                    apply_injury_adjustments=apply_injury_adjustments,
                    allow_compute=False,
                )
        else:
            preds = load_weekly_prediction(
                position,
                season=season,
                week=week,
                apply_injury_adjustments=apply_injury_adjustments,
            )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    meta = {}
    note = ""
    if len(preds) > 0:
        meta = {
            "season": int(preds["Season"].iloc[0]) if "Season" in preds.columns else None,
            "week": int(preds["Week"].iloc[0]) if "Week" in preds.columns else None,
            "teams": int(preds["Team"].nunique()) if "Team" in preds.columns else None,
            "preseason_mode": bool(preds.attrs.get("preseason_mode")),
            "apply_injury_adjustments": bool(apply_injury_adjustments),
        }
        if preds.attrs.get("built_at"):
            meta["built_at"] = preds.attrs.get("built_at")
        inference = preds.attrs.get("inference_meta") or {}
        if inference:
            meta["feature_season"] = inference.get("feature_season")
            meta["roster_overlay"] = inference.get("roster_overlay")
            meta["depth_chart"] = inference.get("depth_chart") or {"applied": False}
        note = str(preds.attrs.get("projection_note") or "")
    projections = _json_safe_records(preds)
    ids = parse_compare_player_ids(player_ids)
    if ids:
        projections = filter_projections_by_ids(projections, ids)
        meta = {**meta, "filtered_player_ids": ids}
    return {
        "position": position,
        "count": len(projections),
        "meta": meta,
        "note": note,
        "projections": projections,
    }


def _ros_response(
    position: str,
    season: Optional[int] = None,
    week: Optional[int] = None,
    apply_injury_adjustments: bool = True,
) -> dict:
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise HTTPException(status_code=400, detail="position must be qb, rb, or wr")
    try:
        preds = load_ros_prediction(
            position,
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    meta = {}
    if len(preds) > 0:
        weeks_remaining = int(preds["Weeks Remaining"].iloc[0])
        projection_week = int(preds["From Week"].iloc[0])
        season_complete = weeks_remaining == 0
        meta = {
            "season": int(preds["Season"].iloc[0]),
            "from_week": projection_week,
            "projection_week": projection_week,
            "weeks_remaining": weeks_remaining,
            "season_complete": season_complete,
        }
        if season_complete:
            note = (
                f"{meta['season']} regular season complete (weeks 1–18). "
                "Totals are points scored; no ROS left."
            )
        else:
            note = (
                f"Season P50 = reg-season points + next-week P50 × {weeks_remaining} weeks left. "
                f"Next P50 is the week {projection_week} median projection, not a scoring average."
            )
    else:
        note = "No projections available."
    return {
        "position": position,
        "count": len(preds),
        "meta": meta,
        "note": note,
        "projections": _ros_legacy_aliases(_json_safe_records(preds)),
    }


@app.post("/api/predict")
def predict(request: ProjectionRequest, _user=Depends(require_patron)) -> dict:
    ids = list(request.player_ids or [])
    if request.ids:
        ids.extend(parse_compare_player_ids(request.ids))
    return _predict_response(
        request.position,
        request.season,
        request.week,
        request.apply_injury_adjustments,
        player_ids=ids or None,
    )


@app.get("/api/predict/compare")
def predict_compare(
    ids: str = Query(..., description="Comma-separated player_id values (2–4)"),
    season: Optional[int] = None,
    week: Optional[int] = None,
    apply_injury_adjustments: bool = True,
    _user=Depends(require_patron),
) -> dict:
    """Start/sit comparison for 2–4 players from weekly projection artifacts."""
    player_ids = parse_compare_player_ids(ids)

    def _compute(position: str, s: int, w: int, apply_injury: bool) -> None:
        _warm_weekly_artifact(position, s, w, apply_injury)

    try:
        return build_player_compare(
            player_ids,
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
            compute_fn=_compute,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/predict/{position}")
def predict_get(
    position: str,
    season: Optional[int] = None,
    week: Optional[int] = None,
    apply_injury_adjustments: bool = True,
    ids: Optional[str] = Query(
        None,
        description="Optional comma-separated player_id filter (SCORE-4)",
    ),
    _user=Depends(require_patron),
) -> dict:
    return _predict_response(
        position,
        season,
        week,
        apply_injury_adjustments,
        player_ids=parse_compare_player_ids(ids) or None,
    )


@app.get("/api/sentiment/{position}")
def sentiment_get(
    position: str,
    season: Optional[int] = None,
    week: Optional[int] = None,
    _user=Depends(require_patron),
) -> dict:
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise HTTPException(status_code=400, detail="position must be qb, rb, or wr")
    try:
        from src.config import PROCESSED_DATA_DIR
        from src.core.projection_context import resolve_projection_context

        path = PROCESSED_DATA_DIR / "qb_mlready.parquet"
        df = pd.read_parquet(path, columns=["season", "week"])
        resolved_season, resolved_week = resolve_projection_context(df, season, week)
        return build_sentiment_response(position, resolved_season, resolved_week)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _resolve_fantasy_narrative_context(
    season: Optional[int],
    week: Optional[int],
) -> tuple[int, int]:
    from src.config import PROCESSED_DATA_DIR
    from src.core.projection_context import resolve_projection_context

    path = PROCESSED_DATA_DIR / "qb_mlready.parquet"
    df = pd.read_parquet(path, columns=["season", "week"])
    return resolve_projection_context(df, season, week)


@app.get("/api/fantasy-narrative/{position}/weekly")
def fantasy_narrative_weekly_get(
    position: str,
    season: Optional[int] = None,
    week: Optional[int] = None,
    _user=Depends(require_patron),
) -> dict:
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise HTTPException(status_code=400, detail="position must be qb, rb, or wr")
    try:
        resolved_season, resolved_week = _resolve_fantasy_narrative_context(season, week)
        return build_fantasy_weekly_response(position, resolved_season, resolved_week)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/fantasy-narrative/{position}/season")
def fantasy_narrative_season_get(
    position: str,
    season: Optional[int] = None,
    week: Optional[int] = None,
    _user=Depends(require_patron),
) -> dict:
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise HTTPException(status_code=400, detail="position must be qb, rb, or wr")
    try:
        resolved_season, resolved_week = _resolve_fantasy_narrative_context(season, week)
        return build_fantasy_season_response(position, resolved_season, resolved_week)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/meta/draft/{position}")
def draft_meta(position: str, _user=Depends(require_patron)) -> dict:
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise HTTPException(status_code=400, detail="position must be qb, rb, or wr")
    try:
        return get_draft_meta(position)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _draft_response(position: str, season: Optional[int] = None) -> dict:
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise HTTPException(status_code=400, detail="position must be qb, rb, or wr")
    try:
        preds = draft_pool_for_position(position, season) if season else predict_draft_season(position, season=season)
        if preds.empty and season:
            preds = predict_draft_season(position, season=season)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    feature_season = int(preds.attrs.get("feature_season", season or 0))
    games_per_season = int(preds.attrs.get("games_per_season", 17))
    roster_overlay = preds.attrs.get("roster_overlay") or {}
    depth_chart = preds.attrs.get("depth_chart") or {}
    season_quantile_method = preds.attrs.get("season_quantile_method")
    season_coverage_meta = preds.attrs.get("season_coverage_meta") or {}
    target_season = int(preds["Season"].iloc[0]) if len(preds) else season
    note = draft_projection_note(
        target_season,
        feature_season,
        games_per_season,
        roster_overlay,
        depth_chart,
        position,
        season_quantile_method,
    )
    meta = {
        "season": target_season,
        "feature_season": feature_season,
        "games_per_season": games_per_season,
        "teams": int(preds["Team"].nunique()) if "Team" in preds.columns else None,
        "roster_overlay": roster_overlay,
        "depth_chart": depth_chart,
        "season_quantile_method": season_quantile_method,
        "season_coverage_meta": season_coverage_meta,
    }
    return {
        "position": position,
        "count": len(preds),
        "meta": meta,
        "note": note,
        "projections": _json_safe_records(preds),
    }


@app.get("/api/draft/{position}")
def draft_get(
    position: str,
    season: Optional[int] = None,
    _user=Depends(require_patron),
) -> dict:
    return _draft_response(position, season)


@app.get("/api/ros/{position}")
def ros_get(
    position: str,
    season: Optional[int] = None,
    week: Optional[int] = None,
    apply_injury_adjustments: bool = True,
    _user=Depends(require_patron),
) -> dict:
    return _ros_response(position, season, week, apply_injury_adjustments)


@app.get("/api/lineup/formats")
def lineup_formats(_user=Depends(require_patron)) -> dict:
    return {"formats": list_site_configs()}


@app.get("/api/lineup/pool")
def lineup_pool(
    season: Optional[int] = None,
    week: Optional[int] = None,
    site: str = "seasonal",
    apply_injury_adjustments: bool = True,
    _user=Depends(require_patron),
) -> dict:
    try:
        pool, meta = build_lineup_pool(
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
            site=site,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    records = _json_safe_records(pool)
    for rec in records:
        rec["player_id"] = str(rec.get("player_id") or "")
    bye = sorted(teams_on_bye(int(meta["season"]), int(meta["week"])))
    note = (
        "Pool includes top projected QBs, RBs, WRs, and TEs for the selected week. "
        "Out/IR players are excluded unless locked."
    )
    if bye:
        note += f" Teams on bye (blocked by default): {', '.join(bye)}."
    if site != "seasonal":
        note += " Salaries auto-load from the live slate when available, or import a CSV."
    return {
        "meta": {**meta, "bye_teams": bye},
        "count": len(records),
        "players": records,
        "note": note,
    }


def _lineup_salary_response(
    pool: pd.DataFrame,
    meta: dict,
    salaries: pd.DataFrame,
    stats: dict,
    slate: dict | None = None,
) -> dict:
    records = _json_safe_records(pool)
    for rec in records:
        rec["player_id"] = str(rec.get("player_id") or "")
    note = (
        f"Matched {stats.get('matched', 0)} players to ScoreSense projections. "
        f"{stats.get('pool_without_salary', 0)} pool players lack a slate salary."
    )
    if slate and slate.get("offseason_placeholder"):
        note += " Offseason placeholder slate — NFL main slates appear in season."
    return {
        "meta": meta,
        "stats": stats,
        "count": len(records),
        "players": records,
        "salaries": _json_safe_records(salaries),
        "slate": slate,
        "note": note,
    }


@app.get("/api/lineup/slates")
def lineup_slates(
    site: str = "draftkings",
    category: str = "all",
    sport: str = "NFL",
    _user=Depends(require_patron),
) -> dict:
    site = site.lower()
    if site not in ("draftkings", "fanduel"):
        raise HTTPException(status_code=400, detail="site must be draftkings or fanduel")
    if category not in SLATE_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"category must be one of: {', '.join(SLATE_CATEGORIES)}",
        )
    try:
        slates = list_slates(site=site, category=category, sport=sport)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    default_slate = pick_default_slate(site, category="main") or (slates[0] if slates else None)
    return {
        "site": site,
        "category": category,
        "count": len(slates),
        "slates": slates,
        "default_slate_id": default_slate.get("slate_id") if default_slate else None,
        "note": (
            "FanDuel slates require FANDUEL_AUTH_TOKEN in .env."
            if site == "fanduel"
            else "DraftKings slates load from the public lobby API."
        ),
    }


@app.get("/api/lineup/salaries/load")
def lineup_load_salaries(
    site: str = "draftkings",
    slate_id: Optional[str] = None,
    category: str = "main",
    season: Optional[int] = None,
    week: Optional[int] = None,
    apply_injury_adjustments: bool = True,
    force_refresh: bool = False,
    _user=Depends(require_patron),
) -> dict:
    site = site.lower()
    if site not in ("draftkings", "fanduel"):
        raise HTTPException(status_code=400, detail="site must be draftkings or fanduel")
    try:
        slate_meta = None
        if not slate_id:
            slate_meta = pick_default_slate(site, category=category)
            if not slate_meta:
                raise ValueError(f"No {site} slate found for category '{category}'.")
            slate_id = str(slate_meta["slate_id"])
        else:
            matches = [s for s in list_slates(site, category="all") if str(s["slate_id"]) == str(slate_id)]
            slate_meta = matches[0] if matches else {"slate_id": slate_id, "site": site}

        salaries = fetch_slate_salaries(
            site,
            str(slate_id),
            force_refresh=force_refresh,
        )
        if salaries.empty:
            raise ValueError(f"No salaries returned for slate {slate_id}.")

        pool, meta = build_lineup_pool(
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
            site=site,
        )
        merged, stats = attach_salaries_to_pool(pool, salaries)
        meta["slate_id"] = slate_id
        meta["slate_name"] = slate_meta.get("name")
        meta["slate_category"] = slate_meta.get("category")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return _lineup_salary_response(merged, meta, salaries, stats, slate=slate_meta)


@app.post("/api/lineup/salaries/import")
async def lineup_import_salaries(
    file: UploadFile = File(...),
    site: str = "draftkings",
    season: Optional[int] = None,
    week: Optional[int] = None,
    apply_injury_adjustments: bool = True,
    _user=Depends(require_patron),
) -> dict:
    if site not in ("draftkings", "fanduel"):
        raise HTTPException(status_code=400, detail="site must be draftkings or fanduel")
    try:
        raw = await file.read()
        salaries = parse_salary_csv(raw, site=site)
        pool, meta = build_lineup_pool(
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
            site=site,
        )
        merged, stats = attach_salaries_to_pool(pool, salaries)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return _lineup_salary_response(merged, meta, salaries, stats)


@app.post("/api/lineup/optimize")
def lineup_optimize(
    request: LineupOptimizeRequest,
    _user=Depends(require_patron),
) -> dict:
    objective = (request.objective or "median").lower()
    if objective not in ("median", "floor", "ceiling", "value"):
        raise HTTPException(
            status_code=400,
            detail="objective must be median, floor, ceiling, or value",
        )
    site = (request.site or "seasonal").lower()
    try:
        pool, meta = build_lineup_pool(
            season=request.season,
            week=request.week,
            apply_injury_adjustments=request.apply_injury_adjustments,
            site=site,
        )
        if request.slate_salaries:
            sal_df = pd.DataFrame(request.slate_salaries)
            pool, sal_stats = attach_salaries_to_pool(pool, sal_df)
            meta["salary_import"] = sal_stats
        result = optimize_from_pool_dataframe(
            pool,
            objective=objective,
            locked_player_ids=request.locked_player_ids,
            excluded_player_ids=request.excluded_player_ids,
            candidate_player_ids=request.candidate_player_ids,
            site=site,
            salary_cap=request.salary_cap,
            block_bye_weeks=request.block_bye_weeks,
            require_qb_stack=request.require_qb_stack,
            lineup_count=max(1, min(request.lineup_count, 20)),
            max_overlap=request.max_overlap,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "meta": meta,
        **result,
    }


@app.get("/api/bestball/board")
def bestball_board(
    season: Optional[int] = None,
    _user=Depends(require_patron),
) -> dict:
    try:
        from src.projections.draft_meta import get_draft_meta

        meta_defaults = get_draft_meta("qb")
        season = season or meta_defaults.get("default_season")
        board, meta = build_bestball_board(int(season))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    records = _json_safe_records(board) if not board.empty else []
    return {
        "meta": meta,
        "count": len(records),
        "players": records,
        "note": meta.get("adp_source", ""),
    }


@app.get("/api/props/scan")
def props_scan(
    position: str = "qb",
    season: Optional[int] = None,
    week: Optional[int] = None,
    use_odds: bool = False,
    _user=Depends(require_patron),
) -> dict:
    pos = position.lower()
    if pos not in ("qb", "rb", "wr"):
        raise HTTPException(status_code=400, detail="position must be qb, rb, or wr")
    try:
        scan, meta = build_prop_scan(pos, season=season, week=week, use_odds_api=use_odds)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return {
        "meta": meta,
        "count": len(scan),
        "props": _json_safe_records(scan) if not scan.empty else [],
        "note": meta.get("note", ""),
    }


@app.post("/api/props/lines/import")
async def props_import_lines(
    file: UploadFile = File(...),
    position: str = "qb",
    season: Optional[int] = None,
    week: Optional[int] = None,
    _user=Depends(require_patron),
) -> dict:
    pos = position.lower()
    if pos not in ("qb", "rb", "wr"):
        raise HTTPException(status_code=400, detail="position must be qb, rb, or wr")
    try:
        raw = await file.read()
        market = parse_prop_lines_csv(raw)
        scan, meta = build_prop_scan(pos, season=season, week=week, market_lines=market)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "meta": meta,
        "count": len(scan),
        "props": _json_safe_records(scan) if not scan.empty else [],
        "note": f"Matched {meta.get('with_market', 0)} market lines.",
    }


@app.get("/.well-known/assetlinks.json")
def serve_android_assetlinks() -> list[dict[str, Any]]:
    """Digital Asset Links for Android TWA — set TWA_SHA256_FINGERPRINT in server .env."""
    fingerprints = [
        fp.strip()
        for fp in TWA_SHA256_FINGERPRINT.split(",")
        if fp.strip() and not fp.strip().startswith("REPLACE_WITH")
    ]
    if not fingerprints:
        return []
    return [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": TWA_PACKAGE_NAME,
                "sha256_cert_fingerprints": fingerprints,
            },
        }
    ]


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/")
    def serve_dashboard():
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Frontend not built. Run: cd frontend && npm run build")

    @app.get("/{spa_path:path}")
    def serve_spa(spa_path: str):
        """SPA fallback so /lineup and other client routes do not 404 as JSON."""
        blocked = ("api", "docs", "openapi.json", "redoc")
        if spa_path.startswith("api/") or spa_path in blocked or spa_path.startswith("docs/"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = FRONTEND_DIST / spa_path
        if candidate.is_file():
            return FileResponse(candidate)
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="Frontend not built. Run: cd frontend && npm run build")
else:

    @app.get("/")
    def dashboard_dev_hint() -> dict:
        return {
            "message": "ScoreSense API is running. For the dashboard, use one of:",
            "dev": "Terminal 1: uvicorn app.api:app --reload --port 8000 | Terminal 2: cd frontend && npm run dev → open http://localhost:5173",
            "prod": "cd frontend && npm run build, then reload http://127.0.0.1:8000",
            "health": "/api/health",
        }
