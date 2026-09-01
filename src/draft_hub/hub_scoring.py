"""Hub-native weekly lineups, schedule, PPR scoring, and standings.

ScoreSense-only leagues persist start/sit here and score weeks from nflverse
box scores through ``FANTASY_SCORING``. Linked Sleeper leagues keep using
Sleeper as the scoring host.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import pandas as pd

from src.config import FANTASY_SCORING
from src.core.features import calc_fantasy_points_ppr
from src.core.team_codes import normalize_team_to_mlready
from src.draft_hub import storage
from src.draft_hub.league_live_scoring import (
    attach_matchup_analytics,
    pair_placeholder_teams,
    starting_slots_from_rules,
    week_picker_meta,
)
from src.draft_hub.rules_engine import normalize_position
from src.draft_hub.schemas import LeagueRules

ACTIVE_ROSTER = "active"


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
        "team": card.get("team") or "",
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
    """Persist a rotating H2H schedule when the league has none."""
    league = storage.get_league(league_id)
    if not league:
        raise LineupError("League not found")
    season_n = int(season or league.get("season") or 2026)
    rules = rules or _league_rules(league)
    teams = storage.list_league_teams(league_id)
    weeks = schedule_week_count(rules)
    existing = storage.list_season_matchups(league_id, season_n)
    by_week: dict[int, list[dict[str, Any]]] = {}
    for row in existing:
        by_week.setdefault(int(row["week"]), []).append(row)

    created = 0
    for week in range(1, weeks + 1):
        if by_week.get(week) and not force:
            continue
        pairs = pair_placeholder_teams(teams, week)
        payload = []
        for index, (home, away) in enumerate(pairs, start=1):
            payload.append(
                {
                    "matchup_id": f"hub-{week}-{index}",
                    "home_team_id": str(home["id"]),
                    "away_team_id": str(away["id"]) if away else None,
                }
            )
        storage.replace_week_matchups(league_id, season_n, week, payload)
        created += 1
    return {
        "league_id": league_id,
        "season": season_n,
        "weeks": weeks,
        "teams": len(teams),
        "weeks_written": created,
        "matchups": storage.list_season_matchups(league_id, season_n),
    }


def nfl_game_started(
    nfl_team: str,
    season: int,
    week: int,
    *,
    now: datetime | None = None,
) -> bool:
    """True when that club's scheduled kickoff for the week is in the past."""
    team = normalize_team_to_mlready(str(nfl_team or "").strip().upper())
    if not team:
        return False
    try:
        from src.core.schedule_utils import team_game_kickoffs

        games = team_game_kickoffs(int(season), team)
    except Exception:
        return False
    if games is None or getattr(games, "empty", True):
        return False
    week_n = int(week)
    row = games[games["week"].astype(int) == week_n]
    if row.empty:
        return False
    raw = row.iloc[0]
    kick_val = raw["kickoff"] if "kickoff" in raw.index and pd.notna(raw.get("kickoff")) else raw.get("gameday")
    kick = pd.Timestamp(kick_val)
    if pd.isna(kick):
        return False
    if kick.tzinfo is None:
        kick = kick.tz_localize("UTC")
    else:
        kick = kick.tz_convert("UTC")
    stamp = now or _utcnow()
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp >= kick


def nfl_week_slate_complete(
    season: int,
    week: int,
    *,
    now: datetime | None = None,
) -> bool:
    """True when the week's last scheduled kickoff plus a game-length buffer has passed."""
    try:
        from src.core.schedule_utils import week_last_kickoff_et

        last = week_last_kickoff_et(int(season), int(week))
    except Exception:
        return False
    if last is None:
        return False
    stamp = now or _utcnow()
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp >= last.astimezone(timezone.utc) + timedelta(hours=4)


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
    team = str(row.get("nfl_team") or row.get("team") or "")
    if game_started is not None:
        return bool(game_started(team))
    return nfl_game_started(team, season, week, now=now)


