"""One-click mock draft rooms — quick bots, league-name mirror, or keeper sandbox."""

from __future__ import annotations

import copy
import uuid
from typing import Any, Literal

from src.draft_hub import storage
from src.draft_hub.draft_expire_preview import build_draft_expire_preview
from src.draft_hub.draft_state import get_room_state, start_draft
from src.draft_hub.presets import list_presets, load_preset
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.test_draft import setup_test_draft

MockDraftMode = Literal["quick_bots", "league_mirror", "keeper_sandbox"]


def _mirror_bot_names(source_league_id: str, commissioner_sub: str) -> list[str]:
    teams = storage.list_league_teams(source_league_id)
    viewer = storage.get_team_by_user(source_league_id, commissioner_sub)
    viewer_id = str(viewer["id"]) if viewer else None
    names: list[str] = []
    for team in teams:
        if team.get("is_bot"):
            continue
        if viewer_id and str(team["id"]) == viewer_id:
            continue
        label = str(team.get("name") or "Manager").strip()
        if not label:
            continue
        names.append(f"{label} (Mock)")
    return names


def _assert_source_access(source_league_id: str, commissioner_sub: str) -> dict[str, Any]:
    source = storage.get_league(source_league_id)
    if not source:
        raise ValueError("Source league not found")
    viewer = storage.get_team_by_user(source_league_id, commissioner_sub)
    if not viewer and source.get("commissioner_sub") != commissioner_sub:
        raise ValueError("You must be a member of the source league")
    return source


def _clone_keeper_sandbox(
    commissioner_sub: str,
    *,
    source_league_id: str,
    name: str | None = None,
    auto_start: bool = False,
    relax_salary_roster_limits: bool = False,
) -> dict[str, Any]:
    """Copy real keepers/contracts into an isolated test_mode room."""
    source = _assert_source_access(source_league_id, commissioner_sub)
    if source.get("test_mode"):
        raise ValueError("Cannot clone a practice room — pick your real league")

    rules = LeagueRules.model_validate(source.get("rules") or {})
    if relax_salary_roster_limits:
        rules = rules.model_copy(update={"relax_salary_roster_limits": True})
    season = int(source.get("season") or 2026)
    source_teams = storage.list_league_teams(source_league_id)
    if not source_teams:
        raise ValueError("Source league has no teams")
    team_count = max(2, min(len(source_teams), 24))

    viewer = storage.get_team_by_user(source_league_id, commissioner_sub)
    viewer_id = str(viewer["id"]) if viewer else None
    display_name = name or f"{source.get('name', 'League')} — keeper sandbox"

    league = storage.create_league(
        commissioner_sub,
        display_name,
        season,
        rules,
        team_count=team_count,
        workspace_id=None,
        commissioner_team_name=str((viewer or {}).get("name") or "My team"),
        test_mode=True,
    )
    league_id = league["id"]
    storage.update_league_settings(league_id, draft_completed=False)

    sandbox_teams = storage.list_league_teams(league_id)
    comm_team = next((t for t in sandbox_teams if t.get("is_commissioner")), sandbox_teams[0])
    team_map: dict[str, str] = {}
    if viewer_id:
        team_map[viewer_id] = str(comm_team["id"])

    for src_team in source_teams:
        sid = str(src_team["id"])
        if viewer_id and sid == viewer_id:
            continue
        label = str(src_team.get("name") or "Manager").strip() or "Manager"
        bot_id = str(uuid.uuid4())
        storage.add_bot_team(league_id, bot_id, f"{label} (Sandbox)", 0.0)
        team_map[sid] = bot_id

    # If viewer wasn't on a team (commish-only), map first source team to commissioner.
    if not team_map and source_teams:
        team_map[str(source_teams[0]["id"])] = str(comm_team["id"])

    ws_id = storage.roster_workspace_for_league(league)
    source_rosters = storage.list_league_rosters_by_team(source_league_id)
    players_copied = 0
    for src_tid, rows in source_rosters.items():
        dest_tid = team_map.get(str(src_tid))
        if not dest_tid:
            continue
        for row in rows:
            pid = str(row.get("player_id") or "").strip()
            if not pid:
                continue
            contract = copy.deepcopy(row.get("contract")) if row.get("contract") else None
            storage.add_roster_slot(
                ws_id,
                {
                    "player_id": pid,
                    "player_name": row.get("player_name"),
                    "team": row.get("team"),
                    "position": row.get("position") or "WR",
                    "salary": float(row.get("salary") or 0),
                    "contract_years": int(
                        (contract or {}).get("years_remaining")
                        or row.get("contract_years")
                        or 1
                    ),
                    "contract": contract,
                    "source": row.get("source") or "manual",
                    "sleeper_player_id": row.get("sleeper_player_id"),
                    "roster_status": row.get("roster_status") or "active",
                },
                team_id=dest_tid,
            )
            players_copied += 1

    from src.draft_hub.draft_budgets import save_sandbox_baseline, sync_league_auction_budgets

    budgets = sync_league_auction_budgets(league_id)
    save_sandbox_baseline(league_id)

    summary = build_draft_expire_preview(league_id)
    summary["teams"] = len(storage.list_league_teams(league_id))
    summary["players"] = players_copied
    summary["source_league_id"] = source_league_id
    summary["budgets"] = budgets

    if auto_start:
        start_draft(league_id, commissioner_sub)

    try:
        storage.set_mock_saved(league_id, True)
    except ValueError:
        pass
    storage.prune_unsaved_mock_drafts(
        commissioner_sub,
        keep_league_id=league_id,
        drop_stale_in_progress=True,
    )

    return {
        "mock_mode": "keeper_sandbox",
        "league_id": league_id,
        "source_league_id": source_league_id,
        "auto_started": bool(auto_start),
        "summary": summary,
        "state": get_room_state(league_id, commissioner_sub),
    }


