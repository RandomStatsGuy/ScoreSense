"""Count budgets and named QB stacks for Classic construction, without score changes."""
from collections import Counter

from src.core.team_codes import normalize_team_for_match


def classic_controls(players, count, caps, choices, games, locked, global_cap, schedule, source_qbs=None):
    by_id = {p.player_id: p for p in players}
    if any(not isinstance(v, int) or isinstance(v, bool) or not 0 <= v <= 150 for v in caps.values()):
        raise ValueError("Player maximum counts must be whole numbers from 0 to 150.")
    for pid in locked:
        if caps.get(pid, count) < count:
            raise ValueError(f"{by_id[pid].name if pid in by_id else pid} is locked in every lineup but has only {caps[pid]} appearances remaining. Unlock the player or change the limit.")
    game_by_id = {str(g["game_id"]): g for g in games or []}
    game_teams = [frozenset(normalize_team_for_match(t) for t in g["teams"]) for g in games or []]
    if len(game_by_id) != len(games or []) or len(set(game_teams)) != len(game_teams) or any(len(teams) != 2 for teams in game_teams):
        raise ValueError("Weighted games must have distinct IDs and two different teams, with no repeated matchup.")
    selected, extra = {}, []
    for choice in choices or []:
        game = game_by_id.get(str(choice["game_id"]))
        qb = by_id.get(choice["qb_id"])
        teams = {normalize_team_for_match(t) for t in game["teams"]} if game else set()
        if not game or not qb or qb.position != "QB" or normalize_team_for_match(qb.team) not in teams:
            raise ValueError("A selected stack quarterback is unavailable or does not belong to its weighted game.")
        if qb.player_id in selected:
            raise ValueError("Choose each stack quarterback only once.")
        ids = choice.get("player_ids", [])
        if len(ids) > 4 or len(ids) != len(set(ids)):
            raise ValueError("Choose at most four different players with each quarterback.")
        same = opposing = 0
        for pid in ids:
            p = by_id.get(pid)
            if not p or p.position not in ("RB", "WR", "TE") or normalize_team_for_match(p.team) not in teams:
                raise ValueError("A selected stack player is unavailable or does not belong to its game.")
            if normalize_team_for_match(p.team) == normalize_team_for_match(qb.team):
                if p.position not in ("WR", "TE"):
                    raise ValueError("Same-team stack players must be WR or TE.")
                same += 1
            else:
                opposing += 1
            # QB -> selected player; the player is not locked in other lineups.
            extra.append(({qb.player_id: 1.0, pid: -1.0}, float("-inf"), 0.0))
        if same > 3 or opposing > 1:
            raise ValueError("Choose up to three same-team receivers and one opposing player per stack.")
        selected[qb.player_id] = choice

    def capacity(qb):
        cap = caps.get(qb.player_id, count)
        if qb.player_id not in locked and global_cap is not None:
            cap = min(cap, global_cap)
        for pid in selected.get(qb.player_id, {}).get("player_ids", []):
            cap = min(cap, caps.get(pid, count))
            if pid not in locked and global_cap is not None:
                cap = min(cap, global_cap)
        return cap

    sources = {}
    for game in games or []:
        teams = frozenset(normalize_team_for_match(t) for t in game["teams"])
        named = [c["qb_id"] for c in choices or [] if str(c["game_id"]) == str(game["game_id"])]
        qbs = [p for p in players if p.position == "QB" and normalize_team_for_match(p.team) in teams
               and (not named or p.player_id in named) and (not source_qbs or p.player_id in source_qbs)
               and (not any(by_id.get(pid) and by_id[pid].position == "QB" for pid in locked) or p.player_id in locked)]
        sources[teams] = [p.player_id for p in qbs]
        wanted = Counter(frozenset(normalize_team_for_match(t) for t in row) for row in schedule)[teams]
        available = sum(capacity(qb) for qb in qbs)
        if wanted > available:
            raise ValueError(f"Game {game['game_id']} needs {wanted} quarterback appearances, but the selected stacks and exposure limits allow at most {available}. Lower its weight, add another stack quarterback, or adjust limits.")
    return extra, sources


def validate_classic_result(result, caps, choices, games=None, schedule=None):
    """Independently check the new budgets and QB implications before returning rows."""
    if not result.get("ok"):
        return result
    usage = Counter()
    for number, entry in enumerate(result.get("lineups", [result])):
        ids = {row["player_id"] for row in entry["lineup"]}
        usage.update(ids)
        if schedule:
            teams = {normalize_team_for_match(t) for t in schedule[number]}
            qb = next((row for row in entry["lineup"] if row["slot"] == "QB"), {})
            game_ids = {str(g["game_id"]) for g in games or [] if {normalize_team_for_match(t) for t in g["teams"]} == teams}
            named = {choice["qb_id"] for choice in choices or [] if str(choice["game_id"]) in game_ids}
            if normalize_team_for_match(qb.get("team", "")) not in teams or (named and qb.get("player_id") not in named):
                return {"ok": False, "lineup": [], "error": "The generated batch failed its game allocation or quarterback selection check. Rebuild before exporting."}
        for choice in choices or []:
            if choice["qb_id"] in ids and not set(choice.get("player_ids", [])).issubset(ids):
                return {"ok": False, "lineup": [], "error": "The generated lineup failed the selected stack check. Rebuild before exporting."}
    if any(usage[pid] > cap for pid, cap in (caps or {}).items()):
        return {"ok": False, "lineup": [], "error": "The generated batch exceeded a player appearance allowance. Rebuild before exporting."}
    return result
