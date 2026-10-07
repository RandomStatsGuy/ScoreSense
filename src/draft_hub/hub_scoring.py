"""Native weekly lineups, schedule, configurable scoring, and standings.

ScoreSense-only leagues persist start/sit here and score weeks from nflverse
box scores using their saved ``ScoringRules``. Linked Sleeper leagues keep using
Sleeper as the scoring host.
"""

from __future__ import annotations

import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import pandas as pd

from src.config import FANTASY_SCORING
from src.core.features import calc_fantasy_points_ppr
from src.core.team_codes import normalize_team_to_mlready, normalize_team_for_match
from src.draft_hub import storage
from src.draft_hub.native_lineup_identity import trusted_lineup_row
from src.draft_hub.league_capabilities import uses_salaries
from src.draft_hub.league_live_scoring import (
    attach_matchup_analytics,
    pair_placeholder_teams,
    starting_slots_from_rules,
    week_picker_meta,
)
from src.draft_hub.roster_identity_match import is_gsis_player_id, name_pos_key
from src.draft_hub.rules_engine import normalize_position, roster_limits
from src.draft_hub.schemas import LeagueRules, ScoringRules

_STAT_INDEX_CACHE: dict[tuple[int, int], tuple[float, dict[str, dict[str, Any]]]] = {}
_STAT_INDEX_TTL_S = 60.0

ACTIVE_ROSTER = "active"
NATIVE_STAT_FIELDS = frozenset(ScoringRules.model_fields) | {"def_points_allowed"}
KICKER_STAT_FIELDS = frozenset(key for key in NATIVE_STAT_FIELDS if key.startswith(("fg_", "pat_")))
DEFENSE_STAT_FIELDS = frozenset(key for key in NATIVE_STAT_FIELDS if key.startswith("def_"))


class LineupError(ValueError):
    """User-facing lineup validation / lock failure."""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def sleeper_hosts_scoring(league: dict[str, Any] | None, ctx: dict[str, Any] | None = None) -> bool:
    """True when Sleeper is the lineup/scoring host for this league."""
    if league and league.get("sleeper_league_id"):
        return True
    if ctx and ctx.get("sleeper_league_id"):
        return True
    return False


def _league_rules(league: dict[str, Any]) -> LeagueRules:
    raw = league.get("rules")
    if isinstance(raw, LeagueRules):
        return raw
    return LeagueRules.model_validate(raw or {})


def _active_roster(workspace_id: str, team_id: str) -> list[dict[str, Any]]:
    rows = storage.list_roster(workspace_id, team_id)
    return [
        row
        for row in rows
        if str(row.get("roster_status") or ACTIVE_ROSTER) == ACTIVE_ROSTER
        and str(row.get("player_id") or "").strip()
    ]


def _roster_card(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "player_id": str(row["player_id"]),
        "player_name": row.get("player_name") or "",
        "team": row.get("team") or "",
        "nfl_team": row.get("team") or "",
        "position": normalize_position(row.get("position")),
        "salary": row.get("salary"),
        "sleeper_player_id": row.get("sleeper_player_id"),
    }


def _entry_from_card(card: dict[str, Any], *, locked: bool = False) -> dict[str, Any]:
    return {
        "player_id": str(card["player_id"]),
        "slot": str(card.get("slot") or "BN"),
        "lineup_role": str(card.get("lineup_role") or "bench"),
        "player_name": card.get("player_name") or "",
        "nfl_team": card.get("nfl_team") or card.get("team") or "",
        "position": normalize_position(card.get("position")),
        "locked": bool(locked or card.get("lineup_locked") or card.get("locked")),
    }


def schedule_week_count(rules: LeagueRules) -> int:
    return max(1, int(getattr(rules, "regular_season_games", None) or 14))


