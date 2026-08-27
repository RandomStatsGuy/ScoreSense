"""Read-only demo league payloads for logged-out Hub exploration."""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from src.config import HUB_DEMO_LEAGUE_ID
from src.draft_hub import storage
from src.draft_hub.hub_freshness import league_data_freshness
from src.draft_hub.league_analytics import build_league_analytics
from src.draft_hub.league_history import get_sleeper_scoring_history
from src.draft_hub.trade_insights import build_trade_insights


def demo_league_id() -> str | None:
    raw = (HUB_DEMO_LEAGUE_ID or "").strip()
    return raw or None


def assert_demo_league(league_id: str) -> str:
    lid = demo_league_id()
    if not lid or str(league_id) != lid:
        raise HTTPException(status_code=404, detail="Demo league not available")
    return lid


def demo_config() -> dict[str, Any]:
    lid = demo_league_id()
    if not lid:
        return {"available": False}
    league = storage.get_league(lid)
    if not league:
        return {"available": False}
    return {
        "available": True,
        "demo": True,
        "league_id": lid,
        "league_name": league.get("name"),
        "season": league.get("season"),
    }


def build_demo_workspace() -> dict[str, Any]:
    lid = demo_league_id()
    if not lid:
        raise HTTPException(status_code=404, detail="Demo not configured")
    league = storage.get_league(lid)
    if not league:
        raise HTTPException(status_code=404, detail="Demo league missing")
    teams = storage.list_league_teams(lid)
    first_team = teams[0] if teams else None
    hub_context: dict[str, Any] = {
        "mode": "league",
        "demo": True,
        "league_id": lid,
        "league_name": league.get("name"),
        "season": league.get("season"),
        "team_id": first_team.get("id") if first_team else None,
        "team_name": first_team.get("name") if first_team else "Demo team",
        "is_commissioner": False,
        "can_edit_salaries": False,
        "rules": league.get("rules"),
        "draft_completed": bool(league.get("draft_completed")),
        "league_room_code": league.get("room_code"),
    }
    return {
        "demo": True,
        "name": league.get("name"),
        "season": league.get("season"),
        "rules": league.get("rules"),
        "hub_context": hub_context,
        "memberships": [],
    }


def build_demo_insights(league_id: str, *, sections: str = "cap,scoring,trades") -> dict[str, Any]:
    assert_demo_league(league_id)
    overview = storage.league_roster_overview(league_id)
    league = overview.get("league") or {}
    teams = overview.get("teams") or []
    my_team_id = str(teams[0]["team_id"]) if teams else ""
    draft_completed = bool(league.get("draft_completed"))
    wanted = {s.strip().lower() for s in sections.split(",") if s.strip()}
    if not wanted:
        wanted = {"cap", "scoring", "trades"}

    analytics = build_league_analytics(overview, draft_completed=draft_completed)
    payload: dict[str, Any] = {
        "demo": True,
        "planning_season": league.get("season"),
        "owner_map": {},
    }
    if "cap" in wanted:
        payload["analytics"] = analytics
        historic = {"available": False, "awards": [], "seasons": []}
        try:
            from src.draft_hub.historic_insights import build_current_spend_awards

            awards = build_current_spend_awards(overview, analytics=analytics)
            historic = {
                "available": bool(awards),
                "awards": awards,
                "seasons": [],
            }
        except Exception:
            pass
        payload["historic"] = historic
    if "scoring" in wanted:
        scoring = get_sleeper_scoring_history(
            str(league.get("sleeper_league_id") or ""),
            hub_teams=teams,
        )
        try:
            from src.draft_hub.scoring_insights import build_scoring_awards

            awards = build_scoring_awards(scoring)
            scoring = {**scoring, "awards": awards}
            payload["scoring_awards"] = awards
        except Exception:
            payload["scoring_awards"] = []
        payload["scoring"] = scoring
    if "trades" in wanted:
        from src.draft_hub.insights_cache import read_fair_values

        season_int = int(league.get("season") or 2025)
        fair_map = read_fair_values(league_id, season_int)
        payload["trade"] = build_trade_insights(
            overview,
            my_team_id=my_team_id,
            season=season_int,
            draft_completed=draft_completed,
            analytics=analytics,
            fair_map=fair_map,
        )
    return payload


def build_demo_freshness(league_id: str) -> dict[str, Any]:
    assert_demo_league(league_id)
    return league_data_freshness(league_id, include_contract_detail=False)
