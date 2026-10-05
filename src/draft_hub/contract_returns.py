"""Actual season production / saved annual salary. Reads only SQLite snapshots."""
from collections import Counter, defaultdict
import json
import math
import re

from src.draft_hub import storage
from src.draft_hub.league_history import sleeper_league_season_chain
from src.draft_hub.owner_display import enrich_team_row, scoring_owner_maps_for_league
from src.draft_hub.player_name_match import is_garbage_player_name, roster_name_key
from src.draft_hub.rules_engine import normalize_position


def _number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _position(value):
    pos = normalize_position(value)
    return "" if pos in {"NAN", "WC"} else ("DEF" if pos in {"DST", "D"} else pos)


def _name_parts(name):
    text = str(name or "").strip()
    leading = re.match(r"^((?:[A-Za-z]\.\s*)+)(\S.*)$", text)
    parts = ([re.sub(r"[^a-z]", "", leading[1].lower()), *leading[2].split()]
             if leading else text.split())
    while parts and re.sub(r"[^a-z]", "", parts[-1].lower()) in {"jr", "sr", "ii", "iii", "iv"}:
        parts.pop()
    if len(parts) < 2:
        return None
    head = re.sub(r"[^a-z]", "", parts[0].lower())
    if not head:
        return None
    initials = "".join(part[0] for part in re.findall(r"[a-z]+", parts[0].lower()))
    return head, initials, roster_name_key(" ".join(parts[1:]))


class _SavedPlayerIndex:
    """Exact names or unambiguous first-initial/surname matches, without fuzzy guessing."""

    def __init__(self, weeks, candidates):
        self.ids = defaultdict(set)
        self.exact = defaultdict(set)
        self.initials = defaultdict(set)
        self.positions = {}
        # Weekly feeds repeat the same aliases. Materialize each identity once.
        self.game_ids = {}
        for games in weeks.values():
            for game in games:
                raw_ids = game.get("aliases") or []
                key = tuple(raw_ids)
                if key in self.game_ids and not game.get("player_name"):
                    continue
                ids = [str(x).strip() for x in raw_ids if x]
                if not ids:
                    continue
                canonical = next((x for x in ids if x.startswith("sleeper-")), ids[0])
                self.game_ids[key] = canonical
                if _position(game.get("position")):
                    self.positions[canonical] = _position(game["position"])
                for pid in ids:
                    self.ids[pid].add(canonical)
                if game.get("player_name"):
                    candidates.append({"player_id": canonical, "player_name": game["player_name"], "position": game.get("position")})
        for row in candidates:
            pid = str(row.get("player_id") or "").strip()
            matches = self.ids.get(pid, {pid})
            if not pid or len(matches) != 1:
                continue
            canonical = next(iter(matches))
            name, pos = str(row.get("player_name") or ""), _position(row.get("position")) or self.positions.get(canonical, "")
            if not name or is_garbage_player_name(name):
                continue
            for slot in {pos, ""}:
                self.exact[(roster_name_key(name), slot)].add(canonical)
            parts = _name_parts(name)
            if parts:
                head, initials, last = parts
                for prefix in {head[0], initials}:
                    for slot in {pos, ""}:
                        self.initials[(prefix, last, slot)].add(canonical)
            if pos == "DEF":
                for nickname in {pid.removeprefix("sleeper-"), name.split()[-1]}:
                    for suffix in {"", " DST", " DEF"}:
                        for slot in {pos, ""}:
                            self.exact[(roster_name_key(nickname + suffix), slot)].add(canonical)

    def resolve(self, row):
        pid = str(row.get("player_id") or "").strip()
        if pid:
            ids = self.ids.get(pid, {pid})
        else:
            name, pos = str(row.get("player_name") or ""), _position(row.get("position"))
            ids = self.exact.get((roster_name_key(name), pos), set())
            parts = _name_parts(name)
            if not ids and parts and len(parts[0]) <= 2:
                ids = self.initials.get((parts[0], parts[2], pos), set())
        return next(iter(ids)) if len(ids) == 1 else None


def _saved_names(conn, sources, contracts, aliases):
    names = defaultdict(list)
    common = [row for row in contracts if row.get("player_id")]
    for row in aliases:
        sid = str(row.get("sleeper_player_id") or "").strip()
        if sid:
            for name in {row.get("alias_name"), row.get("canonical_name")}:
                common.append({"player_id": f"sleeper-{sid}", "player_name": name, "position": row.get("position")})
    for source in set(sources.values()):
        cached = conn.execute("SELECT payload_json FROM sleeper_ownership_cache WHERE sleeper_league_id=?", (source,)).fetchone()
        if not cached:
            continue
        for pid, events in (json.loads(cached[0]).get("by_player") or {}).items():
            for event in events:
                names[str(event.get("season"))].append({**event, "player_id": pid})
    return names, common


