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
        t = str(team or "").strip().strip('"')
        if not o or not t:
            continue
        owner_to_team[o] = t
        team_to_owner[t] = o
        team_to_owner[t.lower()] = o
    return owner_to_team, team_to_owner


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


def lookup_owner_label(team_name: str | None, owner_map: dict[str, str] | None) -> str | None:
    """Resolve manager abbrev/name for a hub or Sleeper team label."""
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


def team_owner_map_for_league(league_id: str) -> dict[str, str]:
    """hub team name -> manager label (yaml + latest contract sheet)."""
    _, team_to_owner = _yaml_maps()
    out = dict(team_to_owner)
    try:
        from src.draft_hub import storage
        from src.draft_hub.historic_insights import list_history_seasons

        seasons = list_history_seasons(league_id)
        if seasons:
            latest = max(seasons)
            for row in storage.list_league_contract_rows(league_id, season_year=latest):
                team = str(row.get("hub_team_name") or "").strip()
                owner = str(row.get("owner_label") or "").strip()
                if team and owner and owner.lower() != team.lower():
                    out[team] = owner
                    out[team.lower()] = owner
    except Exception:
        pass
    return out


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
    year_specific: bool = False,
) -> dict[str, Any]:
    """Attach owner_name + display_name; team_name kept only when year-specific."""
    label = owner_label or lookup_owner_label(team_name, owner_map)
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
) -> dict[str, Any]:
    """Add owner_name + display_name; keep team_name for joins."""
    name = str(row.get("team_name") or "").strip()
    owner_label = lookup_owner_label(name, owner_map)
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
