"""Dynasty insights built from imported commissioner contract history."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from src.draft_hub import storage
from src.draft_hub.legacy_contract_history import _displayable_contract_row
from src.draft_hub.player_name_match import (
    cluster_key,
    find_matching_player_key,
    is_garbage_player_name,
    name_key,
    names_likely_same,
    pick_canonical_name,
)
from src.draft_hub.rules_engine import normalize_position

ANALYTICS_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"]
DEFAULT_SALARY_CAP = 200.0


def _row_team_name(league_id: str, row: dict[str, Any]) -> str:
    owner = str(row.get("owner_label") or "").strip()
    season = row.get("season_year")
    if league_id and owner and season is not None:
        mapped = storage.resolve_hub_team_name(league_id, int(season), owner)
        if mapped:
            return mapped
    return str(row.get("hub_team_name") or owner or "Unknown")


def _name_key(name: str) -> str:
    return name_key(name)


def _row_position(row: dict[str, Any]) -> str | None:
    pos = normalize_position(row.get("position"))
    if pos in {"DST", "D"}:
        return "DEF"
    return pos if pos in ANALYTICS_POSITIONS else None


def _active_contract_rows(
    league_id: str,
    season_year: int | None = None,
) -> list[dict[str, Any]]:
    rows = storage.list_league_contract_rows(league_id, season_year=season_year)
    return [
        r
        for r in rows
        if _displayable_contract_row(r) and str(r.get("roster_status") or "active") == "active"
    ]


def list_history_seasons(league_id: str) -> list[int]:
    return storage.list_league_contract_seasons(league_id)


def build_contract_analytics(
    league_id: str,
    *,
    season_year: int | None = None,
    salary_cap: float = DEFAULT_SALARY_CAP,
) -> dict[str, Any] | None:
    """League cap analytics from commissioner sheets (one season or all-time averages)."""
    seasons = list_history_seasons(league_id)
    if not seasons:
        return None

    if season_year is not None:
        rows = _active_contract_rows(league_id, season_year)
        return _analytics_snapshot(rows, salary_cap=salary_cap, label=str(season_year), league_id=league_id)

    team_season_rows: dict[str, dict[int, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for yr in seasons:
        for row in _active_contract_rows(league_id, yr):
            team = _row_team_name(league_id, row)
            team_season_rows[team][yr].append(row)

    teams_out: list[dict[str, Any]] = []
    all_spend: dict[str, list[float]] = {p: [] for p in ANALYTICS_POSITIONS}
    all_counts: dict[str, list[int]] = {p: [] for p in ANALYTICS_POSITIONS}

    for team_name, season_map in sorted(team_season_rows.items()):
        season_snapshots: list[dict[str, Any]] = []
        for yr, rows in season_map.items():
            snap = _analytics_snapshot(rows, salary_cap=salary_cap, label=str(yr), league_id=league_id)
            if snap["teams"]:
                season_snapshots.append(snap["teams"][0])

        if not season_snapshots:
            continue

        n = len(season_snapshots)
        spend = {
            p: round(sum(s["spend_by_position"][p] for s in season_snapshots) / n, 2)
            for p in ANALYTICS_POSITIONS
        }
        counts = {
            p: round(sum(s["count_by_position"][p] for s in season_snapshots) / n, 1)
            for p in ANALYTICS_POSITIONS
        }
        committed = round(sum(spend.values()), 2)
        unspent = round(max(0.0, salary_cap - committed), 2)
        pct = {p: round((spend[p] / salary_cap) * 100, 1) if salary_cap else 0.0 for p in ANALYTICS_POSITIONS}
        pct_unspent = round((unspent / salary_cap) * 100, 1) if salary_cap else 0.0

        for p in ANALYTICS_POSITIONS:
            all_spend[p].append(spend[p])
            all_counts[p].append(counts[p])

        teams_out.append(
            {
                "team_id": team_name,
                "team_name": team_name,
                "spend_by_position": spend,
                "count_by_position": {p: int(round(counts[p])) for p in ANALYTICS_POSITIONS},
                "pct_by_position": pct,
                "committed": committed,
                "dead_cap": 0.0,
                "unspent": unspent,
                "pct_unspent": pct_unspent,
                "pct_dead_cap": 0.0,
                "player_count": int(round(sum(counts.values()))),
                "seasons_tracked": n,
            }
        )

    n_teams = max(len(teams_out), 1)
    return {
        "salary_cap": salary_cap,
        "team_count": n_teams,
        "positions": list(ANALYTICS_POSITIONS),
        "teams": teams_out,
        "league_avg": {
            "spend_by_position": {
                p: round(sum(all_spend[p]) / n_teams, 2) for p in ANALYTICS_POSITIONS
            },
            "count_by_position": {
                p: round(sum(all_counts[p]) / n_teams, 1) for p in ANALYTICS_POSITIONS
            },
        },
        "draft_completed": True,
        "source": "contract_history",
        "mode": "all_time",
        "seasons_tracked": len(seasons),
    }


def _analytics_snapshot(
    rows: list[dict[str, Any]],
    *,
    salary_cap: float,
    label: str,
    league_id: str | None = None,
) -> dict[str, Any]:
    teams_out: list[dict[str, Any]] = []
    all_spend: dict[str, list[float]] = {p: [] for p in ANALYTICS_POSITIONS}
    all_counts: dict[str, list[int]] = {p: [] for p in ANALYTICS_POSITIONS}
    by_team: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        team = _row_team_name(league_id, row) if league_id else (
            row.get("hub_team_name") or row.get("owner_label") or "Unknown"
        )
        by_team[team].append(row)

    for team_name, team_rows in sorted(by_team.items()):
        spend = {p: 0.0 for p in ANALYTICS_POSITIONS}
        counts = {p: 0 for p in ANALYTICS_POSITIONS}
        for row in team_rows:
            pos = _row_position(row)
            if not pos:
                continue
            sal = float(row.get("cap_hit") or row.get("base_salary") or 0)
            spend[pos] += sal
            counts[pos] += 1
        committed = round(sum(spend.values()), 2)
        unspent = round(max(0.0, salary_cap - committed), 2)
        pct = {p: round((spend[p] / salary_cap) * 100, 1) if salary_cap else 0.0 for p in ANALYTICS_POSITIONS}
        pct_unspent = round((unspent / salary_cap) * 100, 1) if salary_cap else 0.0
        for p in ANALYTICS_POSITIONS:
            all_spend[p].append(spend[p])
            all_counts[p].append(counts[p])
        teams_out.append(
            {
                "team_id": team_name,
                "team_name": team_name,
                "spend_by_position": {p: round(spend[p], 2) for p in ANALYTICS_POSITIONS},
                "count_by_position": counts,
                "pct_by_position": pct,
                "committed": committed,
                "dead_cap": 0.0,
                "unspent": unspent,
                "pct_unspent": pct_unspent,
                "pct_dead_cap": 0.0,
                "player_count": sum(counts.values()),
            }
        )

    n_teams = max(len(teams_out), 1)
    return {
        "salary_cap": salary_cap,
        "team_count": n_teams,
        "positions": list(ANALYTICS_POSITIONS),
        "teams": teams_out,
        "league_avg": {
            "spend_by_position": {
                p: round(sum(all_spend[p]) / n_teams, 2) for p in ANALYTICS_POSITIONS
            },
            "count_by_position": {
                p: round(sum(all_counts[p]) / n_teams, 1) for p in ANALYTICS_POSITIONS
            },
        },
        "draft_completed": True,
        "source": "contract_history",
        "mode": "season",
        "season": label,
    }


def build_contract_player_profiles(
    league_id: str,
    *,
    season_year: int | None = None,
) -> list[dict[str, Any]]:
    """Per-player career stats from commissioner contract rows."""
    rows = _active_contract_rows(league_id, season_year=season_year)
    by_cluster: dict[str, list[dict[str, Any]]] = defaultdict(list)
    cluster_names: dict[str, str] = {}
    for row in rows:
        ck = cluster_key(row["player_name"], _row_position(row))
        if not ck:
            continue
        merged_key = ck
        for existing_key, rep in cluster_names.items():
            pos = ck.split(":", 1)[1]
            if existing_key.split(":", 1)[1] != pos:
                continue
            if names_likely_same(row["player_name"], rep, position=_row_position(row), pos_b=pos):
                merged_key = existing_key
                break
        cluster_names.setdefault(merged_key, row["player_name"])
        by_cluster[merged_key].append(row)

    profiles: list[dict[str, Any]] = []
    for ck, entries in by_cluster.items():
        entries = sorted(entries, key=lambda r: (int(r["season_year"]), r.get("owner_label") or ""))
        names = [r["player_name"] for r in entries]
        canonical = pick_canonical_name(names)
        teams = sorted({r.get("hub_team_name") or r.get("owner_label") or "Unknown" for r in entries})
        seasons = sorted({int(r["season_year"]) for r in entries})
        caps = [float(r.get("cap_hit") or r.get("base_salary") or 0) for r in entries]
        latest = entries[-1]
        profiles.append(
            {
                "player_key": ck,
                "player_name": canonical,
                "position": _row_position(latest) or latest.get("position"),
                "teams_owned": teams,
                "team_count": len(teams),
                "seasons": seasons,
                "season_count": len(seasons),
                "avg_cap": round(sum(caps) / len(caps), 2) if caps else None,
                "max_cap": max(caps) if caps else None,
                "min_cap": min(caps) if caps else None,
                "total_cap": round(sum(caps), 2) if caps else None,
                "entries": entries,
            }
        )
    profiles.sort(key=lambda p: (p.get("player_name") or "").lower())
    return profiles


def _contract_timeline_events(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for row in entries:
        events.append(
            {
                "event_type": "contract",
                "season": int(row["season_year"]),
                "team_name": row.get("hub_team_name") or row.get("owner_label") or "Team",
                "amount": float(row.get("cap_hit") or row.get("base_salary") or 0),
                "player_name": row.get("player_name"),
                "position": _row_position(row) or row.get("position"),
                "contract_phase": row.get("contract_phase"),
                "note": "Commissioner cap sheet",
            }
        )
    return events


def _event_season(ev: dict[str, Any]) -> int | None:
    if ev.get("season") is not None:
        return int(ev["season"])
    if ev.get("event_type") == "season_roster" and ev.get("season"):
        return int(ev["season"])
    return None


def _filter_timeline_by_season(timeline: list[dict[str, Any]], season_year: int) -> list[dict[str, Any]]:
    return [ev for ev in timeline if _event_season(ev) == season_year]


def _profile_for_player(player: dict[str, Any], profiles: list[dict[str, Any]]) -> dict[str, Any] | None:
    for prof in profiles:
        if find_matching_player_key(prof["player_name"], prof.get("position"), by_key={player.get("player_name") or "": player}):
            return prof
    ck = cluster_key(player.get("player_name") or "", player.get("position"))
    if ck:
        for prof in profiles:
            if prof.get("player_key") == ck:
                return prof
    return None


def _dedupe_players(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for player in players:
        if is_garbage_player_name(player.get("player_name") or ""):
            continue
        ck = cluster_key(player.get("player_name") or "", player.get("position")) or _name_key(player.get("player_name") or "")
        if ck not in merged:
            merged[ck] = player
            continue
        base = merged[ck]
        base["player_name"] = pick_canonical_name([base.get("player_name") or "", player.get("player_name") or ""])
        if not base.get("player_id") or str(base.get("player_id", "")).startswith("contract:"):
            if player.get("player_id") and not str(player.get("player_id", "")).startswith("contract:"):
                base["player_id"] = player["player_id"]
        if player.get("current_owners"):
            base["current_owners"] = player["current_owners"]
        base["timeline"] = sorted(
            list(base.get("timeline") or []) + list(player.get("timeline") or []),
            key=lambda e: (_event_season(e) or 9999, str(e.get("event_type") or "")),
        )
        if player.get("contract_stats"):
            base["contract_stats"] = player["contract_stats"]
    return list(merged.values())


def enrich_ownership_with_contracts(
    ownership: dict[str, Any],
    league_id: str,
    *,
    season_year: int | None = None,
) -> dict[str, Any]:
    """Merge commissioner contract rows into player ownership timelines and stats."""
    seasons = list_history_seasons(league_id)
    if not seasons:
        return ownership

    profiles = build_contract_player_profiles(league_id)
    profile_by_key = {p["player_key"]: p for p in profiles}
    players = [dict(p) for p in ownership.get("players") or [] if not is_garbage_player_name(p.get("player_name") or "")]
    by_key: dict[str, dict[str, Any]] = {}

    for player in players:
        key = _name_key(player.get("player_name") or "")
        if key and not is_garbage_player_name(player.get("player_name") or ""):
            by_key[key] = player

    for prof in profiles:
        stats = {
            "avg_cap": prof["avg_cap"],
            "max_cap": prof["max_cap"],
            "min_cap": prof["min_cap"],
            "total_cap": prof["total_cap"],
            "team_count": prof["team_count"],
            "teams_owned": prof["teams_owned"],
            "season_count": prof["season_count"],
            "seasons": prof["seasons"],
        }
        contract_events = _contract_timeline_events(prof["entries"])
        match_key = find_matching_player_key(prof["player_name"], prof.get("position"), by_key)
        if match_key and match_key in by_key:
            player = by_key[match_key]
            if prof["player_name"] and not is_garbage_player_name(prof["player_name"]):
                player["player_name"] = pick_canonical_name([player.get("player_name") or "", prof["player_name"]])
            player["contract_stats"] = stats
            merged = list(player.get("timeline") or []) + contract_events
            player["timeline"] = sorted(
                merged,
                key=lambda e: (
                    _event_season(e) or 9999,
                    str(e.get("event_type") or ""),
                    str(e.get("team_name") or ""),
                ),
            )
        else:
            timeline = contract_events
            if season_year is not None:
                timeline = _filter_timeline_by_season(timeline, season_year)
            if season_year is None or timeline:
                by_key[prof["player_key"]] = {
                    "player_id": f"contract:{prof['player_key']}",
                    "player_name": prof["player_name"],
                    "position": prof.get("position"),
                    "current_owners": [],
                    "timeline": timeline,
                    "contract_stats": stats,
                    "history_only": True,
                }

    out_players = _dedupe_players(sorted(by_key.values(), key=lambda p: (p.get("player_name") or "").lower()))
    if season_year is not None:
        filtered: list[dict[str, Any]] = []
        for player in out_players:
            timeline = _filter_timeline_by_season(player.get("timeline") or [], season_year)
            stats = player.get("contract_stats") or {}
            prof = _profile_for_player(player, profiles)
            season_entries = [
                e for e in (prof.get("entries") or [] if prof else [])
                if int(e["season_year"]) == season_year
            ]
            if not timeline and not season_entries:
                continue
            next_player = dict(player)
            next_player["timeline"] = timeline or _contract_timeline_events(season_entries)
            if season_entries:
                caps = [float(r.get("cap_hit") or 0) for r in season_entries]
                teams = sorted({r.get("hub_team_name") or r.get("owner_label") for r in season_entries})
                next_player["contract_stats"] = {
                    **stats,
                    "avg_cap": round(sum(caps) / len(caps), 2) if caps else stats.get("avg_cap"),
                    "team_count": len(teams),
                    "teams_owned": teams,
                    "season_count": 1,
                    "seasons": [season_year],
                }
            filtered.append(next_player)
        out_players = filtered

    contract_seasons = [str(y) for y in seasons]
    sleeper_seasons = [str(s) for s in (ownership.get("available_seasons") or [])]
    return {
        **ownership,
        "players": out_players,
        "player_count": len(out_players),
        "has_contract_history": True,
        "contract_seasons": contract_seasons,
        "available_seasons": sorted(set(contract_seasons + sleeper_seasons), key=lambda s: int(s)),
    }


def build_historic_meta(league_id: str) -> dict[str, Any]:
    seasons = list_history_seasons(league_id)
    profiles = build_contract_player_profiles(league_id) if seasons else []
    league_avg_contract = None
    if profiles:
        caps = [p["avg_cap"] for p in profiles if p.get("avg_cap") is not None]
        league_avg_contract = round(sum(caps) / len(caps), 2) if caps else None
    return {
        "available": bool(seasons),
        "seasons": seasons,
        "player_count": len(profiles),
        "league_avg_contract": league_avg_contract,
    }


def _award_entry(
    award_id: str,
    *,
    title: str,
    headline: str,
    roast: str | None = None,
    player_name: str | None = None,
    team_name: str | None = None,
    owner_label: str | None = None,
    position: str | None = None,
    amount: float | None = None,
    detail: str | None = None,
    season_year: int | None = None,
    tone: str = "neutral",
    year_specific: bool = False,
    owner_map: dict[str, str] | None = None,
) -> dict[str, Any]:
    from src.draft_hub.owner_display import enrich_award_display

    award = {
        "id": award_id,
        "title": title,
        "headline": headline,
        "roast": roast,
        "player_name": player_name,
        "position": position,
        "amount": round(amount, 2) if amount is not None else None,
        "detail": detail,
        "season_year": season_year,
        "tone": tone,
    }
    return enrich_award_display(
        award,
        team_name=team_name,
        owner_label=owner_label,
        owner_map=owner_map,
        year_specific=year_specific,
    )


def _position_averages(rows: list[dict[str, Any]]) -> dict[str, float]:
    by_pos: dict[str, list[float]] = defaultdict(list)
    for row in rows:
        pos = _row_position(row)
        if not pos:
            continue
        cap = float(row.get("cap_hit") or row.get("base_salary") or 0)
        if cap > 0:
            by_pos[pos].append(cap)
    return {pos: sum(vals) / len(vals) for pos, vals in by_pos.items() if vals}


def _award_eligible_row(row: dict[str, Any]) -> bool:
    name = str(row.get("player_name") or "")
    if is_garbage_player_name(name):
        return False
    cap = float(row.get("cap_hit") or row.get("base_salary") or 0)
    if cap <= 0:
        return False
    pos = _row_position(row)
    if pos == "DEF" and re.search(r"\b[A-Z]{2,4}\s+\d+\b", name):
        return False
    return True


def _cut_rows(league_id: str, season_year: int | None) -> list[dict[str, Any]]:
    seasons = [season_year] if season_year is not None else list_history_seasons(league_id)
    out: list[dict[str, Any]] = []
    for yr in seasons:
        rows = storage.list_league_contract_rows(league_id, season_year=yr)
        out.extend(
            r
            for r in rows
            if _displayable_contract_row(r) and str(r.get("roster_status") or "") == "cut"
        )
    return out


def _team_award_fields(
    league_id: str,
    row: dict[str, Any],
    *,
    year_specific: bool,
) -> dict[str, Any]:
    team = _row_team_name(league_id, row) if league_id else (
        row.get("hub_team_name") or row.get("owner_label")
    )
    return {
        "team_name": team,
        "owner_label": row.get("owner_label"),
        "year_specific": year_specific,
    }


def build_contract_awards(
    league_id: str,
    *,
    season_year: int | None = None,
    salary_cap: float = DEFAULT_SALARY_CAP,
) -> list[dict[str, Any]]:
    """Fun cap-sheet awards for one season or all-time dynasty history."""
    from src.draft_hub.owner_display import team_owner_map_for_league

    seasons = list_history_seasons(league_id)
    if not seasons:
        return []

    if season_year is not None:
        rows = _active_contract_rows(league_id, season_year)
        scope = str(season_year)
        year_specific = True
    else:
        rows = []
        for yr in seasons:
            rows.extend(_active_contract_rows(league_id, yr))
        scope = "all-time"
        year_specific = False

    rows = [r for r in rows if _award_eligible_row(r)]

    if not rows:
        return []

    owner_map = team_owner_map_for_league(league_id, season_year=season_year)

    def ae(award_id: str, **kwargs):
        return _award_entry(award_id, owner_map=owner_map, **kwargs)

    awards: list[dict[str, Any]] = []
    pos_avg = _position_averages(rows)

    top = max(rows, key=lambda r: float(r.get("cap_hit") or 0))
    top_cap = float(top.get("cap_hit") or 0)
    awards.append(
        ae(
            "highest_paid",
            title="Bag Chaser",
            headline=f"{fmt_sal_short(top_cap)} — touch it, you bought it",
            roast="Commissioner said yes and God said nothing.",
            player_name=top.get("player_name"),
            team_name=_row_team_name(league_id, top),
            owner_label=top.get("owner_label"),
            position=_row_position(top),
            amount=top_cap,
            detail=f"{scope} · league-high cap hit",
            season_year=int(top["season_year"]),
            tone="gold",
            year_specific=year_specific,
        )
    )

    premiums: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        pos = _row_position(row)
        cap = float(row.get("cap_hit") or 0)
        if not pos or cap < 2 or pos not in pos_avg:
            continue
        premiums.append((cap - pos_avg[pos], row))
    if premiums:
        premium, row = max(premiums, key=lambda x: x[0])
        cap = float(row.get("cap_hit") or 0)
        awards.append(
            ae(
                "most_overpaid",
                title="Donated to the cause",
                headline=f"+{fmt_sal_short(premium)} over {row.get('position')} market",
                roast="Could've rostered two guys. Chose hubris.",
                player_name=row.get("player_name"),
                **_team_award_fields(league_id, row, year_specific=year_specific),
                position=_row_position(row),
                amount=cap,
                detail=f"Paid {fmt_sal_short(cap)} · avg was {fmt_sal_short(pos_avg[_row_position(row)])}",
                season_year=int(row["season_year"]),
                tone="bad",
            )
        )
        worst = max(
            (
                (float(r.get("cap_hit") or 0) / pos_avg[_row_position(r)], r)
                for r in rows
                if _row_position(r) in pos_avg and float(r.get("cap_hit") or 0) >= 2
            ),
            key=lambda x: x[0],
        )
        ratio, row = worst
        awards.append(
            ae(
                "worst_contract",
                title="Financial war crime",
                headline=f"{ratio:.1f}× what peers cost",
                roast="The spreadsheet cried. You didn't.",
                player_name=row.get("player_name"),
                **_team_award_fields(league_id, row, year_specific=year_specific),
                position=_row_position(row),
                amount=float(row.get("cap_hit") or 0),
                detail="Worst cap hit vs positional average in this view",
                season_year=int(row["season_year"]),
                tone="bad",
            )
        )

    bargains: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        pos = _row_position(row)
        cap = float(row.get("cap_hit") or 0)
        if not pos or cap < 2 or pos not in pos_avg:
            continue
        discount = pos_avg[pos] - cap
        if discount > 0:
            bargains.append((discount, row))
    if bargains:
        discount, row = max(bargains, key=lambda x: x[0])
        awards.append(
            ae(
                "best_bargain",
                title="Actually competent",
                headline=f"{fmt_sal_short(discount)} below market",
                roast="Rare W. Don't get used to it.",
                player_name=row.get("player_name"),
                **_team_award_fields(league_id, row, year_specific=year_specific),
                position=_row_position(row),
                amount=float(row.get("cap_hit") or 0),
                detail=f"Paid {fmt_sal_short(float(row.get('cap_hit') or 0))} · market {fmt_sal_short(pos_avg[_row_position(row)])}",
                season_year=int(row["season_year"]),
                tone="good",
            )
        )

    waivers = [r for r in rows if float(r.get("cap_hit") or 0) == 1]
    if waivers:
        by_player: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in waivers:
            by_player[_name_key(row["player_name"])].append(row)
        key, entries = max(by_player.items(), key=lambda kv: len(kv[1]))
        sample = entries[0]
        awards.append(
            ae(
                "waiver_king",
                title="Dollar Store GM",
                headline=f"{len(entries)} season{'s' if len(entries) != 1 else ''} at $1",
                roast="Rent-a-player speedrun any%",
                player_name=sample.get("player_name"),
                **_team_award_fields(league_id, sample, year_specific=year_specific),
                position=_row_position(sample),
                amount=1.0,
                detail="Most waiver-rental seasons in this view",
                season_year=int(sample["season_year"]),
                tone="good",
            )
        )

    cap_hog = max(
        rows,
        key=lambda r: float(r.get("cap_hit") or 0) / salary_cap if salary_cap else 0,
    )
    hog_cap = float(cap_hog.get("cap_hit") or 0)
    hog_pct = round((hog_cap / salary_cap) * 100, 1) if salary_cap else 0
    awards.append(
        ae(
            "cap_hog",
            title="Team? Never heard of her",
            headline=f"{hog_pct}% of the cap on one guy",
            roast="Depth is for other leagues.",
            player_name=cap_hog.get("player_name"),
            **_team_award_fields(league_id, cap_hog, year_specific=year_specific),
            position=_row_position(cap_hog),
            amount=hog_cap,
            detail=f"{fmt_sal_short(hog_cap)} · eats the budget",
            season_year=int(cap_hog["season_year"]),
            tone="neutral",
        )
    )

    if season_year is not None:
        by_team: dict[str, float] = defaultdict(float)
        for row in rows:
            team = _row_team_name(league_id, row)
            by_team[team] += float(row.get("cap_hit") or 0)
        if by_team:
            team_name, committed = max(by_team.items(), key=lambda kv: kv[1])
            owner_label = next(
                (
                    r.get("owner_label")
                    for r in rows
                    if _row_team_name(league_id, r) == team_name
                ),
                None,
            )
            awards.append(
                ae(
                    "payroll_king",
                    title="Spent it all",
                    headline=f"{fmt_sal_short(committed)} committed",
                    roast="Future you is gonna hate this.",
                    team_name=team_name,
                    owner_label=owner_label,
                    amount=committed,
                    detail=f"{scope} · highest payroll in the league",
                    season_year=season_year,
                    tone="gold",
                    year_specific=True,
                )
            )

    cuts = _cut_rows(league_id, season_year)
    if cuts:
        dead = max(cuts, key=lambda r: float(r.get("cap_hit") or r.get("prior_salary") or 0))
        dead_amt = float(dead.get("cap_hit") or dead.get("prior_salary") or 0)
        awards.append(
            ae(
                "dead_cap_disaster",
                title="RIP cap space",
                headline=f"{fmt_sal_short(dead_amt)} rotting on the bench",
                roast="Cut him. Keep paying him. Cry.",
                player_name=dead.get("player_name"),
                **_team_award_fields(league_id, dead, year_specific=year_specific),
                position=_row_position(dead),
                amount=dead_amt,
                detail="Ugliest dead-money hit in this view",
                season_year=int(dead["season_year"]),
                tone="bad",
            )
        )

    if season_year is None and len(seasons) >= 2:
        profiles = build_contract_player_profiles(league_id)
        if profiles:
            nomad = max(profiles, key=lambda p: p.get("team_count") or 0)
            if (nomad.get("team_count") or 0) > 1:
                awards.append(
                    ae(
                        "nomad",
                        title="Can't sit still",
                        headline=f"{nomad['team_count']} franchises",
                        roast="Commitment issues loading…",
                        player_name=nomad.get("player_name"),
                        position=nomad.get("position"),
                        amount=nomad.get("avg_cap"),
                        detail=", ".join(nomad.get("teams_owned") or []),
                        tone="neutral",
                    )
                )
            loyalty_scores: list[tuple[int, dict[str, Any]]] = []
            for prof in profiles:
                by_team_seasons: dict[str, set[int]] = defaultdict(set)
                for entry in prof.get("entries") or []:
                    team = entry.get("hub_team_name") or entry.get("owner_label") or "Unknown"
                    by_team_seasons[team].add(int(entry["season_year"]))
                if by_team_seasons:
                    team, yrs = max(by_team_seasons.items(), key=lambda kv: len(kv[1]))
                    if len(yrs) >= 2:
                        loyalty_scores.append((len(yrs), {**prof, "loyalty_team": team, "loyalty_seasons": len(yrs)}))
            if loyalty_scores:
                count, prof = max(loyalty_scores, key=lambda x: x[0])
                from src.draft_hub.owner_display import format_manager_label

                loyalty_team = prof["loyalty_team"]
                awards.append(
                    ae(
                        "loyalty",
                        title="Ride or die",
                        headline=f"{count} years · {format_manager_label(loyalty_team, owner_label=loyalty_team, year_specific=False)}",
                        roast="Built different. Or stuck. Hard to tell.",
                        player_name=prof.get("player_name"),
                        team_name=loyalty_team,
                        owner_label=loyalty_team,
                        position=prof.get("position"),
                        amount=prof.get("avg_cap"),
                        detail="Longest tenure with one team",
                        tone="good",
                        year_specific=False,
                    )
                )
            career = max(profiles, key=lambda p: p.get("total_cap") or 0)
            if career.get("total_cap"):
                awards.append(
                    ae(
                        "career_earnings",
                        title="Paid in full",
                        headline=f"{fmt_sal_short(career['total_cap'])} lifetime",
                        roast="Generational wealth. Generational regret TBD.",
                        player_name=career.get("player_name"),
                        position=career.get("position"),
                        amount=career.get("total_cap"),
                        detail=f"{career.get('season_count')} seasons · avg {fmt_sal_short(career.get('avg_cap'))}",
                        tone="gold",
                    )
                )

        raises: list[tuple[float, dict[str, Any], dict[str, Any]]] = []
        for prof in profiles:
            entries = sorted(prof.get("entries") or [], key=lambda r: int(r["season_year"]))
            for prev, curr in zip(entries, entries[1:]):
                if prev.get("hub_team_name") != curr.get("hub_team_name") and prev.get("owner_label") != curr.get("owner_label"):
                    continue
                bump = float(curr.get("cap_hit") or 0) - float(prev.get("cap_hit") or 0)
                if bump > 0:
                    raises.append((bump, prev, curr))
        if raises:
            bump, prev, curr = max(raises, key=lambda x: x[0])
            awards.append(
                ae(
                    "biggest_raise",
                    title="Agent won",
                    headline=f"+{fmt_sal_short(bump)} year-over-year",
                    roast="Extension szn hit different.",
                    player_name=curr.get("player_name"),
                    **_team_award_fields(league_id, curr, year_specific=False),
                    position=_row_position(curr),
                    amount=float(curr.get("cap_hit") or 0),
                    detail=f"{prev['season_year']} → {curr['season_year']} · same team",
                    season_year=int(curr["season_year"]),
                    tone="neutral",
                )
            )

    return _dedupe_awards(awards)


def build_current_spend_awards(
    overview: dict[str, Any],
    *,
    salary_cap: float = DEFAULT_SALARY_CAP,
    analytics: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Cap awards from the live hub roster."""
    from src.draft_hub.league_analytics import build_league_analytics
    from src.draft_hub.owner_display import lookup_owner_label, team_owner_map_for_league
    from src.draft_hub.pre_draft_cap import is_active_for_pre_draft
    from src.draft_hub.rules_engine import cap_relevant_roster, normalize_position
    from src.draft_hub.schemas import LeagueRules

    league = overview.get("league") or {}
    league_id = str(league.get("id") or "")
    owner_map = team_owner_map_for_league(league_id) if league_id else {}

    def ae(award_id: str, **kwargs):
        return _award_entry(award_id, owner_map=owner_map, **kwargs)

    draft_completed = bool(league.get("draft_completed"))
    if analytics is None:
        analytics = build_league_analytics(overview, draft_completed=draft_completed)
    rules = LeagueRules.model_validate(league.get("rules") or {})

    rows: list[dict[str, Any]] = []
    for block in overview.get("teams") or []:
        team = block.get("team") or {}
        team_name = team.get("name") or "Team"
        owner_label = lookup_owner_label(team_name, owner_map)
        roster = cap_relevant_roster(rules, block.get("roster") or [])
        for row in roster:
            if not is_active_for_pre_draft(row):
                continue
            pos = normalize_position(row.get("position"))
            if pos in {"DST", "D"}:
                pos = "DEF"
            rows.append(
                {
                    "player_name": row.get("player_name"),
                    "hub_team_name": team_name,
                    "owner_label": owner_label,
                    "position": pos,
                    "cap_hit": float(row.get("salary") or 0),
                    "season_year": int(league.get("season") or 2025),
                    "roster_status": "active",
                }
            )

    if not rows:
        return []

    pseudo_rows = rows
    pos_avg = _position_averages(pseudo_rows)
    awards: list[dict[str, Any]] = []

    top = max(pseudo_rows, key=lambda r: float(r.get("cap_hit") or 0))
    awards.append(
        ae(
            "highest_paid",
            title="Bag Chaser",
            headline=f"{fmt_sal_short(float(top['cap_hit']))} on roster right now",
            roast="Your money, their problem.",
            player_name=top.get("player_name"),
            team_name=top.get("hub_team_name"),
            owner_label=top.get("owner_label"),
            position=_row_position(top),
            amount=float(top.get("cap_hit") or 0),
            detail="Current roster · league-high salary",
            tone="gold",
            year_specific=False,
        )
    )

    premiums = []
    for row in pseudo_rows:
        pos = _row_position(row)
        cap = float(row.get("cap_hit") or 0)
        if pos and cap >= 2 and pos in pos_avg:
            premiums.append((cap - pos_avg[pos], row))
    if premiums:
        premium, row = max(premiums, key=lambda x: x[0])
        awards.append(
            ae(
                "most_overpaid",
                title="Donated to the cause",
                headline=f"+{fmt_sal_short(premium)} over {row.get('position')} market",
                roast="The group chat is laughing. Quietly.",
                player_name=row.get("player_name"),
                **_team_award_fields(league_id, row, year_specific=False),
                position=_row_position(row),
                amount=float(row.get("cap_hit") or 0),
                detail="Live roster · worst $ vs position average",
                tone="bad",
            )
        )

    bargains = []
    for row in pseudo_rows:
        pos = _row_position(row)
        cap = float(row.get("cap_hit") or 0)
        if pos and cap >= 2 and pos in pos_avg:
            discount = pos_avg[pos] - cap
            if discount > 0:
                bargains.append((discount, row))
    if bargains:
        discount, row = max(bargains, key=lambda x: x[0])
        awards.append(
            ae(
                "best_bargain",
                title="Actually competent",
                headline=f"{fmt_sal_short(discount)} below market",
                roast="Steals still exist. Barely.",
                player_name=row.get("player_name"),
                **_team_award_fields(league_id, row, year_specific=False),
                position=_row_position(row),
                amount=float(row.get("cap_hit") or 0),
                detail="Live roster · best discount vs peers",
                tone="good",
            )
        )

    payroll = max(analytics.get("teams") or [], key=lambda t: float(t.get("committed") or 0), default=None)
    if payroll:
        pt = payroll.get("team_name")
        awards.append(
            ae(
                "payroll_king",
                title="Spent it all",
                headline=f"{fmt_sal_short(float(payroll.get('committed') or 0))} committed",
                roast="Window shopping is over.",
                team_name=pt,
                owner_label=lookup_owner_label(pt, owner_map),
                amount=float(payroll.get("committed") or 0),
                detail="Most cap tied up today",
                tone="gold",
                year_specific=False,
            )
        )

    tightest = min(analytics.get("teams") or [], key=lambda t: float(t.get("unspent") or 0), default=None)
    if tightest and float(tightest.get("unspent") or 0) < salary_cap * 0.15:
        awards.append(
            ae(
                "cap_crunch",
                title="Broke boys",
                headline=f"{fmt_sal_short(float(tightest.get('unspent') or 0))} cap left",
                roast="One injury away from panic.",
                team_name=tightest.get("team_name"),
                owner_label=lookup_owner_label(tightest.get("team_name"), owner_map),
                amount=float(tightest.get("unspent") or 0),
                detail="Tightest cap room in the league",
                tone="bad",
                year_specific=False,
            )
        )

    return _dedupe_awards(awards)


def fmt_sal_short(value: float | None) -> str:
    if value is None:
        return "—"
    return f"${float(value):.0f}"


def _dedupe_awards(awards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for award in awards:
        if award["id"] in seen:
            continue
        seen.add(award["id"])
        out.append(award)
    return out