def build_contract_returns(league_id):
    league = storage.get_league(league_id) or {}
    sleeper_id = str(league.get("sleeper_league_id") or "")
    sources = {str(league.get("season")): sleeper_id or league_id}
    if sleeper_id:
        sources.update({str(x["season"]): str(x["league_id"]) for x in
                        sleeper_league_season_chain(sleeper_id, cached_only=True)})
    contracts = storage.list_league_contract_rows(league_id)
    aliases = storage.list_player_name_aliases(league_id)
    by_year = defaultdict(list)
    reasons = defaultdict(Counter)
    for contract in contracts:
        year = str(contract["season_year"])
        if contract.get("needs_review") or contract.get("roster_status") == "quarantined":
            reasons[year]["needs_review"] += 1
        elif contract.get("obligation_kind") not in (None, "", "ownership"):
            reasons[year]["non_ownership"] += 1
        elif is_garbage_player_name(str(contract.get("player_name") or "")):
            reasons[year]["invalid_name"] += 1
        else:
            salary = _number(contract.get("base_salary"))
            if salary is None or salary <= 0:
                reasons[year]["invalid_salary"] += 1
            else:
                by_year[year].append({**contract, "salary": salary})
    results = []
    with storage.get_conn() as conn:
        names, common = _saved_names(conn, sources, contracts, aliases)
        for year, rows in sorted(by_year.items()):
            saved = conn.execute("SELECT week,payload_json FROM player_season_week WHERE source=? AND season=?",
                                 (sources.get(year, "" if sleeper_id else league_id), int(year))).fetchall()
            weeks = {int(x["week"]): json.loads(x["payload_json"]) for x in saved}
            # A feed hole cannot silently lower a contract's return.
            if not weeks or set(weeks) != set(range(1, max(weeks) + 1)):
                reasons[year]["incomplete_scoring"] += len(rows)
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
            index = _SavedPlayerIndex(weeks, [*common, *names.get(year, [])])
            matched = []
            for row in rows:
                pid = index.resolve(row)
                if pid:
                    matched.append({**row, "player_id": pid, "position": index.positions.get(pid) or _position(row.get("position"))})
                else:
                    reasons[year]["missing_identity"] += 1
            rows = matched
            requested = {row["player_id"] for row in rows}
            logs = defaultdict(dict)
            for week, games in weeks.items():
                for game in games:
                    canonical = index.game_ids.get(tuple(game.get("aliases") or []))
                    if canonical not in requested:
                        continue
                    points = _number(game.get("points"))
                    if points is not None:
                        logs[canonical][week] = points
            # Only actual totals/games are needed here, not the full NFL feed's
            # game logs and positional ranks. A saved zero still counts.
            scores = {pid: {"points": round(sum(games.values()), 2), "games": len(games)}
                      for pid, games in logs.items()}
            identities = Counter((x["player_id"], str(x.get("franchise_id") or x.get("owner_label") or x.get("hub_team_name") or "")) for x in rows)
            owner_map, sleeper_map = scoring_owner_maps_for_league(league_id, season_year=int(year),
                                                                  sleeper_league_id=sources.get(year), cached_only=True)
            seen = set()
            for row in rows:
                owner = str(row.get("franchise_id") or row.get("owner_label") or row.get("hub_team_name") or "")
                key = (row["player_id"], owner)
                # Multiple sources for the same player/manager/season are ambiguous.
                if key in seen or identities[key] > 1:
                    reasons[year]["ambiguous_contract"] += 1
                    continue
                seen.add(key)
                score = scores.get(row["player_id"]) or {}
                if score.get("points") is None:
                    reasons[year]["missing_score"] += 1
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
    seasons = sorted({int(x["season_year"]) for x in contracts})
    ranked = Counter(row["season"] for row in results)
    status = [{"season": year, "ranked": ranked[year], "excluded": dict(reasons[str(year)])} for year in seasons]
    return {"rows": results, "seasons": seasons, "season_status": status,
            "excluded": sum(sum(counts.values()) for counts in reasons.values()),
            "hint": "Rankings need saved annual salaries and complete player scoring history. Sync the league to update scoring history.",
            "methodology": "Actual season fantasy points divided by saved annual salary. Selected seasons sum points and salary before dividing. Renewals without a saved start year stay separate annual entries."}