def _flex_eligible(rules: LeagueRules) -> frozenset[str]:
    raw = (rules.roster or {}).get("flex") or {}
    if not isinstance(raw, dict):
        return frozenset({"RB", "WR", "TE"})
    eligible = raw.get("eligible") or ["RB", "WR", "TE"]
    return frozenset(normalize_position(p) for p in eligible)


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


def ensure_team_lineup(
    league_id: str,
    team_id: str,
    season: int,
    week: int,
    *,
    rules: LeagueRules | None = None,
    roster: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Create a salary-fill lineup if none exists; reconcile roster adds/drops."""
    league = storage.get_league(league_id)
    if not league:
        raise LineupError("League not found")
    rules = rules or _league_rules(league)
    ws = storage.roster_workspace_for_league(league)
    roster = roster if roster is not None else _active_roster(ws, team_id)
    cards = _cards_from_roster(roster)
    existing = storage.list_team_lineup(league_id, team_id, season, week)
    if existing and any(row.get("locked") for row in existing):
        return existing
    if not cards:
        if existing:
            storage.replace_team_lineup(league_id, team_id, season, week, [])
        return []

    if not existing:
        from src.draft_hub.weekly_command_center import infer_starters_and_bench

        starters, bench = infer_starters_and_bench(cards, rules)
        return _persist_cards(league_id, team_id, season, week, starters, bench)

    roster_ids = {card["player_id"] for card in cards}
    by_card = {card["player_id"]: card for card in cards}
    kept = [row for row in existing if row["player_id"] in roster_ids]
    kept_ids = {row["player_id"] for row in kept}
    dirty = len(kept) != len(existing)
    for pid in roster_ids - kept_ids:
        card = by_card[pid]
        kept.append(
            {
                "player_id": pid,
                "slot": "BN",
                "lineup_role": "bench",
                "player_name": card.get("player_name"),
                "nfl_team": card.get("team"),
                "position": card.get("position"),
                "locked": False,
            }
        )
        dirty = True
    if dirty:
        by_card_locked = {row["player_id"]: row.get("locked") for row in kept}
        starters = []
        bench = []
        for row in kept:
            card = {**by_card[row["player_id"]], **row}
            card["lineup_role"] = row.get("lineup_role") or "bench"
            card["slot"] = row.get("slot") or "BN"
            card["locked"] = by_card_locked.get(row["player_id"])
            if card["lineup_role"] == "starter":
                starters.append(card)
            else:
                bench.append(card)
        return _persist_cards(league_id, team_id, season, week, starters, bench)
    return existing


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
            continue
        out = dict(card)
        role = str(row.get("lineup_role") or "bench")
        out["slot"] = row.get("slot") or ("BN" if role != "starter" else out.get("slot"))
        out["lineup_role"] = role
        out["lineup_locked"] = bool(row.get("locked"))
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


def resolve_week_lineup(
    ctx: dict[str, Any],
    players: list[dict[str, Any]],
    rules: LeagueRules,
    *,
    season: int,
    week: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    """Use a persisted Hub lineup in ScoreSense-only league mode.

    Linked Sleeper leagues keep inferred (advice-only) starters. Lineups and
    scoring stay on Sleeper.
    """
    league_id = str(ctx.get("league_id") or "")
    team_id = str(ctx.get("team_id") or "")
    if ctx.get("mode") != "league" or not league_id or not team_id:
        from src.draft_hub.weekly_command_center import infer_starters_and_bench

        starters, bench = infer_starters_and_bench(players, rules)
        return starters, bench, {"lineup_source": "inferred", "lineup_locked": False}
    league = storage.get_league(league_id)
    if sleeper_hosts_scoring(league, ctx):
        from src.draft_hub.weekly_command_center import infer_starters_and_bench

        starters, bench = infer_starters_and_bench(players, rules)
        return starters, bench, {"lineup_source": "inferred", "lineup_locked": False}

    saved = ensure_team_lineup(league_id, team_id, season, week, rules=rules)
    starters, bench = apply_saved_lineup(players, saved)
    locked = any(row.get("locked") for row in saved)
    return starters, bench, {
        "lineup_source": "hub",
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
) -> list[dict[str, Any]]:
    """Replace the week's starters. Remaining roster players go to the bench."""
    league = storage.get_league(league_id)
    if not league:
        raise LineupError("League not found")
    rules = rules or _league_rules(league)
    ws = storage.roster_workspace_for_league(league)
    roster = _active_roster(ws, team_id)
    cards = {card["player_id"]: card for card in _cards_from_roster(roster)}
    if not cards:
        raise LineupError("Roster is empty")

    existing = ensure_team_lineup(
        league_id, team_id, season, week, rules=rules, roster=roster
    )
    existing_by_id = {row["player_id"]: row for row in existing}

    seen: set[str] = set()
    starters: list[dict[str, Any]] = []
    for item in starter_slots:
        pid = str(item.get("player_id") or "").strip()
        slot = str(item.get("slot") or "").strip()
        if not pid or not slot:
            raise LineupError("Each starter needs a player and a slot")
        if pid in seen:
            raise LineupError("A player cannot fill two starter slots")
        card = cards.get(pid)
        if not card:
            raise LineupError("That player is not on this roster")
        if not slot_accepts_position(slot, card["position"], rules):
            raise LineupError(f"{card['position']} cannot start at {slot}")
        prior = existing_by_id.get(pid) or {}
        if _lineup_row_locked(prior or card, season, week, now=now, game_started=game_started):
            if str(prior.get("lineup_role")) != "starter" or str(prior.get("slot") or "") != slot:
                raise LineupError("That player's game has started")
        starters.append({**card, "slot": slot, "lineup_role": "starter"})
        seen.add(pid)

    bench = []
    for pid, card in cards.items():
        if pid in seen:
            continue
        prior = existing_by_id.get(pid) or {}
        if _lineup_row_locked(prior or card, season, week, now=now, game_started=game_started):
            if str(prior.get("lineup_role")) == "starter":
                raise LineupError("That player's game has started")
            # Already-started bench players stay on the bench.
        bench.append({**card, "slot": "BN", "lineup_role": "bench"})

    locked = any(row.get("locked") for row in existing)
    return _persist_cards(league_id, team_id, season, week, starters, bench, locked=locked)


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
) -> list[dict[str, Any]]:
    """Swap a starter with a bench player when the bench is eligible for that slot."""
    league = storage.get_league(league_id)
    if not league:
        raise LineupError("League not found")
    rules = rules or _league_rules(league)
    rows = ensure_team_lineup(league_id, team_id, season, week, rules=rules)
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
    if not slot_accepts_position(slot, bench.get("position") or "", rules):
        raise LineupError(f"{bench.get('position')} cannot start at {slot}")
    if _lineup_row_locked(starter, season, week, now=now, game_started=game_started):
        raise LineupError("The starter's game has started")
    if _lineup_row_locked(bench, season, week, now=now, game_started=game_started):
        raise LineupError("The bench player's game has started")

    new_starter = {**bench, "slot": slot, "lineup_role": "starter"}
    new_bench = {**starter, "slot": "BN", "lineup_role": "bench"}
    next_rows = [
        new_starter if row["player_id"] == bench_id else
        new_bench if row["player_id"] == starter_id else
        row
        for row in rows
    ]
    return storage.replace_team_lineup(league_id, team_id, season, week, next_rows)


