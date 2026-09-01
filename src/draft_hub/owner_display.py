"""Manager (owner) labels vs dynasty team names for awards and stats."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from src.config import MANAGER_TEAM_MAP_PATH


@lru_cache(maxsize=1)
def _yaml_maps() -> tuple[dict[str, str], dict[str, str]]:
    """owner_label -> hub team name, and reverse team -> owner."""
    owner_to_team: dict[str, str] = {}
    team_to_owner: dict[str, str] = {}
    path = MANAGER_TEAM_MAP_PATH
    if not path.exists():
        return owner_to_team, team_to_owner
    import yaml

    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        return owner_to_team, team_to_owner
    for owner, team in raw.items():
        o = str(owner or "").strip()
        if o.startswith("_") or not isinstance(team, str):
            continue
        t = str(team or "").strip().strip('"')
        if not o or not t:
            continue
        owner_to_team[o] = t
        team_to_owner[t] = o
        team_to_owner[t.lower()] = o
    return owner_to_team, team_to_owner


# Unique former Sleeper names that are not a current franchise label.
_HISTORIC_TEAM_OWNERS = {
    "lincoler's dual ethics": "Justin P",
    f"lincoler{chr(8217)}s dual ethics": "Justin P",
    "daddio of the pandio": "Colby L",
}


def _fuzzy_yaml_owner(team_name: str) -> str | None:
    """Match Sleeper/hub names onto cap-sheet team labels (e.g. Dual Ethics)."""
    name = str(team_name or "").strip()
    if not name:
        return None
    _, team_to_owner = _yaml_maps()
    if name in team_to_owner:
        return team_to_owner[name]
    lower = name.lower()
    if lower in team_to_owner:
        return team_to_owner[lower]
    historic = _HISTORIC_TEAM_OWNERS.get(lower)
    if historic:
        return historic

    best_owner: str | None = None
    best_len = 0
    for yaml_team, owner in team_to_owner.items():
        if yaml_team == yaml_team.lower() and yaml_team not in {lower, name}:
            continue
        yt = yaml_team.lower()
        if len(yt) < 5:
            continue
        if yt in lower or lower in yt:
            if len(yt) > best_len:
                best_len = len(yt)
                best_owner = owner
    return best_owner


def lookup_owner_label(
    team_name: str | None,
    owner_map: dict[str, str] | None,
    *,
    sleeper_user_id: str | None = None,
    sleeper_owner_map: dict[str, str] | None = None,
) -> str | None:
    """Resolve manager abbrev/name for a hub or Sleeper team label."""
    if sleeper_user_id and sleeper_owner_map:
        hit = sleeper_owner_map.get(str(sleeper_user_id))
        if hit:
            return hit
    name = str(team_name or "").strip()
    if not name:
        return None
    if owner_map:
        hit = owner_map.get(name) or owner_map.get(name.lower())
        if hit and hit.lower() != name.lower():
            return hit
    fuzzy = _fuzzy_yaml_owner(name)
    if fuzzy and fuzzy.lower() != name.lower():
        return fuzzy
    return None


def resolve_owner(team_name: str | None, owner_label: str | None = None) -> str:
    """Best manager name for a hub/Sleeper team."""
    owner = str(owner_label or "").strip()
    team = str(team_name or "").strip()
    if owner and (not team or owner.lower() != team.lower()):
        return owner
    fuzzy = _fuzzy_yaml_owner(team)
    if fuzzy:
        return fuzzy
    _, team_to_owner = _yaml_maps()
    if team:
        return team_to_owner.get(team) or team_to_owner.get(team.lower()) or team
    return owner or team or "Unknown"


def format_manager_label(
    team_name: str | None,
    *,
    owner_label: str | None = None,
    year_specific: bool = False,
) -> str:
    """Current stats: owner only. Year-specific history: owner · team."""
    team = str(team_name or "").strip()
    owner = resolve_owner(team, owner_label)
    if year_specific and team and owner.lower() != team.lower():
        return f"{owner} · {team}"
    return owner


def team_owner_map_for_league(
    league_id: str,
    season_year: int | str | None = None,
) -> dict[str, str]:
    """Hub / Sleeper team name -> manager label for one season (default: latest)."""
    team_map, _ = scoring_owner_maps_for_league(league_id, season_year=season_year)
    return team_map


def scoring_owner_maps_for_league(
    league_id: str,
    *,
    season_year: int | str | None = None,
    sleeper_league_id: str | None = None,
) -> tuple[dict[str, str], dict[str, str]]:
    """
    Build lookups for scoring awards: team display name -> owner, Sleeper user_id -> owner.
    """
    from src.draft_hub import storage
    from src.draft_hub.historic_insights import list_history_seasons

    _, yaml_team_to_owner = _yaml_maps()
    team_map: dict[str, str] = dict(yaml_team_to_owner)
    sleeper_map: dict[str, str] = {}

    seasons = list_history_seasons(league_id)
    yr: int | None = None
    if season_year is not None and str(season_year).isdigit():
        yr = int(season_year)
    elif seasons:
        yr = max(seasons)

    if yr is not None:
        storage.ensure_owner_season_map_seeded(league_id)
        apply_yr = yr
        map_rows = storage.list_owner_season_map(league_id, season_year=yr)
        contract_rows = storage.list_league_contract_rows(league_id, season_year=yr)
        if not map_rows and not contract_rows and seasons:
            prior = [int(s) for s in seasons if int(s) != yr]
            if prior:
                apply_yr = max(prior)
                map_rows = storage.list_owner_season_map(league_id, season_year=apply_yr)
                contract_rows = storage.list_league_contract_rows(
                    league_id, season_year=apply_yr
                )
        owner_season_teams: set[str] = set()
        for row in map_rows:
            owner = str(row.get("owner_label") or "").strip()
            team = str(row.get("hub_team_name") or "").strip()
            source = str(row.get("source_kind") or "").strip()
            if team and owner:
                team_map[team] = owner
                team_map[team.lower()] = owner
                # yaml_seed is a stale fallback — contract rows may overwrite it.
                if source != "yaml_seed":
                    owner_season_teams.add(team)
                    owner_season_teams.add(team.lower())
            uid = str(row.get("sleeper_user_id") or "").strip()
            if uid and owner:
                sleeper_map[uid] = owner
        for row in contract_rows:
            team = str(row.get("hub_team_name") or "").strip()
            owner = str(row.get("owner_label") or "").strip()
            if not team or not owner or owner.lower() == team.lower():
                continue
            if team in owner_season_teams or team.lower() in owner_season_teams:
                continue
            team_map[team] = owner
            team_map[team.lower()] = owner
        yr = apply_yr

    if sleeper_league_id:
        try:
            from src.integrations.sleeper_league import list_league_teams

            for t in list_league_teams(str(sleeper_league_id)).get("teams") or []:
                uid = str(t.get("user_id") or "").strip()
                stname = str(t.get("team_name") or "").strip()
                if not uid:
                    continue
                if uid in sleeper_map:
                    if stname:
                        team_map[stname] = sleeper_map[uid]
                        team_map[stname.lower()] = sleeper_map[uid]
                    continue
                owner = team_map.get(stname) or team_map.get(stname.lower())
                if not owner and yr is not None:
                    for row in storage.list_owner_season_map(league_id, season_year=yr):
                        hub_team = str(row.get("hub_team_name") or "").strip()
                        label = str(row.get("owner_label") or "").strip()
                        if not hub_team or not label:
                            continue
                        ht = hub_team.lower()
                        sn = stname.lower()
                        if ht == sn or ht in sn or sn in ht:
                            owner = label
                            break
                if owner:
                    sleeper_map[uid] = owner
                    if stname:
                        team_map[stname] = owner
                        team_map[stname.lower()] = owner
        except Exception:
            pass

    return team_map, sleeper_map


def planning_season_for_user(user_sub: str, league: dict[str, Any] | None = None) -> str:
    """Planning year for year-specific labels — league season in shared leagues."""
    if league and league.get("season"):
        return str(league["season"])
    try:
        from src.draft_hub import storage

        ws = storage.get_or_create_workspace(user_sub)
        if ws.get("season"):
            return str(ws["season"])
    except Exception:
        pass
    return ""


def scoring_year_specific(display_season: str, planning_season: str) -> bool:
    """Historical scoring season vs current planning year."""
    if not display_season or not planning_season:
        return False
    return str(display_season) != str(planning_season)


def enrich_award_display(
    award: dict[str, Any],
    *,
    team_name: str | None,
    owner_label: str | None = None,
    owner_map: dict[str, str] | None = None,
    sleeper_owner_map: dict[str, str] | None = None,
    sleeper_user_id: str | None = None,
    year_specific: bool = False,
) -> dict[str, Any]:
    """Attach owner_name + display_name; team_name kept only when year-specific."""
    label = owner_label or lookup_owner_label(
        team_name,
        owner_map,
        sleeper_user_id=sleeper_user_id,
        sleeper_owner_map=sleeper_owner_map,
    )
    owner = resolve_owner(team_name, label)
    display = format_manager_label(team_name, owner_label=owner, year_specific=year_specific)
    out = dict(award)
    out["owner_name"] = owner
    out["display_name"] = display
    if year_specific:
        out["team_name"] = str(team_name or "").strip() or None
    else:
        out["team_name"] = None
    return out


def enrich_team_row(
    row: dict[str, Any],
    owner_map: dict[str, str] | None,
    *,
    year_specific: bool = False,
    sleeper_owner_map: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Add owner_name + display_name; keep team_name for joins."""
    name = str(row.get("team_name") or "").strip()
    owner_id = str(row.get("owner_id") or "").strip() or None
    owner_label = lookup_owner_label(
        name,
        owner_map,
        sleeper_user_id=owner_id,
        sleeper_owner_map=sleeper_owner_map,
    )
    owner = resolve_owner(name, owner_label)
    out = dict(row)
    out["owner_name"] = owner
    out["display_name"] = format_manager_label(name, owner_label=owner, year_specific=year_specific)
    return out


def label_team(
    team_name: str | None,
    owner_map: dict[str, str] | None,
    *,
    year_specific: bool,
) -> str:
    owner_label = lookup_owner_label(team_name, owner_map)
    return format_manager_label(team_name, owner_label=owner_label, year_specific=year_specific)


def attach_owner_names_to_teams(
    league_id: str,
    teams: list[dict[str, Any]],
    *,
    season_year: int | str | None = None,
) -> list[dict[str, Any]]:
    """Set owner_name on hub team dicts. Team nicknames stay on name / sleeper_team_name."""
    if not league_id or not teams:
        return teams
    owner_map = team_owner_map_for_league(league_id, season_year=season_year)
    for team in teams:
        team_name = str(
            team.get("sleeper_team_name") or team.get("name") or team.get("team_name") or ""
        ).strip()
        owner = lookup_owner_label(team_name, owner_map)
        if not owner:
            resolved = resolve_owner(team_name, team.get("owner_label") or team.get("owner_name"))
            if resolved and resolved.lower() != team_name.lower():
                owner = resolved
        if owner:
            team["owner_name"] = owner
    return teams
