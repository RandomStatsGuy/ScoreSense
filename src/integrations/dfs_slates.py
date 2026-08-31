"""Live DFS slate discovery and salary fetch (DraftKings + optional FanDuel)."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import requests

from src.config import CACHE_DIR
from src.products.dfs_salaries import _normalize_dfs_position
from src.integrations.external_projections import _normalize_name

DFS_CACHE_DIR = CACHE_DIR / "dfs"
DK_LOBBY_URL = "https://www.draftkings.com/lobby/getcontests"
DK_DRAFTABLES_URL = "https://api.draftkings.com/draftgroups/v1/draftgroups/{draft_group_id}/draftables"
FD_FIXTURE_LISTS_URL = "https://api.fanduel.com/fixture-lists"
FD_PLAYERS_URL = "https://api.fanduel.com/fixture-lists/{fixture_id}/players"

SLATE_CATEGORIES = ("main", "primetime", "showdown", "all")
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

_CATEGORY_KEYWORDS = {
    "showdown": ("showdown", "captain"),
    "primetime": ("primetime", "monday night", "sunday night", "thursday night", "snf", "mnf", "tnf"),
}


def fanduel_auth_configured() -> bool:
    return bool(os.getenv("FANDUEL_AUTH_TOKEN", "").strip())


def _fd_headers() -> dict[str, str]:
    headers = dict(REQUEST_HEADERS)
    token = os.getenv("FANDUEL_AUTH_TOKEN", "").strip()
    if token:
        headers["X-Auth-Token"] = token
    auth = os.getenv("FANDUEL_AUTHORIZATION", "").strip()
    if auth:
        headers["Authorization"] = auth if auth.lower().startswith("basic ") else f"Basic {auth}"
    return headers


def _cache_path(site: str, slate_id: str) -> Any:
    DFS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return DFS_CACHE_DIR / f"{site.lower()}_{slate_id}_salaries.parquet"


def _cache_meta_path(site: str, slate_id: str) -> Any:
    DFS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return DFS_CACHE_DIR / f"{site.lower()}_{slate_id}_meta.json"


def _classify_dk_group(
    game_type: str,
    name: str,
    *,
    game_count: int = 0,
    suffix: str = "",
) -> str:
    gt = (game_type or "").lower()
    label = f"{name or ''} {suffix or ''}".lower()
    if "best ball" in gt or "snake" in gt:
        return "skip"
    if "madden" in gt or "madden" in label:
        return "madden"
    if any(k in gt for k in _CATEGORY_KEYWORDS["showdown"]) or "showdown" in label:
        return "showdown"
    if any(k in label for k in _CATEGORY_KEYWORDS["primetime"]):
        return "primetime"
    if game_count and game_count <= 3 and "classic" in gt:
        return "primetime"
    if "classic" in gt or (game_count and game_count >= 8):
        return "main"
    if "classic" in label:
        return "main"
    return "other"


def _is_madden(game_type: str, name: str) -> bool:
    gt = (game_type or "").lower()
    label = (name or "").lower()
    return "madden" in gt or "madden" in label


def _dk_game_type_names(payload: dict) -> dict[int, str]:
    out: dict[int, str] = {}
    for entry in payload.get("GameTypes") or []:
        if not isinstance(entry, dict):
            continue
        gid = entry.get("GameTypeId")
        name = str(entry.get("Name") or "")
        if gid is None or not name:
            continue
        try:
            out[int(gid)] = name
        except (TypeError, ValueError):
            continue
    return out


def _dk_slate_label(game_type: str, game_count: int, suffix: str) -> str:
    base = (game_type or "Classic").strip() or "Classic"
    if game_count > 0:
        games = f"{game_count} game" if game_count == 1 else f"{game_count} games"
        label = f"{base} · {games}"
    else:
        label = base
    extra = (suffix or "").strip()
    if extra:
        if not extra.startswith("(") and not extra.startswith("·"):
            extra = extra if extra.startswith("(") else extra
        label = f"{label} {extra}".strip()
    return label


def parse_dk_lobby_slates(payload: dict, category: str = "all") -> list[dict]:
    """Turn a DraftKings lobby JSON payload into ScoreSense slate rows.

    DraftGroups is the source of truth (game count, start suffix, type id).
    Contests fill contest_count. Salaries are not fetched here.
    """
    type_names = _dk_game_type_names(payload)
    contests = payload.get("Contests") or []
    contest_by_dg: dict[str, dict] = {}
    for contest in contests:
        if not isinstance(contest, dict):
            continue
        draft_group_id = str(contest.get("dg") or "")
        if not draft_group_id:
            continue
        game_type = str(contest.get("gameType") or "")
        name = str(contest.get("n") or "")
        entry = contest_by_dg.setdefault(
            draft_group_id,
            {
                "name": name,
                "game_type": game_type,
                "contest_count": 0,
            },
        )
        entry["contest_count"] += 1
        if len(name) > len(entry.get("name") or ""):
            entry["name"] = name
        if game_type and not entry.get("game_type"):
            entry["game_type"] = game_type

    grouped: dict[str, dict] = {}
    for group in payload.get("DraftGroups") or []:
        if not isinstance(group, dict):
            continue
        draft_group_id = str(group.get("DraftGroupId") or "")
        if not draft_group_id:
            continue
        game_type_id = group.get("GameTypeId") or group.get("ContestTypeId")
        try:
            game_type_id_i = int(game_type_id) if game_type_id is not None else 0
        except (TypeError, ValueError):
            game_type_id_i = 0
        game_type = type_names.get(game_type_id_i) or str(group.get("GameType") or "")
        contest_meta = contest_by_dg.get(draft_group_id) or {}
        if not game_type:
            game_type = str(contest_meta.get("game_type") or "")
        suffix = str(group.get("ContestStartTimeSuffix") or "")
        try:
            game_count = int(group.get("GameCount") or 0)
        except (TypeError, ValueError):
            game_count = 0
        contest_name = str(contest_meta.get("name") or "")
        slate_category = _classify_dk_group(
            game_type,
            contest_name,
            game_count=game_count,
            suffix=suffix,
        )
        if slate_category in {"skip", "madden"}:
            continue
        grouped[draft_group_id] = {
            "slate_id": draft_group_id,
            "site": "draftkings",
            "name": _dk_slate_label(game_type, game_count, suffix),
            "game_type": game_type or contest_name,
            "category": slate_category,
            "contest_count": int(contest_meta.get("contest_count") or 0),
            "game_count": game_count,
            "start_suffix": suffix.strip() or None,
            "is_madden": False,
            "offseason_placeholder": False,
        }

    # Contest groups that never appeared in DraftGroups (older lobby shapes).
    for draft_group_id, contest_meta in contest_by_dg.items():
        if draft_group_id in grouped:
            continue
        game_type = str(contest_meta.get("game_type") or "")
        name = str(contest_meta.get("name") or "")
        slate_category = _classify_dk_group(game_type, name)
        if slate_category in {"skip", "madden"}:
            continue
        grouped[draft_group_id] = {
            "slate_id": draft_group_id,
            "site": "draftkings",
            "name": name or game_type or draft_group_id,
            "game_type": game_type,
            "category": slate_category,
            "contest_count": int(contest_meta.get("contest_count") or 0),
            "game_count": 0,
            "start_suffix": None,
            "is_madden": _is_madden(game_type, name),
            "offseason_placeholder": _is_madden(game_type, name),
        }

    nfl_slates = [s for s in grouped.values() if not s.get("is_madden")]
    if category != "all":
        nfl_slates = [s for s in nfl_slates if s["category"] == category]
        if not nfl_slates and category == "main":
            nfl_slates = [s for s in grouped.values() if s.get("category") in {"main", "other"}]

    nfl_slates.sort(
        key=lambda s: (
            int(s.get("game_count") or 0),
            int(s.get("contest_count") or 0),
        ),
        reverse=True,
    )
    return nfl_slates


def _dk_get(url: str, params: dict | None = None) -> dict:
    response = requests.get(url, params=params, headers=REQUEST_HEADERS, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected DraftKings payload type: {type(payload)}")
    return payload


def _fd_get(url: str) -> dict:
    response = requests.get(url, headers=_fd_headers(), timeout=30)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected FanDuel payload type: {type(payload)}")
    return payload


def parse_dk_draftables(payload: dict, site: str = "draftkings") -> pd.DataFrame:
    """Normalize DraftKings draftables JSON to salary frame."""
    rows: list[dict] = []
    for entry in payload.get("draftables") or []:
        if not isinstance(entry, dict):
            continue
        if entry.get("isDisabled"):
            continue
        salary = entry.get("salary")
        try:
            salary = int(salary)
        except (TypeError, ValueError):
            continue
        if salary <= 0:
            continue

        name = (
            entry.get("displayName")
            or f"{entry.get('firstName', '')} {entry.get('lastName', '')}".strip()
        )
        team = (
            entry.get("teamAbbreviation")
            or entry.get("team")
            or ""
        )
        pos = _normalize_dfs_position(str(entry.get("position") or ""))
        dfs_id = str(entry.get("draftableId") or entry.get("playerDkId") or entry.get("playerId") or "")

        rows.append(
            {
                "dfs_id": dfs_id,
                "player_name": name,
                "name_key": _normalize_name(name),
                "position": pos,
                "team": str(team).upper(),
                "salary": salary,
                "site": site.lower(),
            }
        )
    return pd.DataFrame(rows)


def parse_fd_players(payload: dict, site: str = "fanduel") -> pd.DataFrame:
    """Normalize FanDuel fixture players JSON to salary frame."""
    rows: list[dict] = []
    for entry in payload.get("players") or []:
        if not isinstance(entry, dict):
            continue
        salary = entry.get("salary") or entry.get("salary_cap")
        try:
            salary = int(salary)
        except (TypeError, ValueError):
            continue
        if salary <= 0:
            continue

        name = entry.get("name") or entry.get("display_name") or entry.get("full_name") or ""
        team_obj = entry.get("team") or {}
        if isinstance(team_obj, dict):
            team = team_obj.get("abbreviation") or team_obj.get("code") or team_obj.get("name") or ""
        else:
            team = str(team_obj)

        positions = entry.get("positions") or entry.get("position") or []
        if isinstance(positions, list):
            pos_raw = positions[0] if positions else ""
        else:
            pos_raw = str(positions)
        pos = _normalize_dfs_position(str(pos_raw))

        rows.append(
            {
                "dfs_id": str(entry.get("id") or ""),
                "player_name": name,
                "name_key": _normalize_name(name),
                "position": pos,
                "team": str(team).upper(),
                "salary": salary,
                "site": site.lower(),
            }
        )
    return pd.DataFrame(rows)


def _classify_fd_slate(fixture: dict) -> str:
    label = str(fixture.get("name") or fixture.get("label") or "").lower()
    slate_type = str(fixture.get("salary_cap") or fixture.get("game_description") or "").lower()
    combined = f"{label} {slate_type}"
    if any(k in combined for k in _CATEGORY_KEYWORDS["showdown"]):
        return "showdown"
    if any(k in combined for k in _CATEGORY_KEYWORDS["primetime"]):
        return "primetime"
    return "main"


def list_dk_slates(category: str = "all", sport: str = "NFL") -> list[dict]:
    payload = _dk_get(DK_LOBBY_URL, params={"sport": sport})
    if not isinstance(payload, dict):
        raise ValueError(f"Unexpected DraftKings payload type: {type(payload)}")
    return parse_dk_lobby_slates(payload, category=category)


def list_fd_slates(category: str = "all") -> list[dict]:
    if not fanduel_auth_configured():
        return []

    payload = _fd_get(FD_FIXTURE_LISTS_URL)
    fixtures = payload.get("fixture_lists") or []
    slates: list[dict] = []
    for fixture in fixtures:
        if not isinstance(fixture, dict):
            continue
        sport = str(fixture.get("sport") or fixture.get("sport_name") or "").upper()
        if sport and sport not in ("NFL", "FOOTBALL", "AMERICAN_FOOTBALL"):
            continue
        slate_id = str(fixture.get("id") or "")
        if not slate_id:
            continue
        slate_category = _classify_fd_slate(fixture)
        if category != "all" and slate_category != category:
            continue
        name = str(fixture.get("name") or fixture.get("label") or f"FanDuel {slate_id}")
        player_count = 0
        try:
            player_count = len(fetch_fd_salaries(slate_id, use_cache=True))
        except Exception:
            pass
        slates.append(
            {
                "slate_id": slate_id,
                "site": "fanduel",
                "name": name,
                "game_type": str(fixture.get("game_description") or "Classic"),
                "category": slate_category,
                "contest_count": int((fixture.get("contests") or {}).get("open", 0) or 0),
                "player_count": player_count,
                "offseason_placeholder": False,
            }
        )

    slates.sort(key=lambda s: (s.get("player_count", 0), s.get("contest_count", 0)), reverse=True)
    return slates


def list_slates(site: str, category: str = "all", sport: str = "NFL") -> list[dict]:
    site = site.lower()
    category = category if category in SLATE_CATEGORIES else "all"
    if site == "draftkings":
        return list_dk_slates(category=category, sport=sport)
    if site == "fanduel":
        return list_fd_slates(category=category)
    raise ValueError("site must be draftkings or fanduel")


def pick_default_slate(site: str, category: str = "main") -> dict | None:
    slates = list_slates(site, category=category)
    if slates:
        return slates[0]
    if category != "all":
        return pick_default_slate(site, category="all")
    return None


def fetch_dk_salaries(
    draft_group_id: str,
    *,
    use_cache: bool = True,
    force_refresh: bool = False,
) -> pd.DataFrame:
    cache = _cache_path("draftkings", draft_group_id)
    if use_cache and cache.exists() and not force_refresh:
        cached = pd.read_parquet(cache)
        if not cached.empty:
            return cached

    payload = _dk_get(DK_DRAFTABLES_URL.format(draft_group_id=draft_group_id))
    salaries = parse_dk_draftables(payload, site="draftkings")
    if not salaries.empty:
        salaries.to_parquet(cache, index=False)
        _cache_meta_path("draftkings", draft_group_id).write_text(
            json.dumps(
                {
                    "site": "draftkings",
                    "slate_id": draft_group_id,
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "player_count": len(salaries),
                },
                indent=2,
            )
        )
    return salaries


def fetch_fd_salaries(
    fixture_id: str,
    *,
    use_cache: bool = True,
    force_refresh: bool = False,
) -> pd.DataFrame:
    if not fanduel_auth_configured():
        raise RuntimeError(
            "FANDUEL_AUTH_TOKEN is not set. Add it to .env or import a FanDuel salary CSV."
        )

    cache = _cache_path("fanduel", fixture_id)
    if use_cache and cache.exists() and not force_refresh:
        cached = pd.read_parquet(cache)
        if not cached.empty:
            return cached

    payload = _fd_get(FD_PLAYERS_URL.format(fixture_id=fixture_id))
    salaries = parse_fd_players(payload, site="fanduel")
    if not salaries.empty:
        salaries.to_parquet(cache, index=False)
        _cache_meta_path("fanduel", fixture_id).write_text(
            json.dumps(
                {
                    "site": "fanduel",
                    "slate_id": fixture_id,
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                    "player_count": len(salaries),
                },
                indent=2,
            )
        )
    return salaries


def fetch_slate_salaries(
    site: str,
    slate_id: str,
    *,
    use_cache: bool = True,
    force_refresh: bool = False,
) -> pd.DataFrame:
    site = site.lower()
    if site == "draftkings":
        return fetch_dk_salaries(slate_id, use_cache=use_cache, force_refresh=force_refresh)
    if site == "fanduel":
        return fetch_fd_salaries(slate_id, use_cache=use_cache, force_refresh=force_refresh)
    raise ValueError("site must be draftkings or fanduel")


def prefetch_main_slate_salaries(site: str = "draftkings", category: str = "main") -> dict:
    """Cache the default slate salaries (used by weekly refresh)."""
    slate = pick_default_slate(site, category=category)
    if not slate:
        return {"status": "skipped", "reason": "no_slate_found", "site": site}
    try:
        salaries = fetch_slate_salaries(site, slate["slate_id"], force_refresh=True)
    except Exception as exc:
        return {"status": "error", "site": site, "slate_id": slate["slate_id"], "detail": str(exc)}
    return {
        "status": "ok",
        "site": site,
        "slate_id": slate["slate_id"],
        "name": slate.get("name"),
        "player_count": len(salaries),
        "offseason_placeholder": slate.get("offseason_placeholder", False),
    }


def prefetch_all_main_slates() -> dict:
    results = {}
    for site in ("draftkings", "fanduel"):
        if site == "fanduel" and not fanduel_auth_configured():
            results[site] = {"status": "skipped", "reason": "FANDUEL_AUTH_TOKEN not set"}
            continue
        results[site] = prefetch_main_slate_salaries(site=site, category="main")
        time.sleep(0.5)
    return results
