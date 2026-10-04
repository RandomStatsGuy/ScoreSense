"""Actual season production / saved annual salary. Reads only SQLite snapshots."""
from collections import Counter, defaultdict
import json
import math

from src.draft_hub import storage
from src.draft_hub.league_history import sleeper_league_season_chain
from src.draft_hub.owner_display import enrich_team_row, scoring_owner_maps_for_league
from src.draft_hub.season_scoring import summarize


def _number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def build_contract_returns(league_id):
    league = storage.get_league(league_id) or {}
    sleeper_id = str(league.get("sleeper_league_id") or "")
    sources = {str(league.get("season")): sleeper_id or league_id}
    if sleeper_id:
        sources.update({str(x["season"]): str(x["league_id"]) for x in
                        sleeper_league_season_chain(sleeper_id, cached_only=True)})
    contracts = storage.list_league_contract_rows(league_id)
    aliases = storage.list_player_name_aliases(league_id)
    alias_ids = {(str(x.get("alias_name") or "").casefold(), str(x.get("position") or "")):
                 x.get("sleeper_player_id") for x in aliases}
    by_year = defaultdict(list)
    excluded = 0
    for contract in contracts:
        if contract.get("needs_review") or contract.get("obligation_kind") not in (None, "", "ownership"):
            excluded += 1
            continue
        salary = _number(contract.get("base_salary"))
        pid = str(contract.get("player_id") or "")
        alias = alias_ids.get((str(contract.get("player_name") or "").casefold(), str(contract.get("position") or "")))
        if not pid and alias:
            pid = f"sleeper-{alias}"
        if not pid or salary is None or salary <= 0:
            excluded += 1
            continue
        by_year[str(contract["season_year"])].append({**contract, "player_id": pid,
                                                     "sleeper_player_id": alias, "salary": salary})
    results = []
    with storage.get_conn() as conn:
        for year, rows in sorted(by_year.items()):
            saved = conn.execute("SELECT week,payload_json FROM player_season_week WHERE source=? AND season=?",
                                 (sources.get(year, "" if sleeper_id else league_id), int(year))).fetchall()
            weeks = {int(x["week"]): json.loads(x["payload_json"]) for x in saved}
            # A feed hole cannot silently lower a contract's return.
            if not weeks or set(weeks) != set(range(1, max(weeks) + 1)):
                excluded += len(rows)
                continue
            if not sleeper_id:
                corrected = conn.execute("""SELECT s.week,s.player_id,s.points FROM league_player_week_score s
                    JOIN league_week_scoring_run r USING(league_id,season,week)
                    WHERE s.league_id=? AND s.season=? AND r.final=1""", (league_id, int(year))).fetchall()
                overrides = {(int(x["week"]), str(x["player_id"])): x["points"] for x in corrected}
                for week, games in weeks.items():
                    for game in games:
                        for alias in game.get("aliases") or []:
                            if (week, str(alias)) in overrides:
                                game["points"] = overrides[(week, str(alias))]
                                break
            scores = summarize(weeks, rows, {})
            identities = Counter((x["player_id"], str(x.get("franchise_id") or x.get("owner_label") or x.get("hub_team_name") or "")) for x in rows)
            owner_map, sleeper_map = scoring_owner_maps_for_league(league_id, season_year=int(year),
                                                                  sleeper_league_id=sources.get(year), cached_only=True)
            seen = set()
            for row in rows:
                owner = str(row.get("franchise_id") or row.get("owner_label") or row.get("hub_team_name") or "")
                key = (row["player_id"], owner)
                # Multiple sources for the same player/manager/season are ambiguous.
                if key in seen or identities[key] > 1:
                    excluded += 1
                    continue
                seen.add(key)
                score = scores.get(row["player_id"]) or {}
                if score.get("points") is None:
                    excluded += 1
                    continue
                phase = str(row.get("contract_phase") or "")
                # Only rookie terms have an explicit, reliable start year in imported sheets.
                # Renewals and unknown terms remain separate annual entries.
                start = row.get("original_draft_year") if "rookie" in phase.lower() else None
                deal = f"{row['player_id']}:{owner}:{phase}:{start or year}"
                display = enrich_team_row({"team_name": row.get("hub_team_name"), "owner_label": row.get("owner_label")}, owner_map,
                                          sleeper_owner_map=sleeper_map)
                results.append({"deal_id": deal, "season": int(year), "player_id": row["player_id"],
                                "player_name": row.get("player_name"), "position": row.get("position"),
                                "owner_name": display.get("owner_name"), "team_name": display.get("team_name"),
                                "contract_phase": phase, "salary": row["salary"], "points": score["points"],
                                "weeks_saved": len(weeks), "games": score.get("games")})
    return {"rows": results, "seasons": sorted({int(x["season_year"]) for x in contracts}), "excluded": excluded,
            "hint": "Rankings need saved annual salaries and complete player scoring history. Sync the league to update scoring history.",
            "methodology": "Actual season fantasy points divided by saved annual salary. Selected seasons sum points and salary before dividing. Renewals without a saved start year stay separate annual entries."}