def _load_mock_preset(preset_id: str | None) -> LeagueRules:
    pid = str(preset_id or "salary_cap_auction_v1").strip() or "salary_cap_auction_v1"
    known = {str(p.get("id")) for p in list_presets() if p.get("id")}
    if known and pid not in known:
        raise ValueError(f"Unknown preset: {pid}")
    try:
        return load_preset(pid)
    except FileNotFoundError as exc:
        raise ValueError(str(exc)) from exc


def start_mock_draft(
    commissioner_sub: str,
    *,
    mode: MockDraftMode,
    season: int = 2025,
    team_count: int = 12,
    bot_count: int = 7,
    source_league_id: str | None = None,
    auto_start: bool = True,
    name: str | None = None,
    relax_salary_roster_limits: bool = False,
    preset_id: str | None = None,
) -> dict[str, Any]:
    """Create a sandbox mock draft and optionally start the auction immediately."""
    if mode == "keeper_sandbox":
        if not source_league_id:
            raise ValueError("source_league_id required for keeper_sandbox")
        return _clone_keeper_sandbox(
            commissioner_sub,
            source_league_id=source_league_id,
            name=name,
            auto_start=auto_start,
            relax_salary_roster_limits=relax_salary_roster_limits,
        )

    team_count = max(2, min(int(team_count), 24))
    bot_count = max(1, min(int(bot_count), 11))
    source = None
    if source_league_id:
        source = _assert_source_access(source_league_id, commissioner_sub)

    if source is not None:
        rules = LeagueRules.model_validate(source.get("rules") or {})
        season = int(source.get("season") or season)
        if mode == "league_mirror":
            team_count = max(2, min(int(source.get("team_count") or team_count), 24))
    else:
        rules = _load_mock_preset(preset_id)

    if mode == "league_mirror":
        if not source_league_id:
            raise ValueError("source_league_id required for league_mirror mock")
        source = source or _assert_source_access(source_league_id, commissioner_sub)
        viewer = storage.get_team_by_user(source_league_id, commissioner_sub)
        display_name = name or f"{source.get('name', 'League')} — mock draft"
    else:
        viewer = None
        if source is not None:
            display_name = name or f"{source.get('name', 'League')} — practice"
        elif name:
            display_name = name
        elif getattr(rules, "draft_type", None) == "snake":
            display_name = "Snake mock draft"
        elif getattr(rules, "draft_type", None) == "linear":
            display_name = "Linear mock draft"
        else:
            display_name = "Quick mock draft"

    league = storage.create_league(
        commissioner_sub,
        display_name,
        season,
        rules,
        team_count=team_count,
        workspace_id=None,
        test_mode=True,
    )
    league_id = league["id"]

    if mode == "league_mirror":
        mirror_names = _mirror_bot_names(source_league_id, commissioner_sub)
        if viewer:
            comm_teams = [t for t in storage.list_league_teams(league_id) if t.get("is_commissioner")]
            if comm_teams:
                storage.update_team_display_name(comm_teams[0]["id"], str(viewer.get("name") or "My team"))
        budget = float(rules.salary_cap)
        added = 0
        for label in mirror_names:
            if added >= team_count - 1:
                break
            bot_id = str(uuid.uuid4())
            storage.add_bot_team(league_id, bot_id, label, budget)
            added += 1
        if added == 0:
            setup_test_draft(league_id, commissioner_sub, bot_count=min(bot_count, team_count - 1))
        else:
            storage.update_league_test_mode(league_id, True)
    else:
        setup_test_draft(
            league_id,
            commissioner_sub,
            bot_count=min(bot_count, team_count - 1),
        )

    if auto_start:
        start_draft(league_id, commissioner_sub)

    storage.prune_unsaved_mock_drafts(
        commissioner_sub,
        keep_league_id=league_id,
        drop_stale_in_progress=True,
    )

    return {
        "mock_mode": mode,
        "league_id": league_id,
        "auto_started": auto_start,
        "state": get_room_state(league_id, commissioner_sub),
    }
