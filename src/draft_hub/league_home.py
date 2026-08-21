"""Phase-aware League Home + action center (SCORE-10).

Aggregates existing Hub signals (draft lifecycle, NFL calendar, freshness,
cap/pre-draft, optional weekly decisions) into one payload for League Home.
Read-only: never live-Sleeper syncs, never persists.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from src.draft_hub import storage
from src.draft_hub.hub_context import list_roster_for_context
from src.draft_hub.hub_freshness import league_data_freshness
from src.draft_hub.pre_draft_cap import cap_summary_for_phase, pre_draft_cap_summary
from src.draft_hub.schemas import LeagueRules
from src.integrations.sleeper import get_nfl_state

PHASE_PRE_DRAFT = "pre_draft"
PHASE_LIVE_DRAFT = "live_draft"
PHASE_IN_SEASON = "in_season"
PHASE_OFFSEASON = "offseason"

_PHASE_LABELS = {
    PHASE_PRE_DRAFT: "Pre-draft",
    PHASE_LIVE_DRAFT: "Live draft",
    PHASE_IN_SEASON: "In season",
    PHASE_OFFSEASON: "Offseason",
}

_PRIMARY_CTA = {
    PHASE_PRE_DRAFT: {"view": "value", "label": "Draft plan"},
    PHASE_LIVE_DRAFT: {"view": "room", "label": "Live draft"},
    PHASE_IN_SEASON: {"view": "week", "label": "Your Week"},
    PHASE_OFFSEASON: {"view": "roster", "label": "Roster & cap"},
}

# Priority order for action center (lower = higher priority).
_ACTION_PRIORITY = {
    "cap_overage": 10,
    "draft_night": 12,
    "sync_league": 20,
    "projections_stale": 30,
    "projections_missing": 35,
    "expiring_contracts": 40,
    "lineup_decisions": 50,
    "cap_sheets_stale": 60,
}


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


def build_draft_schedule(
    league: dict[str, Any] | None,
    *,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    if not league:
        return None
    starts = league.get("draft_starts_at")
    if not starts:
        return None
    when = _parse_iso(str(starts))
    if when is None:
        return None
    ref = now or datetime.now(timezone.utc)
    seconds = int((when.astimezone(timezone.utc) - ref.astimezone(timezone.utc)).total_seconds())
    return {
        "starts_at": starts,
        "timezone": league.get("draft_timezone") or "UTC",
        "seconds_until": seconds,
        "is_due": seconds <= 0,
    }


def _days_ago(built_at: str | None, *, now: datetime | None = None) -> int | None:
    dt = _parse_iso(built_at)
    if dt is None:
        return None
    ref = now or datetime.now(timezone.utc)
    delta = ref - dt.astimezone(timezone.utc)
    return max(0, int(delta.total_seconds() // 86400))


def _nfl_season_type() -> str:
    try:
        state = get_nfl_state()
        return str(state.get("season_type") or "off").lower()
    except Exception:
        return "off"


def resolve_league_phase(
    *,
    draft_completed: bool,
    league_status: str | None,
    draft_session_status: str | None,
    nfl_season_type: str | None = None,
) -> dict[str, Any]:
    """Map hub draft lifecycle + NFL calendar to a League Home phase."""
    session = str(draft_session_status or "").lower()
    league = str(league_status or "").lower()
    nfl = str(nfl_season_type or _nfl_season_type()).lower()

    if session in {"nominating", "bidding"} or league == "live":
        phase_id = PHASE_LIVE_DRAFT
    elif not draft_completed:
        phase_id = PHASE_PRE_DRAFT
    elif nfl == "regular":
        phase_id = PHASE_IN_SEASON
    else:
        # off / pre / post (and unknown) after draft → offseason home (roster & cap).
        phase_id = PHASE_OFFSEASON

    cta = dict(_PRIMARY_CTA[phase_id])
    return {
        "id": phase_id,
        "label": _PHASE_LABELS[phase_id],
        "nfl_season_type": nfl,
        "league_status": league or None,
        "draft_session_status": session or None,
        "draft_completed": bool(draft_completed),
        "primary_cta": cta,
    }


def _status_line(ctx: dict[str, Any], phase: dict[str, Any]) -> str:
    league_name = str(ctx.get("league_name") or "").strip()
    if ctx.get("mode") != "league" or not league_name:
        return f"Solo prep · {phase['label']}"
    return f"{league_name} · {phase['label']}"


def _action(
    action_id: str,
    *,
    severity: str,
    message: str,
    href: str,
    count: int | None = None,
    amount: float | None = None,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    item: dict[str, Any] = {
        "id": action_id,
        "severity": severity,
        "message": message,
        "href": href,
        "priority": _ACTION_PRIORITY.get(action_id, 100),
    }
    if count is not None:
        item["count"] = int(count)
    if amount is not None:
        item["amount"] = float(amount)
    if meta:
        item["meta"] = meta
    return item


def _build_actions(
    *,
    phase: dict[str, Any],
    freshness: dict[str, Any],
    cap: dict[str, Any],
    pre_draft: dict[str, Any] | None,
    week_summary: dict[str, Any],
    sleeper_linked: bool,
    draft_schedule: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    phase_id = phase["id"]

    remaining = float(cap.get("remaining") or 0)
    if remaining < 0:
        overage = abs(remaining)
        actions.append(
            _action(
                "cap_overage",
                severity="high",
                message=f"Resolve ${overage:.0f} cap overage",
                href="planner",
                amount=overage,
            )
        )

    if phase_id == PHASE_PRE_DRAFT and draft_schedule and not draft_schedule.get("is_due"):
        secs = int(draft_schedule.get("seconds_until") or 0)
        if 0 < secs <= 48 * 3600:
            hours = secs // 3600
            mins = (secs % 3600) // 60
            wait = f"{hours}h {mins}m" if hours else f"{mins}m"
            actions.append(
                _action(
                    "draft_night",
                    severity="medium",
                    message=f"Draft night starts in {wait}",
                    href="room",
                )
            )

    if not sleeper_linked and phase_id != PHASE_LIVE_DRAFT:
        actions.append(
            _action(
                "sync_league",
                severity="medium",
                message="Link & sync your Sleeper league",
                href="setup",
            )
        )

    proj = (freshness or {}).get("projections") or {}
    if not proj.get("available", False):
        actions.append(
            _action(
                "projections_missing",
                severity="high",
                message="Sync projections (draft pool unavailable)",
                href="setup",
            )
        )
    elif proj.get("stale"):
        days = _days_ago(proj.get("built_at"))
        if days is not None and days > 0:
            msg = f"Sync projections ({days} day{'s' if days != 1 else ''} old)"
        else:
            msg = "Sync projections (fingerprint stale)"
        actions.append(
            _action(
                "projections_stale",
                severity="medium",
                message=msg,
                href="setup",
                meta={"days_old": days, "built_at": proj.get("built_at")},
            )
        )

    if phase_id == PHASE_PRE_DRAFT and pre_draft:
        must_extend = list(pre_draft.get("must_extend") or [])
        expiring = list(pre_draft.get("expiring_before_draft") or must_extend)
        n = len(expiring)
        if n:
            actions.append(
                _action(
                    "expiring_contracts",
                    severity="high" if must_extend else "medium",
                    message=(
                        f"Review {n} expiring contract{'s' if n != 1 else ''}"
                    ),
                    href="roster",
                    count=n,
                    meta={
                        "must_extend": len(must_extend),
                        "dropping_at_draft": len(pre_draft.get("dropping_at_draft") or []),
                    },
                )
            )

    if phase_id == PHASE_IN_SEASON and week_summary.get("available"):
        n = int(week_summary.get("decision_count") or 0)
        if n > 0:
            actions.append(
                _action(
                    "lineup_decisions",
                    severity="medium",
                    message=f"View {n} lineup decision{'s' if n != 1 else ''}",
                    href="week",
                    count=n,
                )
            )

    cap_sheets = (freshness or {}).get("cap_sheets") or {}
    if cap_sheets.get("stale") and cap_sheets.get("has_commissioner_files"):
        actions.append(
            _action(
                "cap_sheets_stale",
                severity="low",
                message="Cap sheets are out of date — re-sync Historic",
                href="office",
            )
        )

    actions.sort(key=lambda a: (int(a.get("priority") or 100), a.get("id") or ""))
    return actions


def _attention_line(actions: list[dict[str, Any]], freshness: dict[str, Any]) -> str | None:
    if not actions:
        return None
    parts: list[str] = []
    for item in actions[:3]:
        aid = item.get("id")
        if aid == "projections_stale":
            days = (item.get("meta") or {}).get("days_old")
            if days is None:
                days = _days_ago(((freshness or {}).get("projections") or {}).get("built_at"))
            if days is not None:
                parts.append(f"projections are {days} day{'s' if days != 1 else ''} old")
            else:
                parts.append("projections are stale")
        elif aid == "projections_missing":
            parts.append("projections unavailable")
        elif aid == "cap_overage":
            amt = item.get("amount")
            if amt is not None:
                parts.append(f"Cap is ${float(amt):.0f} over")
            else:
                parts.append("over cap")
        elif aid == "expiring_contracts":
            n = item.get("count") or 0
            parts.append(f"{n} expiring contract{'s' if n != 1 else ''}")
        elif aid == "lineup_decisions":
            n = item.get("count") or 0
            parts.append(f"{n} lineup decision{'s' if n != 1 else ''}")
        elif aid == "draft_night":
            parts.append("draft night upcoming")
        elif aid == "sync_league":
            parts.append("league not linked")
        elif aid == "cap_sheets_stale":
            parts.append("cap sheets stale")
    if not parts:
        return None
    # Sentence-case first fragment for the attention strip.
    line = " · ".join(parts)
    return line[:1].upper() + line[1:] if line else None


def _week_summary_for_home(
    ctx: dict[str, Any],
    phase: dict[str, Any],
    *,
    include_week: bool,
) -> dict[str, Any]:
    """Light weekly summary — only when in-season and include_week is True."""
    if not include_week or phase["id"] != PHASE_IN_SEASON:
        return {
            "available": False,
            "decision_count": 0,
            "skipped": True,
            "reason": (
                "not_in_season"
                if phase["id"] != PHASE_IN_SEASON
                else "include_week_false"
            ),
        }
    try:
        from src.draft_hub.weekly_command_center import build_weekly_command_center

        week_payload = build_weekly_command_center(ctx)
        counts = week_payload.get("counts") or {}
        return {
            "available": True,
            "decision_count": int(counts.get("decisions") or 0),
            "season": (week_payload.get("meta") or {}).get("season"),
            "week": (week_payload.get("meta") or {}).get("week"),
            "headline": (week_payload.get("summary") or {}).get("headline"),
            "skipped": False,
        }
    except Exception as exc:
        return {
            "available": False,
            "decision_count": 0,
            "skipped": False,
            "error": str(exc)[:200],
        }


def build_league_home(
    ctx: dict[str, Any],
    *,
    include_week: bool = True,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build League Home payload for the signed-in Hub user's active context."""
    rules = LeagueRules.model_validate(ctx.get("rules") or {})
    draft_completed = bool(ctx.get("draft_completed"))
    league_id = ctx.get("league_id")
    league_status = ctx.get("league_status")
    draft_session_status = None
    league_row: dict[str, Any] | None = None
    if league_id:
        session = storage.get_draft_session(str(league_id)) or {}
        draft_session_status = session.get("status")
        league_row = storage.get_league(str(league_id)) or {}
        if not league_status:
            league_status = league_row.get("status")

    nfl_season_type = _nfl_season_type()
    phase = resolve_league_phase(
        draft_completed=draft_completed,
        league_status=league_status,
        draft_session_status=draft_session_status,
        nfl_season_type=nfl_season_type,
    )

    # DB-only roster — never live_sleeper on home load.
    roster = list_roster_for_context(ctx, live_sleeper=False)
    cap = cap_summary_for_phase(rules, roster, draft_completed=draft_completed)
    pre_draft = pre_draft_cap_summary(rules, roster, draft_completed=draft_completed)

    if league_id:
        freshness = league_data_freshness(str(league_id), include_contract_detail=False)
    else:
        # Solo: projection pool status only (no league freshness).
        from src.draft_hub.hub_freshness import _draft_pool_status

        season = int(ctx.get("season") or 0)
        pool = _draft_pool_status(season) if season else {
            "available": False,
            "built_at": None,
            "stale": True,
        }
        freshness = {
            "available": True,
            "league_id": None,
            "planning_season": season or None,
            "sleeper": {
                "synced_at": None,
                "linked": bool(ctx.get("sleeper_league_id") or ctx.get("sleeper_username")),
            },
            "scoring": {"synced_at": None, "linked": False},
            "cap_sheets": {
                "stale": False,
                "last_imported_at": None,
                "has_commissioner_files": False,
            },
            "projections": {
                "built_at": pool.get("built_at"),
                "stale": pool.get("stale", False),
                "available": pool.get("available", False),
                "season": pool.get("season"),
            },
        }

    sleeper_linked = bool(
        (freshness.get("sleeper") or {}).get("linked")
        or ctx.get("sleeper_league_id")
        or ctx.get("sleeper_roster_id")
    )

    week_summary = _week_summary_for_home(ctx, phase, include_week=include_week)
    draft_schedule = build_draft_schedule(league_row, now=now)
    actions = _build_actions(
        phase=phase,
        freshness=freshness,
        cap=cap,
        pre_draft=pre_draft,
        week_summary=week_summary,
        sleeper_linked=sleeper_linked,
        draft_schedule=draft_schedule,
    )
    attention_line = _attention_line(actions, freshness)

    # Enrich projection days_old for UI without re-parsing.
    proj = dict(freshness.get("projections") or {})
    proj["days_old"] = _days_ago(proj.get("built_at"), now=now)
    freshness = {**freshness, "projections": proj}

    return {
        "hub_context": {
            "mode": ctx.get("mode"),
            "league_id": ctx.get("league_id"),
            "league_name": ctx.get("league_name"),
            "league_room_code": ctx.get("league_room_code"),
            "team_id": ctx.get("team_id"),
            "team_name": ctx.get("team_name"),
            "season": ctx.get("season"),
            "draft_completed": draft_completed,
            "league_status": league_status,
            "is_commissioner": bool(ctx.get("is_commissioner")),
        },
        "phase": phase,
        "status_line": _status_line(ctx, phase),
        "draft_schedule": draft_schedule,
        "attention": {
            "line": attention_line,
            "items": [
                {
                    "id": a["id"],
                    "severity": a["severity"],
                    "message": a["message"],
                    "href": a["href"],
                    **({"count": a["count"]} if "count" in a else {}),
                    **({"amount": a["amount"]} if "amount" in a else {}),
                }
                for a in actions
            ],
        },
        "actions": actions,
        "freshness": {
            "sleeper": freshness.get("sleeper"),
            "scoring": freshness.get("scoring"),
            "cap_sheets": {
                "stale": (freshness.get("cap_sheets") or {}).get("stale", False),
                "last_imported_at": (freshness.get("cap_sheets") or {}).get("last_imported_at"),
                "has_commissioner_files": (freshness.get("cap_sheets") or {}).get(
                    "has_commissioner_files", False
                ),
            },
            "projections": freshness.get("projections"),
        },
        "cap": {
            "salary_cap": cap.get("salary_cap"),
            "spent": cap.get("spent"),
            "dead_cap": cap.get("dead_cap"),
            "remaining": cap.get("remaining"),
            "roster_size": cap.get("roster_size"),
            "draft_completed": draft_completed,
        },
        "pre_draft": (
            {
                "must_extend_count": len(pre_draft.get("must_extend") or []),
                "dropping_at_draft_count": len(pre_draft.get("dropping_at_draft") or []),
                "expiring_before_draft_count": len(pre_draft.get("expiring_before_draft") or []),
                "draft_budget_available": pre_draft.get("draft_budget_available"),
                "season_committed": pre_draft.get("season_committed"),
                "dead_cap": pre_draft.get("dead_cap"),
            }
            if pre_draft
            else None
        ),
        "week_summary": week_summary,
        "counts": {
            "actions": len(actions),
            "roster": len(roster),
            "must_extend": len((pre_draft or {}).get("must_extend") or []),
            "expiring_contracts": len((pre_draft or {}).get("expiring_before_draft") or []),
            "lineup_decisions": int(week_summary.get("decision_count") or 0),
        },
        "checklist": {
            "setup_reachable": True,
            "default_view": phase["primary_cta"]["view"],
            "note": "Setup/settings remain reachable; League Home is the phase-aware default.",
        },
        "meta": {
            "persists_nothing": True,
            "live_sleeper": False,
            "include_week": bool(include_week),
            "built_for": "SCORE-10",
        },
    }
