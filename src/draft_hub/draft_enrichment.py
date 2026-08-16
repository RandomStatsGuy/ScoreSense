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

_TEAM_LOGO_ALIASES = {
    "JAX": "jax",
    "JAC": "jax",
    "LA": "lar",
    "LAR": "lar",
    "WSH": "wsh",
    "WAS": "wsh",
}


def team_logo_url(team: str | None) -> str | None:
    abbr = str(team or "").strip().upper()
    if not abbr:
        return None
    slug = _TEAM_LOGO_ALIASES.get(abbr, abbr.lower())
    return ESPN_TEAM_LOGO.format(team=slug)


def headshot_url(sleeper_id: str | None, espn_id: str | None = None) -> str | None:
    if sleeper_id:
        return SLEEPER_HEADSHOT.format(sleeper_id=str(sleeper_id))
    if espn_id:
        return ESPN_HEADSHOT.format(espn_id=str(espn_id))
    return None


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
    name = str(player_name or "").strip()
    tm = str(team or "").strip().upper()
    if name and tm:
        hit = by_name_team.get((_normalize_name(name), tm))
        if hit is not None:
            return hit
    if name:
        for (nkey, tkey), row in by_name_team.items():
            if nkey == _normalize_name(name) and (not tm or tkey == tm):
                return row
    return None


def _sleeper_lookup_tables() -> tuple[pd.DataFrame, dict[str, pd.Series], dict[str, pd.Series], dict[tuple[str, str], pd.Series]]:
    global _SLEEPER_LOOKUP
    if _SLEEPER_LOOKUP is not None:
        cached = _SLEEPER_LOOKUP
        return cached["df"], cached["by_gsis"], cached["by_sleeper_id"], cached["by_name_team"]

    df = players_dataframe()
    by_gsis: dict[str, pd.Series] = {}
    by_sleeper_id: dict[str, pd.Series] = {}
    by_name_team: dict[tuple[str, str], pd.Series] = {}
    for _, row in df.iterrows():
        sid = str(row.get("sleeper_id") or "")
        if sid:
            by_sleeper_id[sid] = row
        gsis = str(row.get("gsis_id") or "").strip()
        if _GSIS_RE.match(gsis):
            by_gsis[gsis] = row
        name = str(row.get("full_name") or "").strip()
        team = str(row.get("team") or "").upper()
        if name:
            by_name_team[(_normalize_name(name), team)] = row
    _SLEEPER_LOOKUP = {
        "df": df,
        "by_gsis": by_gsis,
        "by_sleeper_id": by_sleeper_id,
        "by_name_team": by_name_team,
    }
    return df, by_gsis, by_sleeper_id, by_name_team


def _media_for_players(
    players: list[dict[str, Any]] | None,
) -> dict[str, dict[str, str | None]]:
    if not players:
        return {}

    df, by_gsis, by_sleeper_id, by_name_team = _sleeper_lookup_tables()

    out: dict[str, dict[str, str | None]] = {}
    for hint in players:
        pid = str(hint.get("player_id") or "")
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
        )
        team = str(hint.get("team") or (row.get("team") if row is not None else "") or "").upper()
        if row is not None:
            out[pid] = {
                "headshot_url": headshot_url(str(row.get("sleeper_id") or ""), row.get("espn_id")),
                "team_logo_url": team_logo_url(team),
                "team": team,
                "sleeper_id": str(row.get("sleeper_id") or "") or None,
            }
        else:
            out[pid] = {
                "headshot_url": None,
                "team_logo_url": team_logo_url(team) if team else None,
                "team": team or None,
                "sleeper_id": None,
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
    # SCORE-27: request path never calls LLM (llm_player_ids retained for API compat only).
    _ = llm_player_ids
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
        enriched["fantasy_digest"] = fantasy_digest_for_player(
            pname,
            row,
            scope="weekly",
            player_id=str(pid),
            season=season,
            week=week,
            prefer_llm=False,
        )
        enriched["beat_digest"] = enriched["fantasy_digest"]
        out[pid] = enriched
    return out


def build_draft_room_enrichment(
    *,
    season: int | None = None,
    week: int | None = None,
    players: list[dict[str, Any]] | None = None,
    llm_player_ids: list[str] | None = None,
) -> dict[str, Any]:
    resolved_season, resolved_week = _resolve_draft_week(season, week)
    sentiment = build_fantasy_index(resolved_season, resolved_week)
    hints = players or []
    media = _media_for_players(hints)
    llm_set = set(str(p) for p in (llm_player_ids or []))

    sentiment_players = _attach_digests(
        sentiment["players"],
        hints,
        season=sentiment["season"],
        week=sentiment["week"],
        llm_player_ids=llm_set,
    )

    teams: dict[str, str] = {}
    for info in media.values():
        team = info.get("team")
        if team:
            url = team_logo_url(str(team))
            if url:
                teams[str(team).upper()] = url

    return {
        "season": sentiment["season"],
        "week": sentiment["week"],
        "requested_season": sentiment["requested_season"],
        "requested_week": sentiment["requested_week"],
        "context_fallback": sentiment["context_fallback"],
        "sentiment_by_player_id": sentiment_players,
        "media_by_player_id": media,
        "team_logo_by_team": teams,
        "llm_available": bool(BEAT_DIGEST_LLM_ENABLED and OPENAI_API_KEY.strip()),
    }


def beat_digest_single(
    player_id: str,
    *,
    player_name: str | None = None,
    season: int | None = None,
    week: int | None = None,
) -> dict[str, Any]:
    resolved_season, resolved_week = _resolve_draft_week(season, week)
    sentiment = build_fantasy_index(resolved_season, resolved_week)
    row = sentiment["players"].get(str(player_id))
    if not row:
        return {"player_id": player_id, "beat_digest": None}
    pname = player_name or row.get("player") or player_id
    digest_result = fantasy_digest_for_player(
        str(pname),
        row,
        scope="weekly",
        player_id=str(player_id),
        season=sentiment["season"],
        week=sentiment["week"],
        prefer_llm=False,  # SCORE-27: serve cache/template only
        return_meta=True,
    )
    return {
        "player_id": player_id,
        "fantasy_digest": digest_result["fantasy_digest"],
        "fantasy_digest_source": digest_result.get("fantasy_digest_source"),
        "beat_digest": digest_result["fantasy_digest"],
        "beat_digest_source": digest_result.get("fantasy_digest_source"),
        "season": sentiment["season"],
        "week": sentiment["week"],
    }
