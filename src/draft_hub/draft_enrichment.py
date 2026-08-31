"""Draft room player context — sentiment narratives, headshots, team logos."""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from src.config import BEAT_DIGEST_LLM_ENABLED, OPENAI_API_KEY, PROCESSED_DATA_DIR
from src.core.projection_context import resolve_projection_context
from src.integrations.external_projections import _normalize_name
from src.integrations.sleeper import players_dataframe
from src.sentiment.fantasy_digest import fantasy_digest_for_player
from src.sentiment.fantasy_readout import build_fantasy_index

SLEEPER_HEADSHOT = "https://sleepercdn.com/content/nfl/players/thumb/{sleeper_id}.jpg"
ESPN_HEADSHOT = "https://a.espncdn.com/i/headshots/nfl/players/full/{espn_id}.png"
ESPN_TEAM_LOGO = "https://a.espncdn.com/i/teamlogos/nfl/500/{team}.png"
_GSIS_RE = re.compile(r"^00-\d{7}$")

_SLEEPER_LOOKUP: dict[str, Any] | None = None
_GSIS_IDENTITY_CACHE: tuple[float, dict[str, tuple[str, str]]] | None = None

_TEAM_LOGO_ALIASES = {
    "JAX": "jax",
    "JAC": "jax",
    "LA": "lar",
    "LAR": "lar",
    "WSH": "wsh",
    "WAS": "wsh",
}

# nflverse/pool often uses LA/JAC/WAS; Sleeper uses LAR/JAX/WSH.
_TEAM_LOOKUP_ALIASES = {
    "LA": ("LA", "LAR"),
    "LAR": ("LAR", "LA"),
    "JAC": ("JAC", "JAX"),
    "JAX": ("JAX", "JAC"),
    "WAS": ("WAS", "WSH"),
    "WSH": ("WSH", "WAS"),
}


def team_logo_url(team: str | None) -> str | None:
    abbr = str(team or "").strip().upper()
    if not abbr:
        return None
    slug = _TEAM_LOGO_ALIASES.get(abbr, abbr.lower())
    return ESPN_TEAM_LOGO.format(team=slug)


def _clean_ext_id(val: Any) -> str | None:
    if val is None:
        return None
    if isinstance(val, float):
        if pd.isna(val):
            return None
        if val.is_integer():
            return str(int(val))
        text = str(val).strip()
    elif isinstance(val, int):
        return str(val)
    else:
        text = str(val).strip()
    if not text or text.lower() in {"nan", "none"}:
        return None
    if text.endswith(".0") and text[:-2].isdigit():
        return text[:-2]
    return text


def headshot_url(sleeper_id: str | None, espn_id: str | None = None) -> str | None:
    sid = _clean_ext_id(sleeper_id)
    if sid:
        return SLEEPER_HEADSHOT.format(sleeper_id=sid)
    eid = _clean_ext_id(espn_id)
    if eid:
        return ESPN_HEADSHOT.format(espn_id=eid)
    return None


def espn_headshot_url(espn_id: str | None) -> str | None:
    eid = _clean_ext_id(espn_id)
    if not eid:
        return None
    return ESPN_HEADSHOT.format(espn_id=eid)


def _team_lookup_keys(team: str | None) -> tuple[str, ...]:
    abbr = str(team or "").strip().upper()
    if not abbr:
        return ()
    return _TEAM_LOOKUP_ALIASES.get(abbr, (abbr,))


def _gsis_identity_map() -> dict[str, tuple[str, str]]:
    """GSIS → (name, team) from draft-pool artifacts so ID-only media lookups still resolve."""
    global _GSIS_IDENTITY_CACHE
    try:
        from src.config import DRAFT_POOL_DIR

        paths = sorted(DRAFT_POOL_DIR.glob("pool_*.parquet"))
    except Exception:
        paths = []
    stamp = 0.0
    for path in paths:
        try:
            stamp += path.stat().st_mtime
        except OSError:
            pass
    if _GSIS_IDENTITY_CACHE is not None and _GSIS_IDENTITY_CACHE[0] == stamp:
        return _GSIS_IDENTITY_CACHE[1]
    out: dict[str, tuple[str, str]] = {}
    for path in paths:
        try:
            frame = pd.read_parquet(path, columns=["player_id", "Player", "Team"])
        except Exception:
            continue
        for rec in frame.itertuples(index=False):
            pid = str(getattr(rec, "player_id", "") or "").strip()
            if not _GSIS_RE.match(pid) or pid in out:
                continue
            out[pid] = (
                str(getattr(rec, "Player", "") or "").strip(),
                str(getattr(rec, "Team", "") or "").strip().upper(),
            )
    _GSIS_IDENTITY_CACHE = (stamp, out)
    return out


def _resolve_draft_week(season: int | None, week: int | None) -> tuple[int, int]:
    path = PROCESSED_DATA_DIR / "qb_mlready.parquet"
    df = pd.read_parquet(path, columns=["season", "week", "team"])
    return resolve_projection_context(df, season, week)