def ensure_season_schedule(
    league_id: str,
    *,
    season: int | None = None,
    rules: LeagueRules | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Persist round-robin games while preserving recorded and started weeks."""
    from src.draft_hub.native_schedule import round_robin_pairs, ensure_playoff_matchups
    league = storage.get_league(league_id)
    if not league:
        raise LineupError("League not found")
    season_n = int(season or league.get("season") or 2026)
    if not isinstance(rules, LeagueRules):
        rules = LeagueRules.model_validate(rules) if rules else _league_rules(league)
    teams = storage.list_league_teams(league_id)
    weeks = schedule_week_count(rules)
    existing = storage.list_season_matchups(league_id, season_n)
    by_week: dict[int, list[dict[str, Any]]] = {}
    for row in existing:
        by_week.setdefault(int(row["week"]), []).append(row)

    created = 0
    for week in range(1, weeks + 1):
        prior = by_week.get(week)
        pairs = round_robin_pairs(teams, week)
        payload = []
        for index, (home, away) in enumerate(pairs, start=1):
            payload.append(
                {
                    "matchup_id": f"hub-{week}-{index}",
                    "home_team_id": str(home["id"]),
                    "away_team_id": str(away["id"]) if away else None,
                }
            )
        prior_pairs = {(row["home_team_id"], row.get("away_team_id")) for row in prior or []}
        if prior_pairs == {(row["home_team_id"], row.get("away_team_id")) for row in payload} and not force:
            continue
        if prior:
            if storage.get_week_scoring_run(league_id, season_n, week):
                continue
            from src.draft_hub.game_center import cached_game_states
            states = cached_game_states(season_n, week, now=_utcnow())
            # Old schedules can be rebuilt only when every game is confirmed
            # upcoming. Missing schedule data must never rewrite history.
            if not states or any(game.get("game_state") != "pregame" for game in states.values()):
                continue
        storage.replace_week_matchups(league_id, season_n, week, payload)
        created += 1
    bracket = ensure_playoff_matchups(league_id, season_n, rules, build_hub_standings(league_id, season_n))
    return {
        "league_id": league_id,
        "season": season_n,
        "weeks": weeks,
        "teams": len(teams),
        "weeks_written": created,
        "matchups": storage.list_season_matchups(league_id, season_n),
        "playoffs": bracket,
    }


def nfl_game_started(
    nfl_team: str,
    season: int,
    week: int,
    *,
    now: datetime | None = None,
) -> bool | None:
    """Kickoff status; None means the schedule cannot establish a safe edit."""
    team = normalize_team_for_match(str(nfl_team or "").strip().upper())
    if team in {"FA", "FREE_AGENT"}:
        return False
    if not team:
        return None
    stamp = now or _utcnow()
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    try:
        from src.draft_hub.native_stats import cached_week_snapshot, NFL_TEAMS
        snapshot = cached_week_snapshot(int(season), int(week))
        if snapshot:
            game = (snapshot.get("game_states") or {}).get(team)
            if game:
                kickoff = game.get("kickoff_at")
                if kickoff:
                    return pd.Timestamp(stamp) >= pd.Timestamp(kickoff)
                if game.get("game_state") in {"live", "final"}:
                    return True
                return None
            if snapshot.get("schedule_complete") and team in NFL_TEAMS:
                return False
    except (OSError, ValueError, TypeError):
        pass
    try:
        from src.core.schedule_utils import team_game_kickoffs

        games = team_game_kickoffs(int(season), team, allow_fetch=False)
    except Exception:
        return None
    if games is None or getattr(games, "empty", True):
        return None
    week_n = int(week)
    if "week" not in games:
        return None
    if "season" in games:
        games = games[pd.to_numeric(games["season"], errors="coerce") == int(season)]
    if games.empty:
        return None
    schedule_weeks = pd.to_numeric(games["week"], errors="coerce")
    row = games[schedule_weeks == week_n]
    if row.empty:
        # Only a full regular-season team schedule establishes a genuine bye.
        return False if schedule_weeks.nunique() >= 17 else None
    raw = row.iloc[0]
    # A calendar date is not a trustworthy kickoff time.
    kick_val = raw.get("kickoff")
    kick = pd.Timestamp(kick_val)
    if pd.isna(kick):
        return None
    if kick.tzinfo is None:
        kick = kick.tz_localize("UTC")
    else:
        kick = kick.tz_convert("UTC")
    return stamp >= kick


def nfl_week_started(season: int, week: int, *, now: datetime | None = None) -> bool | None:
    """Whether any game has kicked off; unknown schedule is not an upcoming week.

    This is a saved-schedule read only. HTTP status checks never fetch schedules.
    """
    try:
        from src.core.schedule_utils import week_first_kickoff_et
        first = week_first_kickoff_et(int(season), int(week), allow_fetch=False)
    except Exception:
        return None
    if first is None:
        return None
    stamp = now or _utcnow()
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp >= first.astimezone(timezone.utc)


def nfl_week_slate_complete(
    season: int,
    week: int,
    *,
    now: datetime | None = None,
) -> bool:
    """Only confirmed provider or saved schedule results establish completion."""
    try:
        clock = pd.Timestamp(now or _utcnow())
        from src.draft_hub.native_stats import cached_week_snapshot
        snapshot = cached_week_snapshot(int(season), int(week))
        if snapshot is not None:
            states = snapshot.get("game_states") or {}
            return bool(snapshot.get("complete")) and not any(
                game.get("kickoff_at") and pd.Timestamp(game["kickoff_at"]) > clock for game in states.values())
        from src.draft_hub.game_center import cached_game_states
        states = cached_game_states(int(season), int(week), now=now or _utcnow())
        return bool(states) and all(game.get("game_state") == "final" for game in states.values()) and not any(
            game.get("kickoff_at") and pd.Timestamp(game["kickoff_at"]) > clock for game in states.values())
    except Exception:
        return False


def _lineup_row_locked(
    row: dict[str, Any],
    season: int,
    week: int,
    *,
    now: datetime | None = None,
    game_started: Callable[[str], bool] | None = None,
) -> bool:
    if row.get("locked"):
        return True
    if game_started is not None:
        return bool(game_started(str(row.get("nfl_team") or row.get("team") or "")))
    trusted = trusted_lineup_row(row, season, week)
    if trusted is None:
        return True
    team = trusted["nfl_team"]
    return nfl_game_started(team, season, week, now=now) is not False


def _flex_eligible(rules: LeagueRules) -> frozenset[str]:
    raw = (rules.roster or {}).get("flex") or {}
    if not isinstance(raw, dict):
        return frozenset({"RB", "WR", "TE"})
    eligible = raw.get("eligible") or ["RB", "WR", "TE"]
    return frozenset(normalize_position(p) for p in eligible)


def _starter_capacity(rules: LeagueRules) -> dict[str, int]:
    out = {
        key.upper(): int(lim.get("starter") or 0)
        for key, lim in roster_limits(rules).items()
    }
    roster = rules.roster
    flex = getattr(roster, "flex", None) if hasattr(roster, "flex") else (roster or {}).get("flex")
    if flex:
        starter_val = getattr(flex, "starter", None) if hasattr(flex, "starter") else flex.get("starter")
        if starter_val is not None:
            out["FLEX"] = int(starter_val)
    return out


def slot_accepts_position(slot: str, position: str, rules: LeagueRules) -> bool:
    pos = normalize_position(position)
    label = str(slot or "").upper()
    base = label.rstrip("0123456789")
    if base == "BN":
        return True
    if base == "FLEX":
        return pos in _flex_eligible(rules)
    return base == pos


def _cards_from_roster(roster: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_roster_card(row) for row in roster]


def _persist_cards(
    league_id: str,
    team_id: str,
    season: int,
    week: int,
    starters: list[dict[str, Any]],
    bench: list[dict[str, Any]],
    *,
    locked: bool = False,
) -> list[dict[str, Any]]:
    entries = [_entry_from_card(card, locked=locked) for card in [*starters, *bench]]
    return storage.replace_team_lineup(league_id, team_id, season, week, entries)


def week_is_scored(league_id: str, season: int, week: int) -> bool:
    return bool(storage.get_week_scoring_run(league_id, season, week))


def week_is_final(league_id: str, season: int, week: int) -> bool:
    """True after a calculate that locked the completed NFL slate."""
    run = storage.get_week_scoring_run(league_id, season, week)
    return bool(run and run.get("final"))


def ensure_team_lineup(
    league_id: str,
    team_id: str,
    season: int,
    week: int,
    *,
    rules: LeagueRules | None = None,
    roster: list[dict[str, Any]] | None = None,
    game_started: Callable[[str], bool] | None = None,
    identity_snapshot: dict[str, Any] | None = None,
    fill_missing: bool = False,
) -> list[dict[str, Any]]:
    """Carry saved choices forward and preserve this week's started ownership."""
    league = storage.get_league(league_id)
    if not league:
        raise LineupError("League not found")
    if not isinstance(rules, LeagueRules):
        rules = LeagueRules.model_validate(rules) if rules else _league_rules(league)
    existing = storage.list_team_lineup(league_id, team_id, season, week)
    initialized = storage.has_team_lineup_snapshot(league_id, team_id, season, week)
    if _week_lineups_closed(league_id, season, week):
        return existing
    ws = storage.roster_workspace_for_league(league)
    roster = roster if roster is not None else _active_roster(ws, team_id)
    cards = {card["player_id"]: (card if game_started is not None else
             trusted_lineup_row(card, season, week, snapshot=identity_snapshot) or card)
             for card in _cards_from_roster(roster)}
    status_by_team: dict[str, bool | None] = {}

    def status(row):
        trusted = row if game_started is not None else trusted_lineup_row(row, season, week, snapshot=identity_snapshot)
        if trusted is None:
            return None
        team = str(trusted.get("nfl_team") or trusted.get("team") or "")
        if team not in status_by_team:
            status_by_team[team] = bool(game_started(team)) if game_started is not None else nfl_game_started(team, season, week)
        return status_by_team[team]

    if not initialized and cards:
        keys = [card.get("_canonical_player_key") or card["player_id"] for card in cards.values()]
        if len(set(keys)) != len(keys):
            # Legacy aliases require ownership review rather than two inferred
            # starter slots for the same real NFL player.
            return []
        if any(status(card) is not False for card in cards.values()):
            # A cold visit after kickoff or with an unavailable schedule cannot
            # establish this week's ownership from the current roster, even
            # when an older starting lineup is available to carry forward.
            return []
        prior = storage.list_latest_team_lineup(league_id, team_id, season, week)
        prior_week = storage.latest_team_lineup_snapshot_week(league_id, team_id, season, week)
        occupied: set[str] = set()
        if prior_week is not None:
            for row in prior:
                card = cards.get(str(row["player_id"]))
                if card is None:
                    continue
                role = str(row.get("lineup_role") or "bench")
                slot = "BN"
                if role == "starter":
                    try:
                        slot = canonical_starter_slot(row.get("slot"), rules)
                    except LineupError:
                        role = "bench"
                    if slot in occupied or not slot_accepts_position(slot, card["position"], rules):
                        role, slot = "bench", "BN"
                    else:
                        occupied.add(slot)
                existing.append(_entry_from_card({**card, "lineup_role": role, "slot": slot}))
        else:
            from src.draft_hub.weekly_command_center import infer_starters_and_bench
            if uses_salaries(rules):
                starters, bench = infer_starters_and_bench(list(cards.values()), rules)
            else:
                from src.draft_hub.weekly_command_center import projected_default_lineup
                starters, bench = projected_default_lineup(roster, rules, season=season, week=week)
                starters = [{**card, **cards.get(str(card['player_id']), {})} for card in starters]
                bench = [{**card, **cards.get(str(card['player_id']), {})} for card in bench]
                if not starters:
                    starters, bench = [], [{**card, 'lineup_role': 'bench', 'slot': 'BN'} for card in cards.values()]
            existing = [_entry_from_card(card) for card in [*starters, *bench]]

    next_rows = []
    used = set()
    for row in existing:
        pid = str(row["player_id"])
        state = status(row)
        locked = bool(row.get("locked")) or state is True
        # Unknown kickoff preserves the existing snapshot while edits fail safe;
        # it must not create a permanent lock if the schedule later recovers.
        if pid not in cards and not locked and state is not None:
            continue
        card = {**cards.get(pid, {}), **row} if locked or state is None else {**row, **cards[pid]}
        card["locked"] = locked
        next_rows.append(_entry_from_card(card))
        used.add(pid)
    for pid, card in cards.items():
        if pid not in used:
            next_rows.append(_entry_from_card({**card, "slot": "BN", "lineup_role": "bench"},
                                               locked=status(card) is True))
    if not initialized or next_rows != [_entry_from_card(row) for row in storage.list_team_lineup(league_id, team_id, season, week)]:
        return storage.replace_team_lineup(league_id, team_id, season, week, next_rows)
    return storage.list_team_lineup(league_id, team_id, season, week)


def apply_saved_lineup(
    players: list[dict[str, Any]],
    saved: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Overlay persisted slots onto enriched This Week player cards."""
    by_id = {str(p.get("player_id") or ""): dict(p) for p in players if p.get("player_id")}
    used: set[str] = set()
    starters: list[dict[str, Any]] = []
    bench: list[dict[str, Any]] = []
    for row in saved:
        pid = str(row.get("player_id") or "")
        card = by_id.get(pid)
        if not card:
            card = {**row, "team": row.get("nfl_team") or ""}
        out = dict(card)
        role = str(row.get("lineup_role") or "bench")
        out["slot"] = row.get("slot") or ("BN" if role != "starter" else out.get("slot"))
        out["lineup_role"] = role
        out["lineup_locked"] = bool(row.get("locked"))
        for key in ("identity_available", "kickoff_available", "lock_reason"):
            if key in row:
                out[key] = row[key]
        used.add(pid)
        if role == "starter":
            starters.append(out)
        else:
            bench.append(out)
    for pid, card in by_id.items():
        if pid in used:
            continue
        extra = dict(card)
        extra["slot"] = "BN"
        extra["lineup_role"] = "bench"
        bench.append(extra)
    return starters, bench


def _cached_sleeper_lineup(
    ctx: dict[str, Any],
    league: dict[str, Any] | None,
    players: list[dict[str, Any]],
    rules: LeagueRules,
    season: int,
    week: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Read the same recorded lineup as My team/Game center, without provider I/O."""
    meta = {
        "lineup_source": "sleeper",
        "lineup_available": False,
        "lineup_locked": False,
        "week_scored": False,
    }
    _, bench = apply_saved_lineup(players, [])
    sleeper_id = str((league or {}).get("sleeper_league_id") or ctx.get("sleeper_league_id") or "")
    cached = storage.get_sleeper_live_scoring_cache(sleeper_id, week)
    payload = (cached or {}).get("payload") or {}
    if (not payload.get("available") or payload.get("placeholder")
            or str(payload.get("season")) != str(season)
            or str(payload.get("week")) != str(week)):
        return [], bench, meta

    team_id = str(ctx.get("team_id") or "")
    team = storage.get_team(team_id) or {}
    roster_id = str(ctx.get("sleeper_roster_id") or team.get("sleeper_roster_id") or "")
    teams = [team for matchup in payload.get("matchups") or [] for team in matchup.get("teams") or []]
    if roster_id:
        mine = next((team for team in teams if str(team.get("roster_id") or "") == roster_id), None)
    else:
        mine = next((team for team in teams if str(team.get("hub_team_id") or "") == team_id), None)
    if mine is None or not isinstance(mine.get("starters"), list):
        return [], bench, meta

    by_id = {}
    for card in players:
        for value in (card.get("player_id"), card.get("sleeper_player_id"), card.get("proj_player_id")):
            key = str(value or "")
            if key:
                by_id[key] = card
                by_id[key.removeprefix("sleeper-")] = card

    slots = payload.get("starting_slots") or starting_slots_from_rules(rules)
    counts = Counter(slots)
    seen = Counter()
    saved = []
    cards = {str(card["player_id"]): card for card in players}

    def add(row, slot, role):
        sid = str(row.get("sleeper_player_id") or "")
        pid = str(row.get("player_id") or "")
        if sid == "0" or (not pid and not sid):
            return
        card = by_id.get(sid) or by_id.get(pid) or by_id.get(pid.removeprefix("sleeper-"))
        if card is None:
            # Historical starters / recent Sleeper moves may not be on today's cap sheet.
            pid = pid or f"sleeper-{sid}"
            card = {
                "player_id": pid,
                "sleeper_player_id": sid,
                "player_name": row.get("name") or "",
                "team": row.get("team") or "",
                "position": normalize_position(row.get("position")),
                "p50": row.get("proj"),
                "has_projection": row.get("proj") is not None,
                "projection_missing": row.get("proj") is None,
            }
            cards[pid] = card
        saved.append({"player_id": card["player_id"], "slot": slot, "lineup_role": role})

    for index, row in enumerate(mine["starters"]):
        base = slots[index] if index < len(slots) else str(row.get("position") or "")
        seen[base] += 1
        slot = f"{base}{seen[base]}" if counts[base] > 1 else base
        add(row, slot, "starter")
    for row in mine.get("bench_players") or []:
        add(row, "BN", "bench")
    historical = week < int(payload.get("current_week") or week)
    if historical:
        recorded_ids = {row["player_id"] for row in saved}
        cards = {pid: card for pid, card in cards.items() if pid in recorded_ids}
    starters, bench = apply_saved_lineup(list(cards.values()), saved)
    return starters, bench, {
        **meta,
        "lineup_available": True,
        "lineup_synced_at": cached.get("synced_at"),
    }


def resolve_week_lineup(
    ctx: dict[str, Any],
    players: list[dict[str, Any]],
    rules: LeagueRules,
    *,
    season: int,
    week: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Use a persisted Hub lineup in ScoreSense-only league mode.

    Linked leagues display Sleeper's recorded starters from the shared scoring
    cache; edits and scoring remain on Sleeper. Never guess a hosted lineup.
    """
    league_id = str(ctx.get("league_id") or "")
    team_id = str(ctx.get("team_id") or "")
    if ctx.get("mode") != "league" or not league_id or not team_id:
        from src.draft_hub.weekly_command_center import infer_starters_and_bench

        starters, bench = infer_starters_and_bench(players, rules)
        return starters, bench, {
            "lineup_source": "inferred",
            "lineup_locked": False,
            "week_scored": False,
        }
    league = storage.get_league(league_id)
    if sleeper_hosts_scoring(league, ctx):
        return _cached_sleeper_lineup(ctx, league, players, rules, season, week)

    saved = ensure_team_lineup(league_id, team_id, season, week, rules=rules)
    historical = _week_lineups_closed(league_id, season, week)
    if historical:
        by_id = {str(player.get("player_id")): player for player in players}
        players = [{**by_id.get(row["player_id"], {}), **row, "team": row.get("nfl_team") or ""} for row in saved]
    players = [{**player, "lineup_locked": _lineup_row_locked(player, season, week)} for player in players]
    starters, bench = apply_saved_lineup(players, [lineup_edit_metadata(row, season, week) for row in saved])
    locked = week_is_final(league_id, season, week)
    return starters, bench, {
        "lineup_source": "hub",
        "lineup_default_policy": "salary" if uses_salaries(rules) else "weekly_projections",
        "week_scored": locked,
        "week_final": locked,
        "lineup_locked": locked,
        "lineup_persisted": True,
    }


def set_team_starters(
    league_id: str,
    team_id: str,
    season: int,
    week: int,
    starter_slots: list[dict[str, Any]],
    *,
    rules: LeagueRules | None = None,
    now: datetime | None = None,
    game_started: Callable[[str], bool] | None = None,
    staff_edit: bool = False,
) -> list[dict[str, Any]]:
    """Replace the week's starters. Remaining roster players go to the bench."""
    if _week_lineups_closed(league_id, season, week, now=now):
        raise LineupError("Past-week lineups require a commissioner correction")
    league = storage.get_league(league_id)
    if not league:
        raise LineupError("League not found")
    if not isinstance(rules, LeagueRules):
        rules = LeagueRules.model_validate(rules) if rules else _league_rules(league)
    ws = storage.roster_workspace_for_league(league)
    roster = _active_roster(ws, team_id)
    cards = {card["player_id"]: (card if game_started is not None else
             trusted_lineup_row(card, season, week) or card) for card in _cards_from_roster(roster)}
    if not cards:
        raise LineupError("Roster is empty")

    existing = ensure_team_lineup(
        league_id, team_id, season, week, rules=rules, roster=roster, game_started=game_started
    )
    if not storage.has_team_lineup_snapshot(league_id, team_id, season, week):
        raise LineupError("This week's starting lineup is missing; a commissioner correction is required")
    existing_by_id = {row["player_id"]: row for row in existing}
    for pid, row in existing_by_id.items():
        if pid not in cards and _lineup_row_locked(row, season, week, now=now, game_started=game_started):
            cards[pid] = {**row, "team": row.get("nfl_team") or ""}

    seen: set[str] = set()
    seen_identities: set[str] = set()
    seen_slots: set[str] = set()
    starters: list[dict[str, Any]] = []
    for item in starter_slots:
        pid = str(item.get("player_id") or "").strip()
        slot = canonical_starter_slot(item.get("slot"), rules)
        if not pid or not slot:
            raise LineupError("Each starter needs a player and a slot")
        if pid in seen:
            raise LineupError("A player cannot fill two starter slots")
        if slot in seen_slots:
            raise LineupError("Each starter slot can only be filled once")
        card = cards.get(pid)
        if not card:
            raise LineupError("That player is not on this roster")
        prior = existing_by_id.get(pid) or {}
        trusted = card if game_started is not None else trusted_lineup_row(card, season, week)
        unchanged = prior.get("lineup_role") == "starter" and canonical_starter_slot(prior.get("slot"), rules) == slot
        if trusted is None and not unchanged:
            raise LineupError("Player identity is unavailable; the lineup was not changed.")
        key = (trusted or card).get("_canonical_player_key") or pid
        if key in seen_identities:
            raise LineupError("A player cannot fill two starter slots")
        seen_identities.add(key)
        if trusted and not slot_accepts_position(slot, trusted["position"], rules):
            raise LineupError(f"{trusted['position']} cannot start at {slot}")
        card = trusted or card
        if _lineup_row_locked(prior or card, season, week, now=now, game_started=game_started):
            if str(prior.get("lineup_role")) != "starter" or canonical_starter_slot(prior.get("slot"), rules) != slot:
                raise LineupError(_lineup_lock_message(prior or card, season, week, now=now, game_started=game_started))
        starters.append({**card, "slot": slot, "lineup_role": "starter", "locked": bool(prior.get("locked"))})
        seen.add(pid)
        seen_slots.add(slot)

    counts = Counter(
        str(row["slot"]).upper().rstrip("0123456789") for row in starters
    )
    capacity = _starter_capacity(rules)
    for base, n in counts.items():
        max_n = capacity.get(base)
        if max_n is not None and n > max_n:
            raise LineupError(f"Lineup allows {max_n} {base} starter(s)")

    bench = []
    for pid, card in cards.items():
        if pid in seen:
            continue
        prior = existing_by_id.get(pid) or {}
        if _lineup_row_locked(prior or card, season, week, now=now, game_started=game_started):
            if str(prior.get("lineup_role")) == "starter":
                raise LineupError(_lineup_lock_message(prior or card, season, week, now=now, game_started=game_started))
            # Already-started bench players stay on the bench.
        bench.append({**card, "slot": "BN", "lineup_role": "bench", "locked": bool(prior.get("locked"))})

    return _persist_cards(league_id, team_id, season, week, starters, bench)


def swap_lineup_players(
    league_id: str,
    team_id: str,
    season: int,
    week: int,
    *,
    starter_player_id: str,
    bench_player_id: str,
    rules: LeagueRules | None = None,
    now: datetime | None = None,
    game_started: Callable[[str], bool] | None = None,
    staff_edit: bool = False,
) -> list[dict[str, Any]]:
    """Swap a starter with a bench player when the bench is eligible for that slot."""
    if _week_lineups_closed(league_id, season, week, now=now):
        raise LineupError("Past-week lineups require a commissioner correction")
    league = storage.get_league(league_id)
    if not league:
        raise LineupError("League not found")
    if not isinstance(rules, LeagueRules):
        rules = LeagueRules.model_validate(rules) if rules else _league_rules(league)
    rows = ensure_team_lineup(league_id, team_id, season, week, rules=rules, game_started=game_started)
    if not storage.has_team_lineup_snapshot(league_id, team_id, season, week):
        raise LineupError("This week's starting lineup is missing; a commissioner correction is required")
    by_id = {row["player_id"]: dict(row) for row in rows}
    starter_id = str(starter_player_id or "").strip()
    bench_id = str(bench_player_id or "").strip()
    starter = by_id.get(starter_id)
    bench = by_id.get(bench_id)
    if not starter or not bench:
        raise LineupError("Both players must already be on this week's lineup")
    if str(starter.get("lineup_role")) != "starter":
        raise LineupError("The first player is not a starter")
    if str(bench.get("lineup_role")) != "bench":
        raise LineupError("The second player is not on the bench")
    slot = str(starter.get("slot") or "")
    trusted_bench = bench if game_started is not None else trusted_lineup_row(bench, season, week)
    if trusted_bench is None:
        raise LineupError("Player identity is unavailable; the lineup was not changed.")
    if not slot_accepts_position(slot, trusted_bench.get("position") or "", rules):
        raise LineupError(f"{trusted_bench.get('position')} cannot start at {slot}")
    if _lineup_row_locked(starter, season, week, now=now, game_started=game_started):
        raise LineupError(_lineup_lock_message(starter, season, week, now=now, game_started=game_started, subject="The starter"))
    if _lineup_row_locked(bench, season, week, now=now, game_started=game_started):
        raise LineupError(_lineup_lock_message(bench, season, week, now=now, game_started=game_started, subject="The bench player"))
    bench_key = trusted_bench.get("_canonical_player_key") or bench_id
    for row in rows:
        if row.get("lineup_role") != "starter" or row["player_id"] == starter_id:
            continue
        trusted = row if game_started is not None else trusted_lineup_row(row, season, week)
        if trusted and (trusted.get("_canonical_player_key") or row["player_id"]) == bench_key:
            raise LineupError("A player cannot fill two starter slots")

    new_starter = {**trusted_bench, "slot": slot, "lineup_role": "starter"}
    new_bench = {**starter, "slot": "BN", "lineup_role": "bench"}
    next_rows = [
        new_starter if row["player_id"] == bench_id else
        new_bench if row["player_id"] == starter_id else
        row
        for row in rows
    ]
    return storage.replace_team_lineup(league_id, team_id, season, week, next_rows)


def fantasy_points_from_stats(stats: dict[str, Any] | None, scoring: ScoringRules | None = None) -> float:
    total = 0.0
    blob = dict(stats or {})
    # Derive mutually exclusive bands from actual values, never from a missing
    # value (in particular, an absent defense score is not a shutout).
    for stat, lower, upper in (("passing", 300, 400), ("rushing", 100, 200), ("receiving", 100, 200)):
        if f"{stat}_yards" in blob:
            yards = float(blob[f"{stat}_yards"] or 0)
            blob[f"bonus_{stat}_{lower}"] = int(lower <= yards < upper)
            blob[f"bonus_{stat}_{upper}"] = int(yards >= upper)
    if blob.get("def_points_allowed") is not None:
        allowed = float(blob["def_points_allowed"])
        for low, high, suffix in ((0, 0, "0"), (1, 6, "1_6"), (7, 13, "7_13"),
                                  (14, 20, "14_20"), (21, 27, "21_27"),
                                  (28, 34, "28_34"), (35, float("inf"), "35_plus")):
            blob[f"def_points_allowed_{suffix}"] = int(low <= allowed <= high)
    for key, weight in (scoring or ScoringRules()).model_dump().items():
        try:
            total += float(blob.get(key) or 0) * float(weight)
        except (TypeError, ValueError):
            continue
    return round(total, 2)


def _lineup_stat_keys(row: dict[str, Any]) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()

    def add(value: Any) -> None:
        key = str(value or "").strip()
        if key and key not in seen:
            seen.add(key)
            keys.append(key)

    pid = str(row.get("player_id") or "").strip()
    add(pid)
    if pid.startswith("sleeper-"):
        add(pid[8:])
    elif pid.isdigit():
        add(f"sleeper-{pid}")
    add(row.get("sleeper_player_id"))
    add(name_pos_key(row))
    return keys


def stats_for_lineup_row(
    lookup: dict[str, dict[str, Any]] | None,
    row: dict[str, Any],
) -> dict[str, Any]:
    """Resolve nflverse stats for a lineup row across GSIS, Sleeper, and name keys."""
    if not lookup:
        return {}
    for key in _lineup_stat_keys(row):
        stats = lookup.get(key)
        if stats:
            return stats
    return {}


def _alias_week_stat_index(
    index: dict[str, dict[str, Any]],
    week_df: pd.DataFrame,
) -> dict[str, dict[str, Any]]:
    """Index the same stat row under Sleeper ids and name|pos keys."""
    aliased = dict(index)
    name_col = next(
        (col for col in ("player_display_name", "player_name", "player") if col in week_df.columns),
        None,
    )
    if name_col and "position" in week_df.columns:
        for _, row in week_df.iterrows():
            pid = str(row.get("player_id") or "").strip()
            stats = aliased.get(pid)
            if not stats:
                continue
            key = name_pos_key({"player_name": row.get(name_col), "position": row.get("position")})
            if key:
                aliased.setdefault(key, stats)
    try:
        from src.draft_hub.draft_enrichment import _sleeper_lookup_tables

        _df, by_gsis, _by_sleeper_id, _by_name_team, _by_name = _sleeper_lookup_tables()
    except Exception:
        return aliased
    for gsis, stats in index.items():
        if not is_gsis_player_id(gsis):
            continue
        sleeper_row = by_gsis.get(gsis)
        if sleeper_row is None:
            continue
        sid = str(sleeper_row.get("sleeper_id") or "").strip()
        if not sid:
            continue
        aliased.setdefault(sid, stats)
        aliased.setdefault(f"sleeper-{sid}", stats)
    return aliased


def require_position_stats(position: str, stats: dict[str, Any], scoring: ScoringRules) -> None:
    """Never score unsupported specialist feeds as zero or as a shutout."""
    if stats.get("_native_no_game") == 1:
        return
    position = normalize_position(position)
    keys = KICKER_STAT_FIELDS if position == "K" else DEFENSE_STAT_FIELDS if position == "DEF" else ()
    required = {key for key in keys if getattr(scoring, key, 0) != 0}
    if position == "DEF" and any(key.startswith("def_points_allowed_") for key in required):
        required = {key for key in required if not key.startswith("def_points_allowed_")}
        required.add("def_points_allowed")
    if any(key not in stats or stats[key] is None for key in required):
        raise LineupError(f"Actual {position} scoring statistics are incomplete; no results were saved.")


def _load_legacy_week_stat_index(season: int, week: int, *, frame=None) -> dict[str, dict[str, Any]]:
    """player_id → stat dict + fantasy_points for one NFL week (nflverse)."""
    from src.config import is_testing

    cache_key = (int(season), int(week))
    if frame is None and not is_testing():
        cached = _STAT_INDEX_CACHE.get(cache_key)
        if cached and (time.monotonic() - cached[0]) < _STAT_INDEX_TTL_S:
            return cached[1]
    def _store(payload: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        if not is_testing():
            _STAT_INDEX_CACHE[cache_key] = (time.monotonic(), payload)
        return payload

    try:
        from src.etl.nflverse_etl import load_weekly_player_stats

        if frame is None:
            frame = load_weekly_player_stats([int(season)])
    except Exception:
        return _store({})
    if frame is None or getattr(frame, "empty", True):
        return _store({})
    if "week" not in frame.columns or "player_id" not in frame.columns:
        return _store({})
    selected = pd.to_numeric(frame["week"], errors="coerce") == int(week)
    if "season" in frame:
        selected &= pd.to_numeric(frame["season"], errors="coerce") == int(season)
    if "season_type" in frame:
        selected &= frame["season_type"].astype(str).str.upper() == "REG"
    week_df = frame.loc[selected].copy()
    if week_df.empty:
        return _store({})
    if "interceptions" not in week_df and "passing_interceptions" in week_df:
        week_df["interceptions"] = week_df["passing_interceptions"]
    if "fumbles_lost" not in week_df:
        week_df["fumbles_lost"] = sum(
            pd.to_numeric(week_df.get(key, pd.Series(0, index=week_df.index)), errors="coerce").fillna(0)
            for key in ("sack_fumbles_lost", "rushing_fumbles_lost", "receiving_fumbles_lost")
        )
    from src.draft_hub.native_specialist_stats import normalize_kicking_stats, load_defense_stat_index

    week_df["fantasy_points"] = calc_fantasy_points_ppr(week_df)
    index: dict[str, dict[str, Any]] = {}
    for _, row in week_df.iterrows():
        pid = str(row.get("player_id") or "").strip()
        if not pid:
            continue
        stats = {
            key: float(row[key]) if key in row and pd.notna(row[key]) else 0.0
            for key in FANTASY_SCORING
        }
        stats.update({key: float(row[key]) for key in NATIVE_STAT_FIELDS
                      if key in row and pd.notna(row[key])})
        stats.update(normalize_kicking_stats(row))
        try:
            pts = float(row["fantasy_points"])
        except (TypeError, ValueError):
            pts = fantasy_points_from_stats(stats)
        stats["position"] = str(row.get("position") or "")
        stats["opponent"] = str(row.get("opponent") or "")
        stats["fantasy_points"] = round(pts, 2)
        index[pid] = stats
    result = _alias_week_stat_index(index, week_df)
    result.update(load_defense_stat_index(int(season), int(week)))
    return _store(result)


def load_week_stat_index(season: int, week: int, *, frame=None):
    if frame is not None:
        return _load_legacy_week_stat_index(season, week, frame=frame)
    from src.draft_hub.native_stats import get_week_snapshot
    return native_season_stat_index(get_week_snapshot(season, week))


def native_season_stat_index(snapshot):
    """Group verified weekly events under all aliases for season ranks/logs."""
    index, shared = {}, {}
    for alias, stats in snapshot['stats'].items():
        identity = (snapshot.get('identities') or {}).get(alias) or {}
        key = str(identity.get('sleeper_player_id') or alias)
        shared.setdefault(key, {**stats, 'position': identity.get('position'), '_native_player_key': key,
                                '_native_played': identity.get('played')})
        index[alias] = shared[key]
    return index


def native_week_needs_score_refresh(
    league: dict[str, Any] | None,
    scoring_run: dict[str, Any] | None,
    *,
    refresh: bool,
) -> bool:
    """True when Game Center should persist the current nflverse snapshot."""
    if not league or not league.get("draft_completed"):
        return False
    if sleeper_hosts_scoring(league):
        return False
    if scoring_run and scoring_run.get("final"):
        return False
    return bool(refresh or scoring_run is None)


def apply_week_scores(
    league_id: str,
    season: int,
    week: int,
    *,
    stat_index: dict[str, dict[str, Any]] | None = None,
    load_stats: Callable[[int, int], dict[str, dict[str, Any]]] | None = None,
    slate_complete: bool | None = None,
    now: datetime | None = None,
    identity_snapshot: dict[str, Any] | None = None,
    automatic: bool = False,
    refresh_lease: float | None = None,
) -> dict[str, Any]:
    """Score every Hub lineup for the week and persist team totals."""
    league = storage.get_league(league_id)
    if not league:
        raise LineupError("League not found")
    if sleeper_hosts_scoring(league):
        raise LineupError("Scoring is hosted in Sleeper")
    rules = _league_rules(league)
    previous_run = storage.get_week_scoring_run(league_id, season, week) if automatic else None
    ensure_season_schedule(league_id, season=season, rules=rules)
    teams = storage.list_league_teams(league_id)
    matchups = storage.list_week_matchups(league_id, season, week)
    participating = week_scoring_team_ids(rules, teams, matchups, week)
    if not participating:
        return {"scored": False, "reason": "no_matchups", "season": int(season), "week": int(week)}
    scoring_teams = [team for team in teams if str(team["id"]) in participating]
    ws = storage.roster_workspace_for_league(league)
    for team in scoring_teams:
        ensure_team_lineup(league_id, str(team["id"]), season, week, rules=rules, identity_snapshot=identity_snapshot)

    lineups = storage.list_week_lineups(league_id, season, week)
    raw_lineups = list(lineups)
    if stat_index is None and load_stats is None and identity_snapshot is None:
        from src.draft_hub.native_stats import get_week_snapshot, NativeStatsUnavailable
        try:
            identity_snapshot = get_week_snapshot(int(season), int(week))
        except NativeStatsUnavailable as exc:
            raise LineupError(str(exc)) from exc
    if stat_index is None and load_stats is None and identity_snapshot is not None:
        from src.draft_hub.native_participation import enrich_inactive_players
        identity_snapshot = enrich_inactive_players(identity_snapshot, [row for row in lineups
                                                    if str(row["team_id"]) in participating], season, week)
    lineups, starter_owners = validated_native_lineups(lineups, rules, season, week, participating,
                                                     snapshot=identity_snapshot)
    # Older data may already contain an acquired started player on another
    # bench. The final score table records each player's kickoff owner once.
    owned_rows = {}
    for row in sorted(lineups, key=lambda row: row.get("lineup_role") != "starter"):
        if not native_lineup_is_scoring_owner(row, starter_owners):
            continue
        owned_rows.setdefault(row["_canonical_player_key"], row)
    lineups = [row for row in owned_rows.values() if str(row["team_id"]) in participating]
    recorded_teams = {row["team_id"] for row in storage.list_week_lineup_snapshots(league_id, season, week)}
    if any(str(team["id"]) not in recorded_teams for team in scoring_teams):
        return {"scored": False, "reason": "incomplete_historical_lineups", "season": int(season), "week": int(week)}
    lookup = stat_index
    if lookup is None and load_stats is None:
        from src.draft_hub.native_stats import get_week_snapshot, resolve_lineup_stats, NativeStatsUnavailable
        try:
            snapshot = identity_snapshot or get_week_snapshot(int(season), int(week))
            if slate_complete is None:
                slate_complete = bool(snapshot.get("complete"))
            lookup = {}
            for row in lineups:
                try:
                    if row.get("_identity_unavailable"):
                        raise NativeStatsUnavailable("Bench player identity is unavailable.")
                    lookup[str(row["player_id"])] = resolve_lineup_stats(row, snapshot)
                except NativeStatsUnavailable:
                    if row.get("lineup_role") == "starter":
                        raise
                    lookup[str(row["player_id"])] = {"_native_stats_unavailable": 1}
        except NativeStatsUnavailable as exc:
            raise LineupError(str(exc)) from exc
    elif lookup is None:
        lookup = load_stats(int(season), int(week))
    if not lookup and not (slate_complete is True and not lineups):
        return {
            "scored": False,
            "reason": "no_stats",
            "season": int(season),
            "week": int(week),
            "source": "hub_ppr",
        }
    if slate_complete is None:
        slate_complete = nfl_week_slate_complete(int(season), int(week), now=now)
    unsupported = [row for row in lineups if str(row.get("lineup_role")) == "starter"
                   and normalize_position(row.get("position")) not in {"QB", "RB", "WR", "TE", "K", "DEF"}]
    if unsupported:
        raise LineupError("Native scoring does not support this starter position")
    team_matchup = {}
    for row in matchups:
        team_matchup[str(row["home_team_id"])] = row["matchup_id"]
        if row.get("away_team_id"):
            team_matchup[str(row["away_team_id"])] = row["matchup_id"]

    player_rows: list[dict[str, Any]] = []
    team_points: dict[str, float] = {str(t["id"]): 0.0 for t in scoring_teams}
    with_stats = 0
    for row in lineups:
        pid = str(row["player_id"])
        tid = str(row["team_id"])
        stats = stats_for_lineup_row(lookup, row)
        if row.get("_identity_unavailable"):
            continue
        if stats.get("_native_stats_unavailable") == 1:
            if row.get("lineup_role") == "starter":
                raise LineupError("Actual starter statistics are unavailable; no results were saved.")
            continue
        if str(row.get("lineup_role")) == "starter":
            require_position_stats(row.get("position"), stats, rules.scoring)
        if stats:
            with_stats += 1
            if any(key in stats for key in NATIVE_STAT_FIELDS):
                points = fantasy_points_from_stats(stats, rules.scoring)
            elif rules.scoring == ScoringRules() and "fantasy_points" in stats:
                points = float(stats["fantasy_points"])
            else:
                raise LineupError("Raw player stats are required to apply this league's scoring rules.")
        else:
            points = 0.0
        if str(row.get("lineup_role")) == "starter":
            team_points[tid] = team_points.get(tid, 0.0) + points
        player_rows.append(
            {
                "player_id": pid,
                "team_id": tid,
                "slot": row.get("slot"),
                "lineup_role": row.get("lineup_role"),
                "points": round(points, 2),
                "stats": {k: stats[k] for k in (*NATIVE_STAT_FIELDS, "_native_no_game", "_native_inactive", "_native_inactive_proof") if k in stats},
            }
        )

    team_rows = [
        {
            "team_id": tid,
            "matchup_id": team_matchup.get(tid),
            "points": round(pts, 2),
        }
        for tid, pts in team_points.items()
    ]
    try:
        storage.save_native_week_scores(league_id, season, week, player_rows, team_rows, rules.scoring.model_dump(),
            final=bool(slate_complete), automatic=automatic, expected_lineups=raw_lineups if automatic else None,
            expected_scored_at=previous_run.get('scored_at') if previous_run else None, refresh_lease=refresh_lease)
    except ValueError as exc:
        raise LineupError(str(exc)) from exc
    from src.draft_hub.season_scoring import native_week
    materialized = native_season_stat_index(identity_snapshot) if identity_snapshot else {}
    for row in lineups:
        pid = str(row['player_id'])
        if pid in lookup and not row.get('_identity_unavailable'):
            if pid not in materialized:
                materialized[pid] = {**lookup[pid], 'position': row['position'], '_native_player_key': row['_canonical_player_key']}
    if slate_complete:
        native_week(league_id, season, week, materialized, rules.scoring)
    return {
        "scored": True,
        "live": not bool(slate_complete),
        "reason": None,
        "season": int(season),
        "week": int(week),
        "source": "hub_ppr",
        "teams": len(team_rows),
        "players_scored": len(player_rows),
        "players_with_stats": with_stats,
    }


def build_hub_standings(league_id: str, season: int) -> list[dict[str, Any]]:
    from src.draft_hub.native_schedule import finalized_season_team_scores, saved_matchup_is_regular

    teams = {str(t["id"]): t for t in storage.list_league_teams(league_id)}
    league = storage.get_league(league_id)
    regular_weeks = schedule_week_count(_league_rules(league)) if league else 14
    records = {
        tid: {"wins": 0, "losses": 0, "ties": 0, "points_for": 0.0, "points_against": 0.0}
        for tid in teams
    }
    scores_by_week: dict[int, dict[str, float]] = {}
    scores = finalized_season_team_scores(league_id, season)
    matchups_by_week = {week: storage.list_week_matchups(league_id, season, week)
                       for week in {int(row["week"]) for row in scores}}
    team_matchup_ids = {(week, str(matchup[key])): matchup.get("matchup_id")
                        for week, matches in matchups_by_week.items() for matchup in matches
                        for key in ("home_team_id", "away_team_id") if matchup.get(key)}
    score_matchup_ids = {(int(row["week"]), str(row["team_id"])): row.get("matchup_id") for row in scores}
    for row in scores:
        week, tid = int(row["week"]), str(row["team_id"])
        if not saved_matchup_is_regular(row.get("matchup_id"), week, regular_weeks,
                                        saved_matchup_id=team_matchup_ids.get((week, tid))):
            continue
        if tid not in records:
            continue
        records[tid]["points_for"] += float(row.get("points") or 0)
        scores_by_week.setdefault(week, {})[tid] = float(row.get("points") or 0)

    for week, week_scores in scores_by_week.items():
        for matchup in matchups_by_week[week]:
            home = str(matchup.get("home_team_id") or "")
            if not saved_matchup_is_regular(matchup.get("matchup_id"), week, regular_weeks,
                                            saved_matchup_id=score_matchup_ids.get((week, home))):
                continue
            away = matchup.get("away_team_id")
            if not away:
                continue
            away = str(away)
            if home not in week_scores or away not in week_scores:
                continue
            pa = week_scores[home]
            pb = week_scores[away]
            records[home]["points_against"] += pb
            records[away]["points_against"] += pa
            if pa > pb:
                records[home]["wins"] += 1
                records[away]["losses"] += 1
            elif pb > pa:
                records[away]["wins"] += 1
                records[home]["losses"] += 1
            else:
                records[home]["ties"] += 1
                records[away]["ties"] += 1

    rows = []
    for tid, team in teams.items():
        rec = records[tid]
        played = rec["wins"] + rec["losses"] + rec["ties"]
        rows.append(
            {
                "roster_id": tid,
                "hub_team_id": tid,
                "team_name": team.get("name") or team.get("sleeper_team_name") or "Team",
                "owner_name": str(team.get("owner_name") or "").strip() or None,
                "wins": rec["wins"],
                "losses": rec["losses"],
                "ties": rec["ties"],
                "points_for": round(rec["points_for"], 2),
                "points_against": round(rec["points_against"], 2),
                "win_pct": (rec["wins"] + rec["ties"] / 2) / played if played else 0.0,
            }
        )
    rows.sort(key=lambda r: (-r["win_pct"], -r["points_for"], str(r["hub_team_id"])))
    from src.draft_hub.league_live_scoring import assign_standings_ranks

    return assign_standings_ranks(rows)


def _starter_sort_key(row: dict[str, Any]) -> tuple[int, int, str]:
    slot = str(row.get("slot") or "")
    base = slot.rstrip("0123456789")
    suffix = slot[len(base):]
    idx = int(suffix) if suffix.isdigit() else 0
    order = {"QB": 0, "RB": 1, "WR": 3, "TE": 5, "FLEX": 6, "K": 7, "DEF": 8}
    return (order.get(base, 50), idx, str(row.get("player_id") or ""))


def _hub_starter_payload(row: dict[str, Any], points: float | None) -> dict[str, Any]:
    return {
        "sleeper_player_id": "",
        "player_id": str(row.get("player_id") or ""),
        "name": row.get("player_name") or row.get("name") or "Player",
        "position": row.get("position") or "",
        "slot": row.get("slot") or "",
        "locked": bool(row.get("locked")),
        "team": row.get("nfl_team") or row.get("team") or "",
        "points": None if points is None else round(float(points), 2),
    }


def _bench_from_scores(
    lineup_rows: list[dict[str, Any]],
    points_by_id: dict[str, float],
) -> dict[str, Any] | None:
    bench = [row for row in lineup_rows if str(row.get("lineup_role")) != "starter"]
    if not bench:
        return None
    total = 0.0
    top_name = ""
    top_points = float("-inf")
    incomplete = False
    for row in bench:
        value = points_by_id.get(str(row["player_id"]))
        if value is None:
            incomplete = True
            continue
        pts = float(value)
        total += pts
        if pts > top_points:
            top_points = pts
            top_name = str(row.get("player_name") or "Bench")
    return {
        "points": None if incomplete else round(total, 2),
        "count": len(bench),
        "top_name": top_name,
        "top_points": round(top_points, 2) if top_points != float("-inf") else None,
    }


def build_hub_live_week(
    league_id: str,
    *,
    week: int | None = None,
    viewer_team_id: str | None = None,
    rules: Any = None,
    nfl_state: dict[str, Any] | None = None,
    refresh: bool = False,
) -> dict[str, Any]:
    """Game Center payload for a ScoreSense-only league."""
    from src.draft_hub.league_live_scoring import (
        _apply_live_viewer,
        resolve_current_week,
    )

    league = storage.get_league(league_id)
    if not league:
        return {
            "available": False,
            "reason": "no_league",
            "hint": "Open a shared league to use Game center.",
        }
    resolved_week, state = resolve_current_week(week_override=week)
    state = nfl_state or state
    season_n = int(league.get("season") or state.get("season") or 2026)
    if not isinstance(rules, LeagueRules):
        rules = LeagueRules.model_validate(rules) if rules else _league_rules(league)
    slots = starting_slots_from_rules(rules)
    schedule = ensure_season_schedule(league_id, season=season_n, rules=rules)
    teams = {str(t["id"]): t for t in storage.list_league_teams(league_id)}
    from src.draft_hub.native_schedule import playoff_week_bounds
    _, max_week = playoff_week_bounds(rules, len(teams))
    if week is None:
        resolved_week = min(resolved_week, max_week)
    matchups = storage.list_week_matchups(league_id, season_n, resolved_week)
    participating = week_scoring_team_ids(rules, list(teams.values()), matchups, resolved_week)
    for tid in participating:
        ensure_team_lineup(league_id, tid, season_n, resolved_week, rules=rules)
    lineups = storage.list_week_lineups(league_id, season_n, resolved_week)
    missing_lineup_teams = [tid for tid in participating if not storage.has_team_lineup_snapshot(league_id, tid, season_n, resolved_week)]

    saved_snapshot = storage.get_native_week_snapshot(league_id, season_n, resolved_week)
    lineups = saved_snapshot["lineups"]
    team_scores = {
        str(row["team_id"]): float(row.get("points") or 0)
        for row in saved_snapshot["teams"]
    }
    player_scores = {
        (str(row["team_id"]), str(row["player_id"])): float(row.get("points") or 0)
        for row in saved_snapshot["players"]
    }
    scored = bool(team_scores)
    raw_run = saved_snapshot["run"]
    scoring_run = raw_run if raw_run and raw_run.get('final', True) else None
    if raw_run is None:
        team_scores, player_scores, scored = {}, {}, False
    from src.draft_hub.native_score_refresh import request_refresh, refresh_status
    if native_week_needs_score_refresh(league, raw_run, refresh=refresh):
        request_refresh(league_id, season_n, resolved_week)
    score_refresh = refresh_status(league_id, season_n, resolved_week)
    live_snapshot = None if scoring_run else storage.get_native_live_week(league_id, season_n, resolved_week)
    scoring_errors = (live_snapshot or {}).get("errors") or []
    if missing_lineup_teams:
        scoring_errors = [*scoring_errors, "Starting lineups are missing; a commissioner correction is required."]
    scoring_status = (live_snapshot or {}).get("status", "live" if raw_run and not scoring_run else "unscored")
    snapshot_scoring = (live_snapshot or {}).get("scoring") or (live_snapshot or {}).get("last_successful_scoring")
    if live_snapshot and snapshot_scoring != rules.scoring.model_dump():
        live_snapshot = None
    provisional = bool((live_snapshot and live_snapshot.get("status") != "pregame") or (raw_run and not scoring_run))
    if provisional and live_snapshot:
        team_scores = {str(row["team_id"]): row.get("points") for row in live_snapshot.get("teams") or []}
        player_scores = {(str(row["team_id"]), str(row["player_id"])): row.get("points")
                         for row in live_snapshot.get("players") or []}
    season_type = str(state.get("season_type") or "regular").lower()
    preseason = season_type in ("pre", "preseason")
    lineups_by_team: dict[str, list[dict[str, Any]]] = {}
    for row in lineups:
        lineups_by_team.setdefault(str(row["team_id"]), []).append(row)

    def _team_payload(team_id: str | None, *, is_viewer: bool, is_opponent: bool) -> dict[str, Any]:
        if not team_id or team_id not in teams:
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
                "points_pending": 0.0,
                "est_final": 0.0,
            }
        team = teams[team_id]
        rows = lineups_by_team.get(team_id) or []
        starter_rows = sorted(
            [row for row in rows if str(row.get("lineup_role")) == "starter"],
            key=_starter_sort_key,
        )
        points_by_id = {
            str(row["player_id"]): player_scores.get((team_id, str(row["player_id"])), None if provisional or scored else 0.0)
            for row in rows
        }
        starters = [
            _hub_starter_payload(row, points_by_id.get(str(row["player_id"]), 0.0))
            for row in starter_rows
        ]
        points = team_scores.get(team_id, None if provisional else 0.0)
        return {
            "roster_id": team_id,
            "hub_team_id": team_id,
            "team_name": team.get("name") or team.get("sleeper_team_name") or "Team",
            "owner_name": str(team.get("owner_name") or "").strip() or None,
            "points": None if points is None else round(float(points), 2),
            "starters": starters,
            "bench": _bench_from_scores(rows, points_by_id),
            "bench_players": [_hub_starter_payload(row, points_by_id.get(str(row["player_id"])))
                              for row in rows if str(row.get("lineup_role")) != "starter"],
            "is_viewer": is_viewer,
            "is_opponent": is_opponent,
            "proj_total": None,
            "points_pending": 0.0,
            "est_final": None if points is None else round(float(points), 2),
        }

    viewer = str(viewer_team_id or "")
    matchup_payloads: list[dict[str, Any]] = []
    viewer_matchup_id = None
    for row in matchups:
        home_id = str(row.get("home_team_id") or "")
        away_id = str(row["away_team_id"]) if row.get("away_team_id") else None
        mid = str(row.get("matchup_id") or "")
        home_is_viewer = bool(viewer and home_id == viewer)
        away_is_viewer = bool(viewer and away_id == viewer)
        if home_is_viewer or away_is_viewer:
            viewer_matchup_id = mid
        matchup_payloads.append(
            {
                "matchup_id": mid,
                "teams": [
                    _team_payload(home_id, is_viewer=home_is_viewer, is_opponent=away_is_viewer),
                    _team_payload(away_id, is_viewer=away_is_viewer, is_opponent=home_is_viewer or not away_id),
                ],
                "win_prob_by_roster": {},
            }
        )

    try:
        from src.draft_hub.weekly_command_center import _load_projection_index

        proj_index, _meta = _load_projection_index(
            int(season_n), int(resolved_week), apply_injury_adjustments=True
        )
    except Exception:
        proj_index = {}
    if proj_index:
        attach_matchup_analytics(matchup_payloads, proj_index)
    for matchup in matchup_payloads:
        for team in matchup["teams"]:
            if scoring_run:
                team["points_pending"] = 0.0
                team["est_final"] = team["points"]
            elif team.get("points") is None:
                team["est_final"] = None
        if scoring_run:
            home, away = matchup["teams"]
            if home.get("hub_team_id") and away.get("hub_team_id"):
                a, b = float(home["points"]), float(away["points"])
                probability = 1.0 if a > b else 0.0 if a < b else 0.5
                matchup["win_prob_by_roster"] = {home["roster_id"]: probability, away["roster_id"]: 1 - probability}

    payload = {
        "scoring_control": {
            "host": "native",
            "scored": scored,
            "final": bool(scoring_run),
            "live": bool(provisional),
            "slate_complete": nfl_week_slate_complete(season_n, resolved_week),
            "week_started": nfl_week_started(season_n, resolved_week),
            "refresh": score_refresh,
            "run": raw_run,
            "settings_changed": bool(scoring_run and ScoringRules.model_validate(scoring_run["scoring"]) != rules.scoring),
            "settings": rules.scoring.model_dump(),
        },
        "available": True,
        "source": "hub",
        "placeholder": not scored and not provisional,
        "reason": "hub" if scored else "hub_live" if provisional else "hub_unscored",
        "hint": (
            "Week scored with saved ScoreSense league rules."
            if scored
            else "Live scores are delayed. Showing the last saved update."
            if scoring_status == "error" and provisional
            else "Live scores refresh during games."
            if provisional
            else "Scores appear when this week's games begin."
        ),
        "season": str(season_n),
        "week": int(resolved_week),
        "season_type": str(state.get("season_type") or "regular"),
        "preseason": preseason,
        "viewer_matchup_id": viewer_matchup_id,
        "matchups": matchup_payloads,
        "starting_slots": list(slots),
        "standings": build_hub_standings(league_id, season_n),
        "synced_at": scoring_run.get("scored_at") if scoring_run else (live_snapshot or {}).get("synced_at"),
        "live": provisional and (live_snapshot or {}).get("status") == "live",
        "week_complete": bool(scoring_run),
        "game_states": (live_snapshot or {}).get("game_states"),
        "scoring_status": "final" if scoring_run else scoring_status,
        "scoring_errors": scoring_errors,
        "scoring_stale": not scored and scoring_status == "error",
        "score_refresh": score_refresh,
        "scoring_attempted_at": (live_snapshot or {}).get("attempted_at"),
        "cached": False,
        **week_picker_meta(state, league),
        "max_week": max_week,
        "playoffs": schedule["playoffs"],
    }
    if refresh:
        payload["refreshed"] = True
    return _apply_live_viewer(
        payload,
        viewer_team_id=viewer_team_id,
        viewer_roster_id=None,
    )


def week_scoring_team_ids(rules: LeagueRules, teams: list[dict], matchups: list[dict], week: int) -> set[str]:
    """Eliminated teams have no postseason score or lineup recovery requirement."""
    ids = {str(team["id"]) for team in teams}
    if int(week) <= schedule_week_count(rules):
        return ids
    return {str(row[field]) for row in matchups for field in ("home_team_id", "away_team_id")
            if row.get(field) and str(row[field]) in ids}


def _week_lineups_closed(league_id: str, season: int, week: int, *, now=None) -> bool:
    if week_is_final(league_id, season, week) or nfl_week_slate_complete(season, week, now=now):
        return True
    try:
        from src.core.schedule_utils import week_rollover_at_et
        rollover = week_rollover_at_et(season, week)
        return rollover is not None and (now or _utcnow()).astimezone(timezone.utc) >= rollover.astimezone(timezone.utc)
    except Exception:
        return False


def _lineup_lock_message(row, season, week, *, now=None, game_started=None, subject="That player"):
    if game_started is None:
        trusted = trusted_lineup_row(row, season, week)
        if trusted is None:
            return "Player identity is unavailable; the lineup was not changed."
        if not row.get("locked") and nfl_game_started(trusted["nfl_team"], season, week, now=now) is None:
            return "Kickoff information is unavailable; the lineup was not changed."
    return f"{subject}'s game has started"


def capture_native_lineups_before_roster_change(league_id: str, team_ids=None) -> None:
    """Snapshot weekly ownership before a cut/trade changes today's roster."""
    league = storage.get_league(league_id)
    if not league or sleeper_hosts_scoring(league) or not league.get("draft_completed"):
        return
    from src.core.schedule_utils import current_projection_week
    season = int(league["season"])
    week = current_projection_week(season, now=_utcnow())
    if week is None:
        return
    wanted = {str(team_id) for team_id in team_ids} if team_ids is not None else None
    for team in storage.list_league_teams(league_id):
        if wanted is None or str(team["id"]) in wanted:
            ensure_team_lineup(league_id, str(team["id"]), season, week)


def canonical_starter_slot(slot: str, rules: LeagueRules) -> str:
    """Validate configured starter slots, accepting the legacy single-slot `QB1`."""
    label = str(slot or "").strip().upper()
    base = label.rstrip("0123456789")
    count = _starter_capacity(rules).get(base, 0)
    suffix = label[len(base):]
    if count == 1 and suffix in ("", "1"):
        return base
    if count > 1 and suffix in {str(index) for index in range(1, count + 1)}:
        return label
    raise LineupError(f"{label or 'Empty'} is not a configured starter slot")


def lineup_edit_metadata(row: dict[str, Any], season: int, week: int) -> dict[str, Any]:
    trusted = trusted_lineup_row(row, season, week)
    state = nfl_game_started(trusted["nfl_team"], season, week) if trusted else None
    return {**row, "locked": bool(row.get("locked")) or state is not False,
            "identity_available": trusted is not None,
            "kickoff_available": state is not None,
            "lock_reason": "identity_unavailable" if trusted is None else "kickoff_unavailable" if state is None else "game_started" if state else None}


def validated_native_lineups(lineups: list[dict[str, Any]], rules: LeagueRules,
                             season: int, week: int, participating: set[str],
                             *, snapshot: dict[str, Any] | None = None):
    """Validate transient trusted identities without rewriting historical rows."""
    rows = []
    owners: dict[str, tuple[str, str]] = {}
    occupied: set[tuple[str, str]] = set()
    for saved in lineups:
        row = trusted_lineup_row(saved, season, week, snapshot=snapshot)
        if row is None:
            if saved.get("lineup_role") == "starter" and str(saved["team_id"]) in participating:
                raise LineupError("Starter identity is unavailable; a commissioner correction is required.")
            row = {**saved, "_identity_unavailable": True,
                   "_canonical_player_key": f"unknown:{saved['player_id']}"}
        if row.get("lineup_role") == "starter":
            key, owner = row["_canonical_player_key"], (str(row["team_id"]), str(row["player_id"]))
            if key in owners and (owner[0] in participating or owners[key][0] in participating):
                raise LineupError("A player cannot fill multiple starting slots in the same week; a commissioner correction is required.")
            owners[key] = owner
            if owner[0] in participating:
                slot = canonical_starter_slot(row.get("slot"), rules)
                if (owner[0], slot) in occupied:
                    raise LineupError("Each starter slot can only score once; a commissioner correction is required.")
                occupied.add((owner[0], slot))
                if not slot_accepts_position(slot, row["position"], rules):
                    raise LineupError(f"{row['position']} cannot score at {slot}; a commissioner correction is required.")
        rows.append(row)
    return rows, owners


def native_lineup_is_scoring_owner(row, owners) -> bool:
    owner = owners.get(row["_canonical_player_key"])
    return owner is None or (row.get("lineup_role") == "starter" and
                             owner == (str(row["team_id"]), str(row["player_id"])))
