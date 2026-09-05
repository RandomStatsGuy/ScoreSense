"""Sleeper live weekly matchup scoring — starters, H2H pairs, short-TTL cache."""

from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from src.draft_hub import storage
from src.integrations.sleeper import get_nfl_state, load_sleeper_players

SLEEPER_API = "https://api.sleeper.app/v1"
LIVE_SCORING_MAX_AGE_SECONDS = 60


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _fetch_json(url: str, timeout: int = 25) -> Any:
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def _live_cache_is_fresh(synced_at: str, max_age_seconds: int = LIVE_SCORING_MAX_AGE_SECONDS) -> bool:
    try:
        ts = datetime.fromisoformat(str(synced_at).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - ts
        return age <= timedelta(seconds=max_age_seconds)
    except (ValueError, TypeError):
        return False


def resolve_current_week(
    season: int | str | None = None,
    *,
    week_override: int | None = None,
) -> tuple[int, dict[str, Any]]:
    """NFL week from Sleeper state; optional explicit week for dev/replay."""
    state = get_nfl_state(use_cache=True)
    week = int(week_override if week_override is not None else state.get("week") or 1)
    if season is not None and str(season) != str(state.get("season") or ""):
        pass
    return week, state


def week_picker_meta(
    nfl_state: dict[str, Any],
    league: dict[str, Any] | None = None,
) -> dict[str, int]:
    """UI bounds for week selector — current NFL week through league playoff span."""
    current = int(nfl_state.get("week") or 1)
    settings = (league or {}).get("settings") or {}
    playoff_start = int(settings.get("playoff_week_start") or 15)
    max_week = max(18, playoff_start + 3)
    return {"current_week": current, "max_week": max_week}


def _player_display_name(sleeper_player_id: str, info: dict[str, Any]) -> str:
    """Sleeper DEF entries carry first/last ("New Orleans" "Saints"), not full_name."""
    full = str(info.get("full_name") or "").strip()
    if full:
        return full
    first = str(info.get("first_name") or "").strip()
    last = str(info.get("last_name") or "").strip()
    if first or last:
        return " ".join(part for part in (first, last) if part)
    return f"Player {sleeper_player_id}" if sleeper_player_id else "Player"


def _points_for(sleeper_player_id: str, players_points: dict[str, Any]) -> float:
    sid = str(sleeper_player_id or "")
    raw = players_points.get(sid)
    if raw is None:
        try:
            raw = players_points.get(int(sid))
        except (TypeError, ValueError):
            raw = None
    try:
        return float(raw or 0)
    except (TypeError, ValueError):
        return 0.0


def _enrich_starter(
    sleeper_player_id: str,
    players_points: dict[str, Any],
    raw_players: dict[str, Any],
) -> dict[str, Any]:
    sid = str(sleeper_player_id or "")
    if not sid or sid == "0":
        return {
            "sleeper_player_id": sid,
            "player_id": "",
            "name": "Empty",
            "position": "",
            "team": "",
            "points": 0.0,
        }
    pts_raw = players_points.get(sid)
    if pts_raw is None:
        try:
            pts_raw = players_points.get(int(sid))
        except (TypeError, ValueError):
            pts_raw = None
    pts = float(pts_raw or 0)
    info = raw_players.get(sid) or {}
    gsis = str(info.get("gsis_id") or "").strip()
    player_id = gsis if gsis else f"sleeper-{sid}"
    return {
        "sleeper_player_id": sid,
        "player_id": player_id,
        "name": _player_display_name(sid, info),
        "position": str(info.get("position") or ""),
        "team": str(info.get("team") or ""),
        "points": round(pts, 2),
    }


def _bench_summary(
    row: dict[str, Any],
    raw_players: dict[str, Any],
) -> dict[str, Any] | None:
    """Best bench score + bench total from the matchup row (players − starters)."""
    all_ids = [str(pid) for pid in (row.get("players") or [])]
    starter_ids = {str(pid) for pid in (row.get("starters") or [])}
    bench_ids = [pid for pid in all_ids if pid and pid not in starter_ids]
    if not bench_ids:
        return None
    players_points = row.get("players_points") or {}
    total = 0.0
    top_id = ""
    top_points = float("-inf")
    for pid in bench_ids:
        pts = _points_for(pid, players_points)
        total += pts
        if pts > top_points:
            top_points = pts
            top_id = pid
    top_info = raw_players.get(top_id) or {}
    return {
        "points": round(total, 2),
        "count": len(bench_ids),
        "top_name": _player_display_name(top_id, top_info),
        "top_points": round(top_points, 2) if top_points != float("-inf") else 0.0,
    }


def _hub_roster_lookups(hub_teams: list[dict[str, Any]] | None) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    labels: dict[str, str] = {}
    owners: dict[str, str] = {}
    hub_ids: dict[str, str] = {}
    for team in hub_teams or []:
        keys: list[str] = []
        rid = str(team.get("sleeper_roster_id") or "")
        tid = str(team.get("id") or "")
        if rid:
            keys.append(rid)
        if tid and tid not in keys:
            keys.append(tid)
        if not keys:
            continue
        label = (
            team.get("name") or team.get("team_name") or team.get("sleeper_team_name") or "Team"
        )
        owner = str(team.get("owner_name") or "").strip()
        hid = tid or None
        for key in keys:
            labels[key] = label
            if owner:
                owners[key] = owner
            if hid:
                hub_ids[key] = hid
    return labels, owners, hub_ids


def _team_from_matchup_row(
    row: dict[str, Any],
    *,
    roster_to_label: dict[str, str],
    roster_to_hub_id: dict[str, str] | None = None,
    roster_to_owner: dict[str, str] | None = None,
    raw_players: dict[str, Any],
    viewer_roster_id: str | None,
) -> dict[str, Any]:
    rid = str(row.get("roster_id") or "")
    starters = row.get("starters") or []
    players_points = row.get("players_points") or {}
    starter_rows = [
        _enrich_starter(sid, players_points, raw_players) for sid in starters
    ]
    viewer_rid = str(viewer_roster_id or "")
    return {
        "roster_id": rid,
        "hub_team_id": (roster_to_hub_id or {}).get(rid),
        "team_name": roster_to_label.get(rid) or f"Roster {rid}",
        "owner_name": (roster_to_owner or {}).get(rid),
        "points": round(float(row.get("points") or 0), 2),
        "starters": starter_rows,
        "bench": _bench_summary(row, raw_players),
        "is_viewer": bool(viewer_rid and rid == viewer_rid),
        "is_opponent": False,
    }


WIN_PROB_SCALE = 13.0
_HIDDEN_SLOTS = {"BN", "IR", "TAXI"}


def starting_slots(roster_positions: list[Any] | None) -> list[str]:
    """League lineup slots in order, without bench/IR (labels the starter duel)."""
    out: list[str] = []
    for slot in roster_positions or []:
        label = str(slot or "").strip().upper()
        if not label or label in _HIDDEN_SLOTS:
            continue
        out.append("FLEX" if label in {"WRRB_FLEX", "REC_FLEX", "SUPER_FLEX"} else label)
    return out


def _load_projection_lookup(season: Any, week: int) -> dict[str, dict[str, Any]]:
    """player_id → weekly projection fields from materialized artifacts only."""
    try:
        from src.draft_hub.weekly_command_center import _load_projection_index

        index, _meta = _load_projection_index(
            int(season), int(week), apply_injury_adjustments=True
        )
        return index
    except Exception:
        return {}


def estimate_team_final(team: dict[str, Any]) -> dict[str, Any]:
    """Attach per-starter proj (when known) plus proj_total / pending / est_final.

    A starter with 0.0 points is treated as not having played yet, so their
    projection still counts toward the estimated final. Mid-game zeros make
    this an estimate — the UI labels it as one.
    """
    proj_total = 0.0
    pending = 0.0
    any_proj = False
    for starter in team.get("starters") or []:
        proj = starter.get("proj")
        if proj is None:
            continue
        any_proj = True
        proj_total += float(proj)
        if float(starter.get("points") or 0) == 0.0:
            pending += float(proj)
    points = float(team.get("points") or 0)
    team["proj_total"] = round(proj_total, 1) if any_proj else None
    team["points_pending"] = round(pending, 1) if any_proj else 0.0
    team["est_final"] = round(points + pending, 1)
    return team


def win_probability(team_a: dict[str, Any], team_b: dict[str, Any]) -> float:
    """P(team_a beats team_b) from estimated finals. Logistic on the margin,
    clamped while points are still pending; hard 0/1 once nothing is left."""
    est_a = float(team_a.get("est_final") or team_a.get("points") or 0)
    est_b = float(team_b.get("est_final") or team_b.get("points") or 0)
    pending = float(team_a.get("points_pending") or 0) + float(team_b.get("points_pending") or 0)
    played = float(team_a.get("points") or 0) > 0 or float(team_b.get("points") or 0) > 0
    margin = est_a - est_b
    if pending <= 0 and played:
        if margin > 0:
            return 1.0
        if margin < 0:
            return 0.0
        return 0.5
    prob = 1.0 / (1.0 + math.exp(-margin / WIN_PROB_SCALE))
    return round(min(0.98, max(0.02, prob)), 3)


def attach_matchup_analytics(
    matchup_payloads: list[dict[str, Any]],
    proj_index: dict[str, dict[str, Any]] | None,
) -> None:
    """Per-starter projections, estimated finals, and win probability per matchup."""
    index = proj_index or {}
    for matchup in matchup_payloads:
        teams = matchup.get("teams") or []
        for team in teams:
            for starter in team.get("starters") or []:
                entry = (
                    index.get(str(starter.get("player_id") or ""))
                    or index.get(str(starter.get("sleeper_player_id") or ""))
                )
                starter["proj"] = entry.get("p50") if entry else None
            estimate_team_final(team)
        if len(teams) == 2:
            prob_a = win_probability(teams[0], teams[1])
            matchup["win_prob_by_roster"] = {
                str(teams[0].get("roster_id")): prob_a,
                str(teams[1].get("roster_id")): round(1 - prob_a, 3),
            }
        else:
            matchup["win_prob_by_roster"] = {}


def standings_have_results(rows: list[dict[str, Any]] | None) -> bool:
    """True when any team has a decided game or scored points."""
    for row in rows or []:
        games = int(row.get("wins") or 0) + int(row.get("losses") or 0) + int(row.get("ties") or 0)
        if games > 0 or float(row.get("points_for") or 0) > 0:
            return True
    return False


def sleeper_week_is_historical(
    league: dict[str, Any] | None,
    nfl_state: dict[str, Any] | None,
    *,
    hub_pre_draft: bool = False,
    payload: dict[str, Any] | None = None,
) -> bool:
    """True when Sleeper's week is last season, or the hub league has not drafted."""
    if hub_pre_draft:
        return True
    src = league or payload or {}
    sleeper_season = str(src.get("season") or "")
    nfl_season = str((nfl_state or {}).get("season") or "")
    return bool(sleeper_season and nfl_season and sleeper_season != nfl_season)


def historical_placeholder_reason(*, hub_pre_draft: bool = False) -> str:
    return "pre_draft" if hub_pre_draft else "prior_season"


def assign_standings_ranks(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Number 1–N only after a game exists. Unplayed slates stay unranked."""
    ranked = [dict(row) for row in rows]
    if standings_have_results(ranked):
        for index, row in enumerate(ranked, start=1):
            row["rank"] = index
    else:
        for row in ranked:
            row["rank"] = None
    return ranked


def _fetch_standings(
    sleeper_league_id: str,
    roster_to_label: dict[str, str],
    roster_to_hub_id: dict[str, str] | None = None,
    roster_to_owner: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """League records from Sleeper rosters (wins/losses/points-for), ranked."""
    try:
        rosters = _fetch_json(f"{SLEEPER_API}/league/{sleeper_league_id}/rosters")
    except Exception:
        return []
    if not isinstance(rosters, list):
        return []
    rows: list[dict[str, Any]] = []
    for roster in rosters:
        if not isinstance(roster, dict):
            continue
        rid = str(roster.get("roster_id") or "")
        settings = roster.get("settings") or {}
        fpts = float(settings.get("fpts") or 0) + float(settings.get("fpts_decimal") or 0) / 100
        rows.append(
            {
                "roster_id": rid,
                "hub_team_id": (roster_to_hub_id or {}).get(rid),
                "team_name": roster_to_label.get(rid) or f"Roster {rid}",
                "owner_name": (roster_to_owner or {}).get(rid),
                "wins": int(settings.get("wins") or 0),
                "losses": int(settings.get("losses") or 0),
                "ties": int(settings.get("ties") or 0),
                "points_for": round(fpts, 2),
            }
        )
    rows.sort(key=lambda r: (-r["wins"], -r["points_for"]))
    return assign_standings_ranks(rows)


def build_sleeper_live_week(
    sleeper_league_id: str,
    week: int,
    *,
    hub_teams: list[dict[str, Any]] | None = None,
    viewer_roster_id: str | None = None,
    viewer_team_id: str | None = None,
    nfl_state: dict[str, Any] | None = None,
    slot_labels: list[str] | None = None,
    hub_pre_draft: bool = False,
) -> dict[str, Any]:
    """Fetch one week of Sleeper matchups with starter-level points."""
    if not sleeper_league_id:
        return {
            "available": False,
            "reason": "no_sleeper_league",
            "hint": "Link your Sleeper league on Setup or All teams to see live scoring.",
        }

    state = nfl_state or get_nfl_state(use_cache=True)
    season_type = str(state.get("season_type") or "regular")
    synced_at = _utcnow_iso()

    try:
        league = _fetch_json(f"{SLEEPER_API}/league/{sleeper_league_id}")
    except Exception as exc:
        return {
            "available": False,
            "reason": "fetch_failed",
            "error": str(exc),
            "hint": "Could not reach Sleeper — try again in a moment.",
            "synced_at": synced_at,
        }

    season = str(league.get("season") or state.get("season") or "")
    status = str(league.get("status") or "")
    preseason = status in ("pre_draft", "drafting") or season_type == "pre"
    week_meta = week_picker_meta(state, league)

    roster_to_label, roster_to_owner, roster_to_hub_id = _hub_roster_lookups(hub_teams)

    def _empty_week(reason: str = "no_matchups") -> dict[str, Any]:
        slots = slot_labels or starting_slots(league.get("roster_positions")) or list(
            DEFAULT_STARTING_SLOTS
        )
        last_season = _fetch_standings(
            str(sleeper_league_id),
            roster_to_label,
            roster_to_hub_id,
            roster_to_owner,
        )
        payload = build_hub_placeholder_week(
            hub_teams,
            viewer_team_id=viewer_team_id,
            week=int(week),
            nfl_state=state,
            starting_slots=slots,
            reason=reason,
            season=season,
            standings=last_season or None,
        )
        payload["status"] = status
        payload.update(week_meta)
        return payload

    if sleeper_week_is_historical(league, state, hub_pre_draft=hub_pre_draft):
        return _empty_week(historical_placeholder_reason(hub_pre_draft=hub_pre_draft))

    try:
        matchups = _fetch_json(
            f"{SLEEPER_API}/league/{sleeper_league_id}/matchups/{int(week)}"
        )
    except Exception as exc:
        return {
            "available": False,
            "reason": "fetch_failed",
            "error": str(exc),
            "season": season,
            "week": int(week),
            "hint": "Could not load matchups from Sleeper.",
            "synced_at": synced_at,
            **week_meta,
        }

    if not matchups:
        return _empty_week()

    raw_players = load_sleeper_players()
    by_matchup: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in matchups:
        mid = row.get("matchup_id")
        if mid is None:
            continue
        by_matchup[str(mid)].append(row)

    if not by_matchup:
        return _empty_week()

    viewer_rid = str(viewer_roster_id or "")
    viewer_matchup_id: str | None = None
    matchup_payloads: list[dict[str, Any]] = []

    for mid, rows in by_matchup.items():
        teams = [
            _team_from_matchup_row(
                row,
                roster_to_label=roster_to_label,
                roster_to_hub_id=roster_to_hub_id,
                roster_to_owner=roster_to_owner,
                raw_players=raw_players,
                viewer_roster_id=viewer_roster_id,
            )
            for row in rows
        ]
        if viewer_rid and any(t["roster_id"] == viewer_rid for t in teams):
            viewer_matchup_id = mid
            for t in teams:
                if t["roster_id"] != viewer_rid:
                    t["is_opponent"] = True
        teams.sort(key=lambda t: -t["points"])
        matchup_payloads.append({"matchup_id": mid, "teams": teams})

    matchup_payloads.sort(
        key=lambda m: (
            0 if str(m["matchup_id"]) == str(viewer_matchup_id or "") else 1,
            -sum(t["points"] for t in m["teams"]),
        )
    )

    # Game center analytics: starter projections from materialized weekly
    # artifacts (never live compute), estimated finals, and win probability.
    attach_matchup_analytics(matchup_payloads, _load_projection_lookup(season, int(week)))

    has_points = any(t["points"] > 0 for m in matchup_payloads for t in m["teams"])
    if preseason or (not has_points and status in ("pre_draft", "drafting")):
        preseason = True

    return {
        "available": True,
        "season": season,
        "week": int(week),
        "season_type": season_type,
        "preseason": preseason,
        "status": status,
        "viewer_matchup_id": viewer_matchup_id,
        "matchups": matchup_payloads,
        "starting_slots": starting_slots(league.get("roster_positions")),
        "standings": _fetch_standings(
            str(sleeper_league_id),
            roster_to_label,
            roster_to_hub_id,
            roster_to_owner,
        ),
        "standings_season": (
            "last"
            if (
                preseason
                or status in ("pre_draft", "drafting")
                or (not has_points and int(week) <= 1)
            )
            else "current"
        ),
        "hint": (
            "Season not started — scores update after Week 1."
            if preseason and not has_points
            else None
        ),
        "synced_at": synced_at,
        **week_meta,
    }


DEFAULT_STARTING_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"]
PLACEHOLDER_HINTS = {
    "no_sleeper_league": "Link Sleeper to fill scores.",
    "no_matchups": "No scored matchups yet. Scores fill in after kickoff.",
    "pre_draft": "",
    "prior_season": "",
}


def starting_slots_from_rules(rules: Any) -> list[str]:
    """Hub league roster rules → Game center slot labels. Falls back to a standard lineup."""
    raw = rules
    if isinstance(raw, dict):
        try:
            from src.draft_hub.schemas import LeagueRules

            raw = LeagueRules.model_validate(raw)
        except Exception:
            raw = None
    if raw is None:
        return list(DEFAULT_STARTING_SLOTS)
    from src.draft_hub.rules_engine import roster_limits

    limits = roster_limits(raw)
    labels = {"qb": "QB", "rb": "RB", "wr": "WR", "te": "TE", "k": "K", "def": "DEF"}
    out: list[str] = []
    for key in ("qb", "rb", "wr", "te"):
        count = int((limits.get(key) or {}).get("starter") or 0)
        out.extend([labels[key]] * count)
    flex = (getattr(raw, "roster", None) or {}).get("flex") or {}
    flex_n = int(flex.get("starter") or 0) if isinstance(flex, dict) else 0
    out.extend(["FLEX"] * flex_n)
    for key in ("k", "def"):
        count = int((limits.get(key) or {}).get("starter") or 0)
        out.extend([labels[key]] * count)
    return out or list(DEFAULT_STARTING_SLOTS)


def pair_placeholder_teams(
    teams: list[dict[str, Any]],
    week: int,
) -> list[tuple[dict[str, Any], dict[str, Any] | None]]:
    """Stable weekly pairing from hub teams. Odd team (or a solo league) gets no opponent."""
    ordered = sorted(
        [row for row in teams if str(row.get("id") or "").strip()],
        key=lambda row: (str(row.get("name") or "").lower(), str(row.get("id") or "")),
    )
    if not ordered:
        return []
    if len(ordered) == 1:
        return [(ordered[0], None)]
    shift = (max(1, int(week)) - 1) % len(ordered)
    rotated = ordered[shift:] + ordered[:shift]
    leftover = rotated.pop() if len(rotated) % 2 else None
    pairs = [(rotated[i], rotated[i + 1]) for i in range(0, len(rotated), 2)]
    if leftover is not None:
        pairs.append((leftover, None))
    return pairs


def _placeholder_team(
    team: dict[str, Any] | None,
    *,
    is_viewer: bool = False,
    is_opponent: bool = False,
) -> dict[str, Any]:
    if not team:
        return {
            "roster_id": "tbd",
            "hub_team_id": None,
            "team_name": "Opponent TBD",
            "owner_name": None,
            "points": 0.0,
            "starters": [],
            "bench": None,
            "is_viewer": False,
            "is_opponent": True,
            "proj_total": None,
            "points_pending": None,
            "est_final": None,
        }
    tid = str(team.get("id") or "")
    owner = str(team.get("owner_name") or "").strip() or None
    return {
        "roster_id": tid,
        "hub_team_id": tid,
        "team_name": team.get("name") or team.get("sleeper_team_name") or "Team",
        "owner_name": owner,
        "points": 0.0,
        "starters": [],
        "bench": None,
        "is_viewer": is_viewer,
        "is_opponent": is_opponent,
        "proj_total": None,
        "points_pending": None,
        "est_final": None,
    }


def build_hub_placeholder_week(
    hub_teams: list[dict[str, Any]] | None,
    *,
    viewer_team_id: str | None = None,
    week: int = 1,
    nfl_state: dict[str, Any] | None = None,
    starting_slots: list[str] | None = None,
    reason: str = "no_sleeper_league",
    season: str | None = None,
    standings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Fill Game center / Home widgets from hub teams when Sleeper has nothing yet."""
    state = nfl_state or {}
    week_n = max(1, int(week or state.get("week") or 1))
    viewer = str(viewer_team_id or "")
    teams = list(hub_teams or [])
    pairs = pair_placeholder_teams(teams, week_n)
    matchups: list[dict[str, Any]] = []
    viewer_matchup_id: str | None = None
    for index, (home, away) in enumerate(pairs, start=1):
        mid = f"hub-{index}"
        home_is_viewer = bool(viewer and str(home.get("id") or "") == viewer)
        away_is_viewer = bool(away and viewer and str(away.get("id") or "") == viewer)
        sides = [
            _placeholder_team(home, is_viewer=home_is_viewer, is_opponent=away_is_viewer),
            _placeholder_team(away, is_viewer=away_is_viewer, is_opponent=home_is_viewer or not away),
        ]
        if home_is_viewer or away_is_viewer:
            viewer_matchup_id = mid
        matchups.append({"matchup_id": mid, "teams": sides, "win_prob_by_roster": {}})

    named = sorted(
        [row for row in teams if str(row.get("id") or "").strip()],
        key=lambda row: (str(row.get("name") or "").lower(), str(row.get("id") or "")),
    )
    fallback: list[dict[str, Any]] = []
    for row in named:
        tid = str(row.get("id") or "")
        fallback.append(
            {
                "roster_id": tid,
                "hub_team_id": tid,
                "team_name": row.get("name") or row.get("sleeper_team_name") or "Team",
                "owner_name": str(row.get("owner_name") or "").strip() or None,
                "wins": 0,
                "losses": 0,
                "ties": 0,
                "points_for": 0.0,
                "rank": None,
            }
        )
    resolved = standings if standings_have_results(standings) else fallback
    resolved = assign_standings_ranks(resolved)

    return {
        "available": True,
        "placeholder": True,
        "reason": reason,
        "hint": PLACEHOLDER_HINTS.get(reason, PLACEHOLDER_HINTS["no_sleeper_league"]),
        "season": str(season or state.get("season") or ""),
        "week": week_n,
        "season_type": str(state.get("season_type") or "regular"),
        "preseason": True,
        "standings_season": "last" if standings_have_results(resolved) else "none",
        "viewer_matchup_id": viewer_matchup_id,
        "matchups": matchups,
        "starting_slots": list(starting_slots or DEFAULT_STARTING_SLOTS),
        "standings": resolved,
        "synced_at": _utcnow_iso(),
        **week_picker_meta(state),
    }


def _hold_historical_week(
    payload: dict[str, Any],
    *,
    hub_teams: list[dict[str, Any]] | None,
    viewer_team_id: str | None,
    viewer_roster_id: str | None,
    week: int,
    nfl_state: dict[str, Any],
    slots: list[str],
    hub_pre_draft: bool,
) -> dict[str, Any]:
    """Replace a prior-season or pre-draft Sleeper week with last-season standings."""
    if payload.get("placeholder"):
        return _apply_live_viewer(
            payload,
            viewer_team_id=viewer_team_id,
            viewer_roster_id=viewer_roster_id,
        )
    if not sleeper_week_is_historical(
        None,
        nfl_state,
        hub_pre_draft=hub_pre_draft,
        payload=payload,
    ):
        return _apply_live_viewer(
            payload,
            viewer_team_id=viewer_team_id,
            viewer_roster_id=viewer_roster_id,
        )
    overlay = build_hub_placeholder_week(
        hub_teams,
        viewer_team_id=viewer_team_id,
        week=week,
        nfl_state=nfl_state,
        starting_slots=slots,
        reason=historical_placeholder_reason(hub_pre_draft=hub_pre_draft),
        season=payload.get("season"),
        standings=payload.get("standings"),
    )
    overlay["cached"] = bool(payload.get("cached"))
    overlay["synced_at"] = payload.get("synced_at") or overlay["synced_at"]
    overlay["status"] = payload.get("status")
    return _apply_live_viewer(
        overlay,
        viewer_team_id=viewer_team_id,
        viewer_roster_id=viewer_roster_id,
    )


def get_sleeper_live_week(
    sleeper_league_id: str,
    *,
    hub_teams: list[dict[str, Any]] | None = None,
    week: int | None = None,
    viewer_roster_id: str | None = None,
    viewer_team_id: str | None = None,
    rules: Any = None,
    starting_slots: list[str] | None = None,
    refresh: bool = False,
    hub_pre_draft: bool = False,
) -> dict[str, Any]:
    """Read-through cache for live week scoring (60s TTL unless refresh)."""
    resolved_week, nfl_state = resolve_current_week(week_override=week)
    slots = starting_slots or starting_slots_from_rules(rules)
    lid = str(sleeper_league_id or "").strip()
    if not lid:
        payload = build_hub_placeholder_week(
            hub_teams,
            viewer_team_id=viewer_team_id,
            week=resolved_week,
            nfl_state=nfl_state,
            starting_slots=slots,
            reason="no_sleeper_league",
        )
        payload["cached"] = False
        return payload

    cache_key_week = int(resolved_week)

    if not refresh:
        cached = storage.get_sleeper_live_scoring_cache(lid, cache_key_week)
        if cached and _live_cache_is_fresh(cached["synced_at"]):
            payload = {**cached["payload"], "synced_at": cached["synced_at"], "cached": True}
            if hub_teams:
                payload = _attach_hub_team_names(payload, hub_teams)
            payload = {**payload, **week_picker_meta(nfl_state)}
            if payload.get("available") and not (payload.get("matchups") or []) and not payload.get(
                "placeholder"
            ):
                overlay = build_hub_placeholder_week(
                    hub_teams,
                    viewer_team_id=viewer_team_id,
                    week=cache_key_week,
                    nfl_state=nfl_state,
                    starting_slots=slots,
                    reason="no_matchups",
                    season=payload.get("season"),
                    standings=payload.get("standings"),
                )
                overlay["cached"] = True
                overlay["synced_at"] = payload.get("synced_at") or overlay["synced_at"]
                return overlay
            return _hold_historical_week(
                payload,
                hub_teams=hub_teams,
                viewer_team_id=viewer_team_id,
                viewer_roster_id=viewer_roster_id,
                week=cache_key_week,
                nfl_state=nfl_state,
                slots=slots,
                hub_pre_draft=hub_pre_draft,
            )

    payload = build_sleeper_live_week(
        lid,
        cache_key_week,
        hub_teams=hub_teams,
        viewer_roster_id=viewer_roster_id,
        viewer_team_id=viewer_team_id,
        nfl_state=nfl_state,
        slot_labels=slots,
        hub_pre_draft=hub_pre_draft,
    )
    if payload.get("available"):
        storage.upsert_sleeper_live_scoring_cache(
            lid,
            cache_key_week,
            _shared_live_cache_payload(payload),
        )
    payload["cached"] = False
    if "current_week" not in payload:
        payload = {**payload, **week_picker_meta(nfl_state)}
    return payload


def refresh_sleeper_live_scoring_cache(
    sleeper_league_id: str,
    *,
    hub_teams: list[dict[str, Any]] | None = None,
    week: int | None = None,
    viewer_roster_id: str | None = None,
    viewer_team_id: str | None = None,
    hub_pre_draft: bool = False,
) -> dict[str, Any]:
    """Force live fetch and persist (used on Sleeper sync)."""
    return get_sleeper_live_week(
        sleeper_league_id,
        hub_teams=hub_teams,
        week=week,
        viewer_roster_id=viewer_roster_id,
        viewer_team_id=viewer_team_id,
        refresh=True,
        hub_pre_draft=hub_pre_draft,
    )


def _team_is_viewer(
    team: dict[str, Any],
    viewer_team_id: str,
    viewer_roster_id: str,
) -> bool:
    if viewer_roster_id and str(team.get("roster_id") or "") == viewer_roster_id:
        return True
    if viewer_team_id:
        if str(team.get("hub_team_id") or "") == viewer_team_id:
            return True
        if str(team.get("roster_id") or "") == viewer_team_id:
            return True
    return False


def _apply_live_viewer(
    payload: dict[str, Any],
    *,
    viewer_team_id: str | None = None,
    viewer_roster_id: str | None = None,
) -> dict[str, Any]:
    """Stamp the current request's viewer onto a league-wide scoring payload."""
    viewer_tid = str(viewer_team_id or "")
    viewer_rid = str(viewer_roster_id or "")
    viewer_matchup_id: str | None = None
    matchups: list[dict[str, Any]] = []
    for matchup in payload.get("matchups") or []:
        teams = list(matchup.get("teams") or [])
        hit = any(_team_is_viewer(team, viewer_tid, viewer_rid) for team in teams)
        if hit:
            viewer_matchup_id = matchup.get("matchup_id")
        relabeled: list[dict[str, Any]] = []
        for team in teams:
            is_viewer = _team_is_viewer(team, viewer_tid, viewer_rid)
            is_tbd = str(team.get("roster_id") or "") == "tbd"
            relabeled.append({
                **team,
                "is_viewer": is_viewer,
                "is_opponent": (hit and not is_viewer) or is_tbd,
            })
        matchups.append({**matchup, "teams": relabeled})
    return {**payload, "matchups": matchups, "viewer_matchup_id": viewer_matchup_id}


def _shared_live_cache_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Drop per-viewer assignment before writing the league-wide cache."""
    return _apply_live_viewer(payload)


def _attach_hub_team_names(payload: dict[str, Any], hub_teams: list[dict[str, Any]]) -> dict[str, Any]:
    roster_to_label, roster_to_owner, roster_to_hub_id = _hub_roster_lookups(hub_teams)
    if not roster_to_label:
        return payload

    def _relabel(entry: dict[str, Any]) -> dict[str, Any]:
        rid = str(entry.get("roster_id") or "")
        hid = str(entry.get("hub_team_id") or "")
        key = rid if rid in roster_to_label or rid in roster_to_owner else hid
        return {
            **entry,
            "team_name": roster_to_label.get(key) or roster_to_label.get(hid) or entry.get("team_name"),
            "owner_name": roster_to_owner.get(key) or roster_to_owner.get(hid) or entry.get("owner_name"),
            "hub_team_id": entry.get("hub_team_id") or roster_to_hub_id.get(key) or roster_to_hub_id.get(hid),
        }

    out = {**payload}
    out["matchups"] = [
        {**m, "teams": [_relabel(team) for team in m.get("teams") or []]}
        for m in out.get("matchups") or []
    ]
    out["standings"] = [_relabel(row) for row in out.get("standings") or []]
    return out