def _sleeper_row_for_hint(
    df: pd.DataFrame,
    *,
    player_id: str,
    player_name: str | None,
    team: str | None,
    by_gsis: dict[str, pd.Series],
    by_name_team: dict[tuple[str, str], pd.Series],
    by_sleeper_id: dict[str, pd.Series],
    by_name: dict[str, list[pd.Series]] | None = None,
    sleeper_id: str | None = None,
) -> pd.Series | None:
    pid = str(player_id or "").strip()
    if _GSIS_RE.match(pid) and pid in by_gsis:
        return by_gsis[pid]
    # Hub stores many non-GSIS players as sleeper-{id} (same as years_exp_lookup).
    if pid.startswith("sleeper-"):
        sid = pid.removeprefix("sleeper-").strip()
        if sid and sid in by_sleeper_id:
            return by_sleeper_id[sid]
    if pid.isdigit() and pid in by_sleeper_id:
        return by_sleeper_id[pid]
    extra_sid = _clean_ext_id(sleeper_id) or ""
    if extra_sid.startswith("sleeper-"):
        extra_sid = extra_sid.removeprefix("sleeper-")
    if extra_sid and extra_sid in by_sleeper_id:
        return by_sleeper_id[extra_sid]

    name = str(player_name or "").strip()
    tm = str(team or "").strip().upper()
    if (not name or not tm) and _GSIS_RE.match(pid):
        ident = _gsis_identity_map().get(pid)
        if ident:
            name = name or ident[0]
            tm = tm or ident[1]

    nkey = _normalize_name(name) if name else ""
    if nkey:
        for alias in _team_lookup_keys(tm):
            hit = by_name_team.get((nkey, alias))
            if hit is not None:
                return hit
        named = (by_name or {}).get(nkey) or []
        if not named:
            named = [row for (nk, _tk), row in by_name_team.items() if nk == nkey]
        if len(named) == 1:
            return named[0]
        if tm:
            aliases = set(_team_lookup_keys(tm))
            for row in named:
                row_team = str(row.get("team") or "").strip().upper()
                if row_team in aliases:
                    return row
        if named:
            return named[0]
    return None


def _sleeper_lookup_tables() -> tuple[
    pd.DataFrame,
    dict[str, pd.Series],
    dict[str, pd.Series],
    dict[tuple[str, str], pd.Series],
    dict[str, list[pd.Series]],
]:
    global _SLEEPER_LOOKUP
    if _SLEEPER_LOOKUP is not None:
        cached = _SLEEPER_LOOKUP
        if "by_name" not in cached:
            _SLEEPER_LOOKUP = None
        else:
            return (
                cached["df"],
                cached["by_gsis"],
                cached["by_sleeper_id"],
                cached["by_name_team"],
                cached["by_name"],
            )

    df = players_dataframe()
    by_gsis: dict[str, pd.Series] = {}
    by_sleeper_id: dict[str, pd.Series] = {}
    by_name_team: dict[tuple[str, str], pd.Series] = {}
    by_name: dict[str, list[pd.Series]] = {}
    for _, row in df.iterrows():
        sid = _clean_ext_id(row.get("sleeper_id")) or ""
        if sid:
            by_sleeper_id[sid] = row
        gsis = str(row.get("gsis_id") or "").strip()
        if _GSIS_RE.match(gsis):
            by_gsis[gsis] = row
        name = str(row.get("full_name") or "").strip()
        team = str(row.get("team") or "").strip().upper()
        if name:
            nkey = _normalize_name(name)
            by_name_team[(nkey, team)] = row
            by_name.setdefault(nkey, []).append(row)
    _SLEEPER_LOOKUP = {
        "df": df,
        "by_gsis": by_gsis,
        "by_sleeper_id": by_sleeper_id,
        "by_name_team": by_name_team,
        "by_name": by_name,
    }
    return df, by_gsis, by_sleeper_id, by_name_team, by_name


