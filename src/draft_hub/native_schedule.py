"""Native round-robin scheduling and finalized-result playoff advancement."""
from __future__ import annotations

from math import ceil, log2
from typing import Any

from src.draft_hub import storage


def saved_matchup_is_regular(
    matchup_id: Any, week: int, regular_weeks: int, *, saved_matchup_id: Any = None,
) -> bool:
    """Saved native matchup types survive later changes to the league schedule.

    Score rows from older writers can lack a matchup ID, so also accept the
    team's saved matchup. Only unclassified legacy IDs use the current boundary.
    """
    for value in (matchup_id, saved_matchup_id):
        identifier = str(value or "")
        if identifier.startswith("hub-"):
            return True
        if identifier.startswith("playoff-"):
            return False
    return int(week) <= int(regular_weeks)


def finalized_season_team_scores(league_id: str, season: int) -> list[dict[str, Any]]:
    """A published scoring run, rather than an orphan score row, is official."""
    rows = storage.list_season_team_scores(league_id, season)
    published = {week for week in {int(row["week"]) for row in rows}
                 if (run := storage.get_week_scoring_run(league_id, season, week)) is not None and run.get("final", True)}
    return [row for row in rows if int(row["week"]) in published]


def round_robin_pairs(teams: list[dict], week: int) -> list[tuple[dict, dict | None]]:
    """Circle rotation visits every opponent before repeating, with rotating byes."""
    ring = sorted(teams, key=lambda team: str(team["id"]))
    if not ring:
        return []
    if len(ring) % 2:
        ring.append(None)
    round_index = (max(1, int(week)) - 1) % (len(ring) - 1)
    for _ in range(round_index):
        ring = [ring[0], ring[-1], *ring[1:-1]]
    pairs = []
    for index in range(len(ring) // 2):
        home, away = ring[index], ring[-index - 1]
        if home is None:
            home, away = away, home
        if away is not None and (round_index + index) % 2:
            home, away = away, home
        pairs.append((home, away))
    return pairs


def playoff_settings(rules: Any) -> dict:
    raw = getattr(rules, "playoffs", None) or {}
    return raw.model_dump() if hasattr(raw, "model_dump") else dict(raw)


def playoff_week_bounds(rules: Any, team_count: int) -> tuple[int, int]:
    settings = playoff_settings(rules)
    regular = int(rules.regular_season_games)
    if not settings.get("enabled"):
        return regular + 1, regular
    entrants = min(int(settings.get("teams") or 6), int(team_count))
    if entrants < 2:
        return regular + 1, regular
    start = int(settings.get("start_week") or regular + 1)
    rounds = ceil(log2(entrants))
    if start <= regular or start + rounds - 1 > 18:
        raise ValueError("Playoffs must follow the regular season and finish by NFL Week 18")
    return start, start + rounds - 1


def _seed_order(size: int) -> list[int]:
    order = [1, 2]
    while len(order) < size:
        total = len(order) * 2 + 1
        order = [seed for prior in order for seed in (prior, total - prior)]
    return order


def build_native_bracket(league_id: str, season: int, rules: Any, standings: list[dict]) -> dict:
    """Derive a bracket from finalized regular weeks and saved playoff matchups.

    Matchup IDs retain original seed numbers, so a later regular-week correction
    cannot silently reseed a bracket that has already been created.
    """
    settings = playoff_settings(rules)
    regular = int(rules.regular_season_games)
    start, end = playoff_week_bounds(rules, len(standings))
    result = {"enabled": bool(settings.get("enabled")), "start_week": start,
              "end_week": end, "rounds": [], "seeds": [], "champion_team_id": None,
              "status": "disabled" if not settings.get("enabled") else "pending_regular_season"}
    if not settings.get("enabled") or end < start:
        return result
    if any(not ((run := storage.get_week_scoring_run(league_id, season, week)) and run.get("final", True)) for week in range(1, regular + 1)):
        return result
    entrants = min(int(settings.get("teams") or 6), len(standings))
    seeds = {str(row.get("hub_team_id") or row["roster_id"]): index
             for index, row in enumerate(standings[:entrants], 1)}
    first_saved = storage.list_week_matchups(league_id, season, start)
    if first_saved:
        frozen = {}
        for matchup in first_saved:
            pieces = str(matchup["matchup_id"]).split("-")
            if len(pieces) == 6 and pieces[:2] == ["playoff", "r1"]:
                frozen[str(matchup["home_team_id"])] = int(pieces[4][1:])
                if matchup.get("away_team_id"):
                    frozen[str(matchup["away_team_id"])] = int(pieces[5][1:])
        if frozen:
            seeds = frozen
    result["seeds"] = [{"team_id": tid, "seed": seed} for tid, seed in sorted(seeds.items(), key=lambda item: item[1])]
    size = 2 ** ceil(log2(entrants))
    by_seed = {seed: tid for tid, seed in seeds.items()}
    order = _seed_order(size)
    next_pairs = [(by_seed.get(order[i]), by_seed.get(order[i + 1]), order[i], order[i + 1])
                  for i in range(0, size, 2)]
    semifinal_losers: list[str] = []
    champion = None
    for number, week in enumerate(range(start, end + 1), 1):
        saved = storage.list_week_matchups(league_id, season, week)
        matches = [row for row in saved if str(row["matchup_id"]).startswith(f"playoff-r{number}-")]
        if not matches:
            matches = [{"matchup_id": f"playoff-r{number}-{index + 1}-game-s{hs}-s{as_}",
                        "home_team_id": home or away, "away_team_id": away if home else None}
                       for index, (home, away, hs, as_) in enumerate(next_pairs)]
        completed = bool((run := storage.get_week_scoring_run(league_id, season, week)) and run.get("final", True))
        totals = {str(row["team_id"]): float(row["points"]) for row in storage.list_team_week_scores(league_id, season, week)}
        winners, losers = [], []
        round_rows = []
        for matchup in matches:
            home, away = str(matchup["home_team_id"]), matchup.get("away_team_id")
            away = str(away) if away else None
            winner, loser = None, None
            if away is None:
                winner = home
            elif completed and home in totals and away in totals:
                winner = min((home, away), key=lambda tid: (-totals[tid], seeds[tid]))
                loser = away if winner == home else home
            round_rows.append({**matchup, "home_seed": seeds.get(home), "away_seed": seeds.get(away),
                               "winner_team_id": winner, "bye": away is None})
            if winner:
                winners.append(winner)
            if loser:
                losers.append(loser)
        round_complete = completed and len(winners) == len(matches)
        result["rounds"].append({"round": number, "week": week, "complete": round_complete, "matchups": round_rows})
        if number == end - start:
            semifinal_losers = losers
        if not round_complete:
            break
        if len(winners) == 1:
            champion = winners[0]
            break
        if settings.get("reseed", True):
            winners.sort(key=lambda tid: seeds[tid])
            next_pairs = [(winners[index], winners[-index - 1], seeds[winners[index]], seeds[winners[-index - 1]])
                          for index in range(len(winners) // 2)]
        else:
            next_pairs = [(winners[index], winners[index + 1], seeds[winners[index]], seeds[winners[index + 1]])
                          for index in range(0, len(winners), 2)]
    if settings.get("third_place", True) and len(semifinal_losers) == 2 and result["rounds"][-1]["week"] == end:
        home, away = sorted(semifinal_losers, key=lambda tid: seeds[tid])
        result["third_place"] = {"week": end, "matchup_id": "playoff-third-place",
                                 "home_team_id": home, "away_team_id": away}
    result["champion_team_id"] = champion
    result["status"] = "complete" if champion else "in_progress"
    return result


def ensure_playoff_matchups(league_id: str, season: int, rules: Any, standings: list[dict]) -> dict:
    bracket = build_native_bracket(league_id, season, rules, standings)
    for round_ in bracket["rounds"]:
        week = round_["week"]
        if storage.list_week_matchups(league_id, season, week):
            continue
        matches = round_["matchups"]
        if (bracket.get("third_place") or {}).get("week") == week:
            matches = [*matches, bracket["third_place"]]
        storage.replace_week_matchups(league_id, season, week, matches)
    return bracket
