"""Fantasy-only narrative readout (weekly slate + season-long outlook)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from src.config import BEAT_DIGEST_CACHE_VERSION, BEAT_DIGEST_LLM_TOP_N, SENTIMENT_FEATURES_PATH
from src.jobs.sentiment_refresh import get_sentiment_refresh_status
from src.sentiment.aggregate import load_sentiment_features
from src.sentiment.display import sentiment_label, sentiment_label_text, sentiment_summary
from src.sentiment.fantasy_channels import FANTASY_NETWORK_COLUMNS, load_fantasy_channels
from src.sentiment.fantasy_digest import fantasy_digest_for_player
from src.sentiment.networks import load_networks, network_label
from src.sentiment.readout import _player_names, _position_filter

_FANTASY_RESPONSE_CACHE: dict[str, tuple[str, dict]] = {}


def invalidate_fantasy_response_cache() -> None:
    _FANTASY_RESPONSE_CACHE.clear()


def _fantasy_fingerprint() -> str:
    parts = [BEAT_DIGEST_CACHE_VERSION, "fantasy"]
    if SENTIMENT_FEATURES_PATH.exists():
        parts.append(str(SENTIMENT_FEATURES_PATH.stat().st_mtime_ns))
    return "|".join(parts)


def fantasy_mention_count(row: pd.Series) -> float:
    return sum(float(row.get(col) or 0) for col in FANTASY_NETWORK_COLUMNS.values())


def _fantasy_mentions(row: pd.Series) -> dict[str, float]:
    out: dict[str, float] = {}
    for network, col in FANTASY_NETWORK_COLUMNS.items():
        val = float(row.get(col) or 0)
        if val > 0:
            out[network] = val
    return out


def _fantasy_channel_lookup() -> dict[tuple[str, str], str]:
    lookup: dict[tuple[str, str], str] = {}
    for entry in load_fantasy_channels(active_only=True):
        lookup[(entry.team.upper(), entry.network)] = entry.label
    return lookup


def _fantasy_sources_from_row(
    row: pd.Series,
    channel_lookup: dict[tuple[str, str], str],
    networks: dict,
) -> list[dict]:
    team = str(row.get("team") or "").upper()
    sources: dict[tuple[str, str], dict] = {}

    def add(network: str) -> None:
        label = channel_lookup.get(("NFL", network)) or channel_lookup.get((team, network))
        if not label:
            return
        key = (label, network)
        if key not in sources:
            sources[key] = {
                "label": label,
                "network": network,
                "network_label": network_label(network, networks),
            }

    for network, col in FANTASY_NETWORK_COLUMNS.items():
        if float(row.get(col) or 0) > 0:
            add(network)

    return sorted(sources.values(), key=lambda x: x["label"])


def _fantasy_source_count(row: pd.Series) -> float:
    return float(sum(1 for col in FANTASY_NETWORK_COLUMNS.values() if float(row.get(col) or 0) > 0))


def _prefer_llm_for_fantasy(row: pd.Series, rank: int, top_n: int = BEAT_DIGEST_LLM_TOP_N) -> bool:
    if rank < top_n:
        return True
    if float(row.get("yt_injury_flag") or 0) > 0:
        return True
    if float(row.get("yt_role_hype_flag") or 0) > 0:
        return True
    return False


def _row_to_fantasy_player(
    row: pd.Series,
    *,
    name_map: dict[str, str],
    channel_lookup: dict[tuple[str, str], str],
    networks: dict,
    season: int | None = None,
    week: int | None = None,
    scope: str = "weekly",
    prefer_llm: bool = False,
    mention_trend: float | None = None,
    weeks_with_mentions: int | None = None,
) -> dict:
    pid = str(row["player_id"])
    team = str(row.get("team") or "").upper()
    sources = _fantasy_sources_from_row(row, channel_lookup, networks)
    mention_count = fantasy_mention_count(row)
    injury_flag = float(row.get("yt_injury_flag") or 0)
    role_hype_flag = float(row.get("yt_role_hype_flag") or 0)
    sentiment_score = float(row.get("yt_sentiment_score") or 0)
    channel_labels = [s["label"] for s in sources]
    label_key = sentiment_label(
        sentiment_score,
        injury_flag=injury_flag,
        role_hype_flag=role_hype_flag,
    )
    player_name = name_map.get(pid, pid)
    payload: dict[str, Any] = {
        "player_id": pid,
        "player": player_name,
        "team": team,
        "position": str(row.get("position") or "").upper(),
        "mention_count": mention_count,
        "sentiment_score": sentiment_score,
        "sentiment_label": label_key,
        "sentiment_label_text": sentiment_label_text(label_key),
        "sentiment_summary": sentiment_summary(
            label=label_key,
            mention_count=mention_count,
            source_labels=channel_labels,
            injury_flag=injury_flag,
            role_hype_flag=role_hype_flag,
        ),
        "injury_flag": injury_flag,
        "role_hype_flag": role_hype_flag,
        "snippet": str(row.get("yt_top_snippet") or row.get("yt_top_sentence") or ""),
        "chapter_notes": str(row.get("yt_chapter_notes") or ""),
        "top_sentence": str(row.get("yt_top_sentence") or row.get("yt_top_snippet") or ""),
        "channels": channel_labels,
        "sources": sources,
        "fantasy_mentions": _fantasy_mentions(row),
        "narrative_source_count": _fantasy_source_count(row),
        "scope": scope,
    }
    if mention_trend is not None:
        payload["mention_trend"] = mention_trend
    if weeks_with_mentions is not None:
        payload["weeks_with_mentions"] = weeks_with_mentions

    digest_scope = "season" if scope == "season" else "weekly"
    digest_result = fantasy_digest_for_player(
        player_name,
        payload,
        scope=digest_scope,
        player_id=pid,
        season=season,
        week=week,
        prefer_llm=prefer_llm,
        return_meta=True,
    )
    payload["fantasy_digest"] = digest_result["fantasy_digest"]
    payload["fantasy_digest_source"] = digest_result.get("fantasy_digest_source")
    payload["beat_digest"] = payload["fantasy_digest"]
    payload["beat_digest_source"] = payload["fantasy_digest_source"]
    return payload


def _latest_fantasy_week(features: pd.DataFrame, position: str) -> tuple[int, int] | None:
    scoped = _position_filter(features, position)
    scoped = scoped[scoped.apply(fantasy_mention_count, axis=1) > 0]
    if scoped.empty:
        scoped = features[features.apply(fantasy_mention_count, axis=1) > 0]
    if scoped.empty:
        return None
    latest = scoped.sort_values(["season", "week"]).iloc[-1]
    return int(latest["season"]), int(latest["week"])


def _resolve_fantasy_week(
    features: pd.DataFrame,
    position: str,
    season: int,
    week: int,
) -> tuple[int, int, bool]:
    """Use latest available narrative week when the requested slate has no mentions.

    Same-season missing weeks fall back within that season. Cross-season fallback
    only applies for the upcoming season (max_season + 1), matching beat-writer
    sentiment resolution — far-future empty seasons stay empty.
    """
    scoped = _position_filter(features, position)
    has_data = not scoped[
        (scoped["season"] == season)
        & (scoped["week"] == week)
        & (scoped.apply(fantasy_mention_count, axis=1) > 0)
    ].empty
    if has_data:
        return season, week, False
    season_scoped = scoped[(scoped["season"] == season)]
    season_scoped = season_scoped[season_scoped.apply(fantasy_mention_count, axis=1) > 0]
    if not season_scoped.empty:
        latest_row = season_scoped.sort_values("week").iloc[-1]
        return season, int(latest_row["week"]), True
    if features.empty or "season" not in features.columns:
        return season, week, False
    max_season = int(features["season"].max())
    # Allow fallback for the current or upcoming season (including when the
    # requested season exists in features but has no fantasy mentions yet).
    # Far-future empty seasons (e.g. 2099) stay empty.
    if season <= max_season + 1:
        latest = _latest_fantasy_week(features, position)
        if latest is not None:
            return latest[0], latest[1], True
    return season, week, False


def _fantasy_sources_meta() -> dict:
    channels = load_fantasy_channels(active_only=True)
    networks = load_networks()
    by_network: dict[str, int] = {}
    for ch in channels:
        by_network[ch.network] = by_network.get(ch.network, 0) + 1
    return {
        "fantasy_channels": len(channels),
        "networks": {k: networks[k].label for k in by_network if k in networks},
    }


def _empty_response(
    *,
    position: str,
    season: int,
    week: int,
    scope: str,
) -> dict:
    refresh = get_sentiment_refresh_status()
    note = (
        "Fantasy video context only — does not change projections or injury boosts. "
        "Sources: league-wide fantasy YouTube shows."
    )
    return {
        "position": position,
        "scope": scope,
        "season": season,
        "week": week,
        "requested_season": season,
        "requested_week": week,
        "context_fallback": False,
        "count": 0,
        "meta": {
            "last_refresh": refresh.get("completed_at"),
            "sources": _fantasy_sources_meta(),
            "note": note,
        },
        "players": [],
    }


def build_fantasy_weekly_response(
    position: str,
    season: int,
    week: int,
    sentiment_path: Path | None = None,
) -> dict:
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise ValueError("position must be qb, rb, or wr")

    fp = _fantasy_fingerprint()
    cache_key = f"weekly:{position}:{season}:{week}"
    cached = _FANTASY_RESPONSE_CACHE.get(cache_key)
    if cached is not None and cached[0] == fp:
        return cached[1]

    features = load_sentiment_features(sentiment_path)
    if features.empty:
        empty = _empty_response(position=position, season=season, week=week, scope="weekly")
        _FANTASY_RESPONSE_CACHE[cache_key] = (fp, empty)
        return empty

    requested_season, requested_week = season, week
    season, week, context_fallback = _resolve_fantasy_week(features, position, season, week)

    scoped = _position_filter(features, position)
    scoped = scoped[(scoped["season"] == season) & (scoped["week"] == week)].copy()
    scoped["_fantasy_mentions"] = scoped.apply(fantasy_mention_count, axis=1)
    scoped = scoped[scoped["_fantasy_mentions"] > 0]
    scoped = scoped.sort_values("_fantasy_mentions", ascending=False)

    player_ids = set(scoped["player_id"].astype(str))
    name_map = _player_names(season, player_ids, position)
    channel_lookup = _fantasy_channel_lookup()
    networks = load_networks()
    refresh = get_sentiment_refresh_status()

    players = []
    for rank, (_, row) in enumerate(scoped.iterrows()):
        players.append(
            _row_to_fantasy_player(
                row,
                name_map=name_map,
                channel_lookup=channel_lookup,
                networks=networks,
                season=season,
                week=week,
                scope="weekly",
                prefer_llm=_prefer_llm_for_fantasy(row, rank),
            )
        )

    note = (
        "Fantasy video context only — does not change projections or injury boosts. "
        "Weekly analyst buzz from league-wide fantasy YouTube shows."
    )
    if context_fallback:
        note = (
            f"No fantasy narrative for {requested_season} Week {requested_week}; showing latest available "
            f"({season} Week {week}). "
        ) + note

    result = {
        "position": position,
        "scope": "weekly",
        "season": season,
        "week": week,
        "requested_season": requested_season,
        "requested_week": requested_week,
        "context_fallback": context_fallback,
        "count": len(players),
        "meta": {
            "last_refresh": refresh.get("completed_at"),
            "sources": _fantasy_sources_meta(),
            "note": note,
        },
        "players": players,
    }
    _FANTASY_RESPONSE_CACHE[cache_key] = (fp, result)
    return result


def _aggregate_season_row(week_rows: list[pd.Series]) -> pd.Series:
    """Merge per-week fantasy rows into one synthetic season row."""
    if not week_rows:
        raise ValueError("week_rows required")
    base = week_rows[-1].copy()
    total_mentions = sum(fantasy_mention_count(r) for r in week_rows)
    weighted_scores: list[tuple[float, float]] = []
    for r in week_rows:
        fm = fantasy_mention_count(r)
        if fm > 0:
            weighted_scores.append((float(r.get("yt_sentiment_score") or 0), fm))
    if weighted_scores:
        wsum = sum(w for _, w in weighted_scores)
        sentiment_score = sum(s * w for s, w in weighted_scores) / wsum
    else:
        sentiment_score = 0.0

    week_mentions = sorted(
        [(int(r["week"]), fantasy_mention_count(r)) for r in week_rows],
        key=lambda x: x[0],
    )
    recent = sum(m for _, m in week_mentions[-3:])
    prior = sum(m for _, m in week_mentions[-6:-3])
    if prior > 0:
        mention_trend = (recent - prior) / prior
    elif recent > 0:
        mention_trend = 1.0
    else:
        mention_trend = 0.0

    top_weeks = sorted(week_rows, key=lambda r: fantasy_mention_count(r), reverse=True)[:3]
    snippets = [
        str(r.get("yt_top_snippet") or r.get("yt_top_sentence") or "").strip()
        for r in top_weeks
    ]
    snippets = [s for s in snippets if s]
    combined_snippet = " | ".join(snippets[:3])

    for network, col in FANTASY_NETWORK_COLUMNS.items():
        base[col] = sum(float(r.get(col) or 0) for r in week_rows)

    base["yt_sentiment_score"] = sentiment_score
    base["yt_injury_flag"] = max(float(r.get("yt_injury_flag") or 0) for r in week_rows)
    base["yt_role_hype_flag"] = max(float(r.get("yt_role_hype_flag") or 0) for r in week_rows)
    base["yt_top_snippet"] = combined_snippet
    base["yt_top_sentence"] = combined_snippet
    base["yt_chapter_notes"] = combined_snippet
    base["_fantasy_mention_total"] = total_mentions
    base["_mention_trend"] = mention_trend
    base["_weeks_with_mentions"] = len(week_rows)
    return base


def build_fantasy_season_response(
    position: str,
    season: int,
    week: int,
    sentiment_path: Path | None = None,
) -> dict:
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise ValueError("position must be qb, rb, or wr")

    fp = _fantasy_fingerprint()
    cache_key = f"season:{position}:{season}:{week}"
    cached = _FANTASY_RESPONSE_CACHE.get(cache_key)
    if cached is not None and cached[0] == fp:
        return cached[1]

    features = load_sentiment_features(sentiment_path)
    if features.empty:
        empty = _empty_response(position=position, season=season, week=week, scope="season")
        _FANTASY_RESPONSE_CACHE[cache_key] = (fp, empty)
        return empty

    requested_season, requested_week = season, week
    end_week = max(1, int(week))

    scoped = _position_filter(features, position)
    season_rows = scoped[(scoped["season"] == season) & (scoped["week"] <= end_week)].copy()
    season_rows["_fantasy_mentions"] = season_rows.apply(fantasy_mention_count, axis=1)
    season_rows = season_rows[season_rows["_fantasy_mentions"] > 0]

    if season_rows.empty:
        empty = _empty_response(position=position, season=season, week=week, scope="season")
        empty["requested_season"] = requested_season
        empty["requested_week"] = requested_week
        _FANTASY_RESPONSE_CACHE[cache_key] = (fp, empty)
        return empty

    aggregated: list[pd.Series] = []
    for player_id, group in season_rows.groupby("player_id"):
        week_list = [group[group["week"] == w].iloc[0] for w in sorted(group["week"].unique())]
        aggregated.append(_aggregate_season_row(week_list))

    agg_df = pd.DataFrame(aggregated)
    agg_df = agg_df.sort_values("_fantasy_mention_total", ascending=False)

    player_ids = set(agg_df["player_id"].astype(str))
    name_map = _player_names(season, player_ids, position)
    channel_lookup = _fantasy_channel_lookup()
    networks = load_networks()
    refresh = get_sentiment_refresh_status()

    players = []
    for rank, (_, row) in enumerate(agg_df.iterrows()):
        players.append(
            _row_to_fantasy_player(
                row,
                name_map=name_map,
                channel_lookup=channel_lookup,
                networks=networks,
                season=season,
                week=end_week,
                scope="season",
                prefer_llm=_prefer_llm_for_fantasy(row, rank),
                mention_trend=float(row.get("_mention_trend") or 0),
                weeks_with_mentions=int(row.get("_weeks_with_mentions") or 0),
            )
        )

    note = (
        "Fantasy video context only — does not change projections or injury boosts. "
        "Season-to-date analyst outlook from league-wide fantasy YouTube shows."
    )

    result = {
        "position": position,
        "scope": "season",
        "season": season,
        "week": end_week,
        "requested_season": requested_season,
        "requested_week": requested_week,
        "context_fallback": False,
        "count": len(players),
        "meta": {
            "last_refresh": refresh.get("completed_at"),
            "sources": _fantasy_sources_meta(),
            "note": note,
            "through_week": end_week,
        },
        "players": players,
    }
    _FANTASY_RESPONSE_CACHE[cache_key] = (fp, result)
    return result


def build_fantasy_index(
    season: int,
    week: int,
    sentiment_path: Path | None = None,
) -> dict[str, Any]:
    """Fantasy weekly players keyed by player_id (draft hub enrichment)."""
    features = load_sentiment_features(sentiment_path)
    if features.empty:
        return {
            "season": season,
            "week": week,
            "requested_season": season,
            "requested_week": week,
            "context_fallback": False,
            "players": {},
        }

    requested_season, requested_week = season, week
    season, week, context_fallback = _resolve_fantasy_week(features, "wr", season, week)

    scoped = features[(features["season"] == season) & (features["week"] == week)].copy()
    scoped["_fantasy_mentions"] = scoped.apply(fantasy_mention_count, axis=1)
    scoped = scoped[scoped["_fantasy_mentions"] > 0]
    scoped = scoped.sort_values("_fantasy_mentions", ascending=False)

    player_ids = set(scoped["player_id"].astype(str))
    name_map = _player_names(season, player_ids)
    channel_lookup = _fantasy_channel_lookup()
    networks = load_networks()

    players: dict[str, dict] = {}
    for rank, (_, row) in enumerate(scoped.iterrows()):
        pid = str(row["player_id"])
        players[pid] = _row_to_fantasy_player(
            row,
            name_map=name_map,
            channel_lookup=channel_lookup,
            networks=networks,
            season=season,
            week=week,
            scope="weekly",
            prefer_llm=_prefer_llm_for_fantasy(row, rank),
        )

    return {
        "season": season,
        "week": week,
        "requested_season": requested_season,
        "requested_week": requested_week,
        "context_fallback": context_fallback,
        "players": players,
    }