def _media_for_players(
    players: list[dict[str, Any]] | None,
) -> dict[str, dict[str, str | None]]:
    if not players:
        return {}

    df, by_gsis, by_sleeper_id, by_name_team, by_name = _sleeper_lookup_tables()

    out: dict[str, dict[str, str | None]] = {}
    for hint in players:
        pid = str(hint.get("player_id") or "").strip()
        if not pid:
            continue
        row = _sleeper_row_for_hint(
            df,
            player_id=pid,
            player_name=hint.get("player_name"),
            team=hint.get("team"),
            by_gsis=by_gsis,
            by_name_team=by_name_team,
            by_sleeper_id=by_sleeper_id,
            by_name=by_name,
            sleeper_id=hint.get("sleeper_id") or hint.get("sleeper_player_id"),
        )
        team = str(hint.get("team") or (row.get("team") if row is not None else "") or "").upper()
        if row is not None:
            sleeper_id = _clean_ext_id(row.get("sleeper_id"))
            espn_id = _clean_ext_id(row.get("espn_id"))
            out[pid] = {
                "headshot_url": headshot_url(sleeper_id, espn_id),
                "espn_headshot_url": espn_headshot_url(espn_id),
                "team_logo_url": team_logo_url(team),
                "team": team,
                "sleeper_id": sleeper_id,
                # Locker-room jerseys and player chrome read this when present.
                "jersey_number": _clean_ext_id(row.get("number")),
            }
        else:
            out[pid] = {
                "headshot_url": None,
                "espn_headshot_url": None,
                "team_logo_url": team_logo_url(team) if team else None,
                "team": team or None,
                "sleeper_id": None,
                "jersey_number": None,
            }
    return out


def build_player_media_batch(players: list[dict[str, Any]]) -> dict[str, dict[str, str | None]]:
    """Public batch headshot/team logo lookup for hub UI."""
    return _media_for_players(players)


def _attach_digests(
    sentiment_players: dict[str, dict],
    hints: list[dict[str, Any]],
    *,
    season: int,
    week: int,
    llm_player_ids: set[str] | None = None,
) -> dict[str, dict]:
    name_by_id = {str(h["player_id"]): str(h.get("player_name") or "") for h in hints if h.get("player_id")}
    llm_ids = llm_player_ids or set()
    target_ids = {str(h["player_id"]) for h in hints if h.get("player_id")}
    if not target_ids:
        return {}

    out: dict[str, dict] = {}
    for pid in target_ids:
        row = sentiment_players.get(pid)
        if not row:
            continue
        enriched = dict(row)
        pname = name_by_id.get(pid) or row.get("player") or pid
        enriched["fantasy_media_digest"] = fantasy_digest_for_player(
            pname,
            row,
            scope="weekly",
            player_id=str(pid),
            season=season,
            week=week,
            prefer_llm=str(pid) in llm_ids,
        )
        out[pid] = enriched
    return out


def build_draft_room_enrichment(
    *,
    season: int | None = None,
    week: int | None = None,
    players: list[dict[str, Any]] | None = None,
    llm_player_ids: list[str] | None = None,
    media_only: bool = False,
) -> dict[str, Any]:
    hints = players or []
    media = _media_for_players(hints)
    teams: dict[str, str] = {}
    for info in media.values():
        team = info.get("team")
        if team:
            url = team_logo_url(str(team))
            if url:
                teams[str(team).upper()] = url
    if media_only:
        return {
            "season": season,
            "week": week,
            "requested_season": season,
            "requested_week": week,
            "context_fallback": False,
            "media_context": None,
            "sentiment_by_player_id": {},
            "media_by_player_id": media,
            "team_logo_by_team": teams,
            "llm_available": False,
        }

    resolved_season, resolved_week = _resolve_draft_week(season, week)
    sentiment = build_fantasy_index(resolved_season, resolved_week)
    llm_set = set(str(p) for p in (llm_player_ids or []))

    sentiment_players = _attach_digests(
        sentiment["players"],
        hints,
        season=sentiment["season"],
        week=sentiment["week"],
        llm_player_ids=llm_set,
    )

    return {
        "season": sentiment["season"],
        "week": sentiment["week"],
        "requested_season": sentiment["requested_season"],
        "requested_week": sentiment["requested_week"],
        "context_fallback": sentiment["context_fallback"],
        "media_context": sentiment.get("media_context"),
        "sentiment_by_player_id": sentiment_players,
        "media_by_player_id": media,
        "team_logo_by_team": teams,
        "llm_available": bool(BEAT_DIGEST_LLM_ENABLED and OPENAI_API_KEY.strip()),
    }


def fantasy_media_digest_single(
    player_id: str,
    *,
    player_name: str | None = None,
    season: int | None = None,
    week: int | None = None,
) -> dict[str, Any]:
    """Return fantasy-show media digest for one draft-room player (not beat reporting)."""
    resolved_season, resolved_week = _resolve_draft_week(season, week)
    sentiment = build_fantasy_index(resolved_season, resolved_week)
    row = sentiment["players"].get(str(player_id))
    if not row:
        return {"player_id": player_id, "fantasy_media_digest": None}
    pname = player_name or row.get("player") or player_id
    digest_result = fantasy_digest_for_player(
        str(pname),
        row,
        scope="weekly",
        player_id=str(player_id),
        season=sentiment["season"],
        week=sentiment["week"],
        prefer_llm=True,
        return_meta=True,
    )
    return {
        "player_id": player_id,
        "fantasy_media_digest": digest_result["fantasy_media_digest"],
        "fantasy_media_digest_source": digest_result.get("fantasy_media_digest_source"),
        "season": sentiment["season"],
        "week": sentiment["week"],
    }
