"""Draft room nomination pool — full board vs roster + rookies."""

from __future__ import annotations

from typing import Any, Literal

from src.draft_hub import storage
from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.schemas import LeagueRules

PoolMode = Literal["full", "roster_plus_rookies"]
POOL_MODES = ("full", "roster_plus_rookies")


def _nomination_team_count(league_id: str) -> int:
    league = storage.get_league(league_id)
    if league:
        return int(league.get("team_count") or 12)
    return 12


def normalize_pool_mode(mode: str | None) -> PoolMode:
    key = str(mode or "full").strip().lower()
    return "roster_plus_rookies" if key == "roster_plus_rookies" else "full"


def list_drafted_player_ids(league_id: str) -> set[str]:
    ids: set[str] = set()
    for team in storage.list_league_teams(league_id):
        for row in storage.list_team_roster(league_id, team["id"]):
            pid = str(row.get("player_id") or "").strip()
            if pid:
                ids.add(pid)
    return ids


def filter_nomination_rows(
    rows: list[dict[str, Any]],
    *,
    pool_mode: str | None,
    hub_player_ids: set[str],
    drafted_player_ids: set[str],
) -> list[dict[str, Any]]:
    mode = normalize_pool_mode(pool_mode)
    out: list[dict[str, Any]] = []
    for row in rows:
        pid = str(row.get("player_id") or "")
        if not pid or pid in drafted_player_ids:
            continue
        if mode == "roster_plus_rookies" and not (row.get("is_rookie") or pid in hub_player_ids):
            continue
        out.append(row)
    return out


def build_nomination_pool(
    *,
    league_id: str,
    pool_mode: str | None,
    season: int,
    rules: LeagueRules,
    workspace_id: str,
    sleeper_player_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Eligible players for nomination in the live draft room."""
    from src.draft_hub.value_sheet import build_draft_pool_payload, build_value_sheet

    mode = normalize_pool_mode(pool_mode)
    drafted = list_drafted_player_ids(league_id)
    league = storage.get_league(league_id)
    team_count = _nomination_team_count(league_id)

    # Mock/sandbox leagues use league id as workspace — skip roster overlay rebuild.
    if league and storage.league_test_mode(league_id) and not league.get("workspace_id"):
        pool_payload = build_draft_pool_payload(
            season,
            rules,
            storage.list_salary_ranges(workspace_id),
            team_count=team_count,
        )
        rows = filter_nomination_rows(
            list(pool_payload.get("rows") or []),
            pool_mode=mode,
            hub_player_ids=set(),
            drafted_player_ids=drafted,
        )
        return {
            "pool_mode": mode,
            "count": len(rows),
            "drafted_count": len(drafted),
            "hub_available_count": 0,
            "rows": rows,
        }

    hub_available = storage.list_roster(workspace_id)
    hub_ids = {str(r["player_id"]) for r in hub_available if r.get("player_id")}

    sheet = build_value_sheet(
        season,
        rules,
        storage.list_salary_ranges(workspace_id),
        hub_available,
        sleeper_player_ids=sleeper_player_ids or set(),
        team_count=team_count,
    )
    rows = filter_nomination_rows(
        list(sheet.get("rows") or []),
        pool_mode=mode,
        hub_player_ids=hub_ids,
        drafted_player_ids=drafted,
    )

    return {
        "pool_mode": mode,
        "count": len(rows),
        "drafted_count": len(drafted),
        "hub_available_count": len(hub_ids),
        "rows": rows,
    }


def assert_player_nomination_eligible(
    *,
    league_id: str,
    pool_mode: str | None,
    player_id: str,
    season: int,
    rules: LeagueRules,
    workspace_id: str,
    sleeper_player_ids: set[str] | None = None,
) -> None:
    pool = build_nomination_pool(
        league_id=league_id,
        pool_mode=pool_mode,
        season=season,
        rules=rules,
        workspace_id=workspace_id,
        sleeper_player_ids=sleeper_player_ids,
    )
    pid = str(player_id)
    if pid in list_drafted_player_ids(league_id):
        raise ValueError("Player already drafted")
    allowed = {str(r.get("player_id")) for r in pool["rows"]}
    if pid not in allowed:
        if normalize_pool_mode(pool_mode) == "roster_plus_rookies":
            raise ValueError("Player not in your available pool (roster + rookies only)")
        raise ValueError("Player not available for nomination")