def fantasy_points_from_stats(stats: dict[str, Any] | None) -> float:
    total = 0.0
    blob = stats or {}
    for key, weight in FANTASY_SCORING.items():
        try:
            total += float(blob.get(key) or 0) * float(weight)
        except (TypeError, ValueError):
            continue
    return round(total, 2)


def load_week_stat_index(season: int, week: int) -> dict[str, dict[str, Any]]:
    """player_id → stat dict + fantasy_points for one NFL week (nflverse)."""
    try:
        from src.etl.nflverse_etl import load_weekly_player_stats

        frame = load_weekly_player_stats([int(season)])
    except Exception:
        return {}
    if frame is None or getattr(frame, "empty", True):
        return {}
    if "week" not in frame.columns or "player_id" not in frame.columns:
        return {}
    week_df = frame.loc[pd.to_numeric(frame["week"], errors="coerce") == int(week)].copy()
    if week_df.empty:
        return {}
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
        try:
            pts = float(row["fantasy_points"])
        except (TypeError, ValueError):
            pts = fantasy_points_from_stats(stats)
        stats["fantasy_points"] = round(pts, 2)
        index[pid] = stats
    return index


def apply_week_scores(
    league_id: str,
    season: int,
    week: int,
    *,
    stat_index: dict[str, dict[str, Any]] | None = None,
    load_stats: Callable[[int, int], dict[str, dict[str, Any]]] | None = None,
    slate_complete: bool | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Score every Hub lineup for the week and persist team totals."""
    league = storage.get_league(league_id)
    if not league:
        raise LineupError("League not found")
    if sleeper_hosts_scoring(league):
        raise LineupError("Scoring is hosted in Sleeper")
    rules = _league_rules(league)
    ensure_season_schedule(league_id, season=season, rules=rules)
    teams = storage.list_league_teams(league_id)
    ws = storage.roster_workspace_for_league(league)
    for team in teams:
        ensure_team_lineup(league_id, str(team["id"]), season, week, rules=rules)

    lookup = stat_index
    if lookup is None:
        loader = load_stats or load_week_stat_index
        lookup = loader(int(season), int(week))
    if not lookup:
        return {
            "scored": False,
            "reason": "no_stats",
            "season": int(season),
            "week": int(week),
            "source": "hub_ppr",
        }
    if slate_complete is None:
        slate_complete = nfl_week_slate_complete(int(season), int(week), now=now)
    if not slate_complete:
        return {
            "scored": False,
            "reason": "week_in_progress",
            "season": int(season),
            "week": int(week),
            "source": "hub_ppr",
        }

    lineups = storage.list_week_lineups(league_id, season, week)
    matchups = storage.list_week_matchups(league_id, season, week)
    team_matchup = {}
    for row in matchups:
        team_matchup[str(row["home_team_id"])] = row["matchup_id"]
        if row.get("away_team_id"):
            team_matchup[str(row["away_team_id"])] = row["matchup_id"]

    player_rows: list[dict[str, Any]] = []
    team_points: dict[str, float] = {str(t["id"]): 0.0 for t in teams}
    with_stats = 0
    for row in lineups:
        pid = str(row["player_id"])
        tid = str(row["team_id"])
        stats = lookup.get(pid) or {}
        if stats:
            with_stats += 1
            points = float(stats.get("fantasy_points") or fantasy_points_from_stats(stats))
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
                "stats": {k: stats[k] for k in FANTASY_SCORING if k in stats},
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
    storage.replace_player_week_scores(league_id, season, week, player_rows)
    storage.replace_team_week_scores(league_id, season, week, team_rows)
    storage.lock_week_lineups(league_id, season, week)
    return {
        "scored": True,
        "reason": None,
        "season": int(season),
        "week": int(week),
        "source": "hub_ppr",
        "teams": len(team_rows),
        "players_scored": len(player_rows),
        "players_with_stats": with_stats,
    }


def build_hub_standings(league_id: str, season: int) -> list[dict[str, Any]]:
    teams = {str(t["id"]): t for t in storage.list_league_teams(league_id)}
    records = {
        tid: {"wins": 0, "losses": 0, "ties": 0, "points_for": 0.0}
        for tid in teams
    }
    scores_by_week: dict[int, dict[str, float]] = {}
    for row in storage.list_season_team_scores(league_id, season):
        tid = str(row["team_id"])
        if tid not in records:
            continue
        records[tid]["points_for"] += float(row.get("points") or 0)
        scores_by_week.setdefault(int(row["week"]), {})[tid] = float(row.get("points") or 0)

    for week, week_scores in scores_by_week.items():
        for matchup in storage.list_week_matchups(league_id, season, week):
            home = str(matchup.get("home_team_id") or "")
            away = matchup.get("away_team_id")
            if not away:
                continue
            away = str(away)
            if home not in week_scores or away not in week_scores:
                continue
            pa = week_scores[home]
            pb = week_scores[away]
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
            }
        )
    rows.sort(key=lambda r: (-r["wins"], -r["points_for"], str(r["team_name"] or "").lower()))
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    return rows


def _starter_sort_key(row: dict[str, Any]) -> tuple[int, int, str]:
    slot = str(row.get("slot") or "")
    base = slot.rstrip("0123456789")
    suffix = slot[len(base):]
    idx = int(suffix) if suffix.isdigit() else 0
    order = {"QB": 0, "RB": 1, "WR": 3, "TE": 5, "FLEX": 6, "K": 7, "DEF": 8}
    return (order.get(base, 50), idx, str(row.get("player_id") or ""))


def _hub_starter_payload(row: dict[str, Any], points: float) -> dict[str, Any]:
    return {
        "sleeper_player_id": "",
        "player_id": str(row.get("player_id") or ""),
        "name": row.get("player_name") or row.get("name") or "Player",
        "position": row.get("position") or "",
        "team": row.get("nfl_team") or row.get("team") or "",
        "points": round(float(points or 0), 2),
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
    for row in bench:
        pts = float(points_by_id.get(str(row["player_id"]), 0) or 0)
        total += pts
        if pts > top_points:
            top_points = pts
            top_name = str(row.get("player_name") or "Bench")
    return {
        "points": round(total, 2),
        "count": len(bench),
        "top_name": top_name,
        "top_points": round(top_points, 2) if top_points != float("-inf") else 0.0,
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
    rules = rules or _league_rules(league)
    slots = starting_slots_from_rules(rules)
    ensure_season_schedule(league_id, season=season_n, rules=rules)
    teams = {str(t["id"]): t for t in storage.list_league_teams(league_id)}
    matchups = storage.list_week_matchups(league_id, season_n, resolved_week)
    lineups = storage.list_week_lineups(league_id, season_n, resolved_week)
    if not lineups:
        for tid in teams:
            ensure_team_lineup(league_id, tid, season_n, resolved_week, rules=rules)
        lineups = storage.list_week_lineups(league_id, season_n, resolved_week)

    team_scores = {
        str(row["team_id"]): float(row.get("points") or 0)
        for row in storage.list_team_week_scores(league_id, season_n, resolved_week)
    }
    player_scores = {
        (str(row["team_id"]), str(row["player_id"])): float(row.get("points") or 0)
        for row in storage.list_player_week_scores(league_id, season_n, resolved_week)
    }
    scored = bool(team_scores)
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
            str(row["player_id"]): player_scores.get((team_id, str(row["player_id"])), 0.0)
            for row in rows
        }
        starters = [
            _hub_starter_payload(row, points_by_id.get(str(row["player_id"]), 0.0))
            for row in starter_rows
        ]
        points = float(team_scores.get(team_id, 0.0))
        return {
            "roster_id": team_id,
            "hub_team_id": team_id,
            "team_name": team.get("name") or team.get("sleeper_team_name") or "Team",
            "owner_name": str(team.get("owner_name") or "").strip() or None,
            "points": round(points, 2),
            "starters": starters,
            "bench": _bench_from_scores(rows, points_by_id),
            "is_viewer": is_viewer,
            "is_opponent": is_opponent,
            "proj_total": None,
            "points_pending": 0.0,
            "est_final": round(points, 2),
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

    payload = {
        "available": True,
        "source": "hub",
        "placeholder": not scored,
        "reason": "hub" if scored else "hub_unscored",
        "hint": (
            "Week scored with Hub PPR."
            if scored
            else "Scores fill after this week is scored."
        ),
        "season": str(season_n),
        "week": int(resolved_week),
        "season_type": str(state.get("season_type") or "regular"),
        "preseason": preseason,
        "viewer_matchup_id": viewer_matchup_id,
        "matchups": matchup_payloads,
        "starting_slots": list(slots),
        "standings": build_hub_standings(league_id, season_n),
        "synced_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "cached": False,
        **week_picker_meta(state, league),
    }
    if refresh:
        payload["refreshed"] = True
    return _apply_live_viewer(
        payload,
        viewer_team_id=viewer_team_id,
        viewer_roster_id=None,
    )
