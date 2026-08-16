"""Build API responses for weekly sentiment readout."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from typing import Any

from src.config import BEAT_DIGEST_CACHE_VERSION, BEAT_DIGEST_LLM_TOP_N, PROCESSED_DATA_DIR, SENTIMENT_FEATURES_PATH
from src.jobs.sentiment_refresh import get_sentiment_refresh_status
from src.sentiment.aggregate import load_sentiment_features
from src.sentiment.beat_digest import beat_digest_for_player
from src.sentiment.beat_writers import beat_writer_for_team, load_beat_writers
from src.sentiment.channels import count_channels_by_network, load_channels
from src.sentiment.display import sentiment_label, sentiment_label_text, sentiment_summary
from src.sentiment.chat_sports_channels import load_chat_sports_channels
from src.sentiment.fantasy_channels import FANTASY_NETWORK_COLUMNS, load_fantasy_channels
from src.sentiment.networks import load_networks, network_label

_SENTIMENT_RESPONSE_CACHE: dict[str, tuple[str, dict]] = {}


def _sentiment_fingerprint() -> str:
    parts = [BEAT_DIGEST_CACHE_VERSION]
    if SENTIMENT_FEATURES_PATH.exists():
        parts.append(str(SENTIMENT_FEATURES_PATH.stat().st_mtime_ns))
    return "|".join(parts)


def invalidate_sentiment_response_cache() -> None:
    _SENTIMENT_RESPONSE_CACHE.clear()


def _position_filter(df: pd.DataFrame, position: str) -> pd.DataFrame:
    pos = position.lower()
    if pos == "wr":
        return df[df["position"].isin(["WR", "TE"])]
    return df[df["position"] == pos.upper()]


def _player_names(season: int, player_ids: set[str], position: str | None = None) -> dict[str, str]:
    import pyarrow.parquet as pq

    if not player_ids:
        return {}

    names: dict[str, str] = {}
    positions = (position,) if position else ("qb", "rb", "wr")
    for pos in positions:
        path = PROCESSED_DATA_DIR / f"{pos}_mlready.parquet"
        if not path.exists():
            continue
        schema_names = pq.read_schema(path).names
        name_col = next(
            (col for col in ("player_display_name", "player_name", "Player") if col in schema_names),
            "player_display_name",
        )
        df = pd.read_parquet(path, columns=["season", "week", "player_id", name_col])
        scoped = df[df["player_id"].astype(str).isin(player_ids)]
        season_scoped = scoped[scoped["season"] == season]
        if not season_scoped.empty:
            for _, row in season_scoped.sort_values("week").groupby("player_id").tail(1).iterrows():
                names[str(row["player_id"])] = str(row[name_col])

    missing = player_ids - set(names.keys())
    if missing:
        for pos in positions:
            path = PROCESSED_DATA_DIR / f"{pos}_mlready.parquet"
            if not path.exists():
                continue
            schema_names = pq.read_schema(path).names
            name_col = next(
                (col for col in ("player_display_name", "player_name", "Player") if col in schema_names),
                "player_display_name",
            )
            df = pd.read_parquet(path, columns=["season", "week", "player_id", name_col])
            scoped = df[df["player_id"].astype(str).isin(missing)]
            if scoped.empty:
                continue
            for _, row in scoped.sort_values(["season", "week"]).groupby("player_id").tail(1).iterrows():
                names[str(row["player_id"])] = str(row[name_col])

    return names


def _sources_meta() -> dict:
    by_network = count_channels_by_network(active_only=True)
    networks = load_networks()
    return {
        "locked_on_channels": by_network.get("locked_on", 0),
        "sb_nation_channels": by_network.get("sb_nation", 0),
        "chat_sports_channels": by_network.get("chat_sports", 0),
        "fantasy_channels": sum(
            by_network.get(k, 0)
            for k in (
                "draft_sharks",
                "fantasy_footballers",
                "fantasypros_yt",
                "playerprofiler",
                "late_round",
                "establish_the_run",
                "fantasy_points",
                "qb_list",
                "underdog_fantasy",
                "reception_perception",
            )
        ),
        "networks": {k: networks[k].label for k in by_network if k in networks},
    }


def _fantasy_mentions(row: pd.Series) -> dict[str, float]:
    out: dict[str, float] = {}
    for network, col in FANTASY_NETWORK_COLUMNS.items():
        val = float(row.get(col) or 0)
        if val > 0:
            out[network] = val
    return out


def _channel_lookup() -> dict[tuple[str, str], str]:
    """(team, network) -> channel label."""
    lookup: dict[tuple[str, str], str] = {}
    for entry in load_channels(active_only=True):
        lookup[(entry.team.upper(), entry.network)] = entry.label
    for entry in load_chat_sports_channels(active_only=True):
        lookup[(entry.team.upper(), entry.network)] = entry.label
    for entry in load_fantasy_channels(active_only=True):
        lookup[(entry.team.upper(), entry.network)] = entry.label
    return lookup


def _sources_from_feature_row(row: pd.Series, team: str, channel_lookup: dict[tuple[str, str], str]) -> list[dict]:
    """Reconstruct source channels from aggregated mention columns (no video rescan)."""
    team = team.upper()
    sources: dict[tuple[str, str], dict] = {}

    def add(network: str) -> None:
        label = channel_lookup.get((team, network)) or channel_lookup.get(("NFL", network))
        if not label:
            return
        key = (label, network)
        if key not in sources:
            sources[key] = {"label": label, "network": network}

    if float(row.get("yt_locked_on_mentions") or 0) > 0:
        add("locked_on")
    if float(row.get("yt_sb_nation_mentions") or 0) > 0:
        add("sb_nation")

    fantasy_total = 0.0
    for network, col in FANTASY_NETWORK_COLUMNS.items():
        val = float(row.get(col) or 0)
        if val > 0:
            fantasy_total += val
            add(network)

    team_total = float(row.get("yt_locked_on_mentions") or 0) + float(row.get("yt_sb_nation_mentions") or 0)
    mention_total = float(row.get("yt_mention_count") or 0)
    if mention_total > team_total + fantasy_total + 0.01:
        add("chat_sports")

    return sorted(sources.values(), key=lambda x: x["label"])


def _prefer_llm_for_row(row: pd.Series, rank: int, top_n: int = BEAT_DIGEST_LLM_TOP_N) -> bool:
    """SCORE-27: request handlers never call LLM. Kept for import compatibility."""
    _ = (row, rank, top_n)
    return False


def _row_to_sentiment_player(
    row: pd.Series,
    *,
    name_map: dict[str, str],
    channel_lookup: dict[tuple[str, str], str],
    networks: dict,
    season: int | None = None,
    week: int | None = None,
    prefer_llm: bool = False,
) -> dict:
    pid = str(row["player_id"])
    team = str(row.get("team") or "").upper()
    sources = _sources_from_feature_row(row, team, channel_lookup)
    for src in sources:
        src["network_label"] = network_label(src["network"], networks)
    writer = beat_writer_for_team(team)
    mention_count = float(row.get("yt_mention_count") or 0)
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
    payload = {
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
        "beat_writer": writer.display_line if writer else None,
        "locked_on_mentions": float(row.get("yt_locked_on_mentions") or 0),
        "sb_nation_mentions": float(row.get("yt_sb_nation_mentions") or 0),
        "fantasy_mentions": _fantasy_mentions(row),
        "narrative_source_count": float(row.get("narrative_source_count") or 0),
    }
    digest_result = beat_digest_for_player(
        player_name,
        payload,
        player_id=pid,
        season=season,
        week=week,
        prefer_llm=prefer_llm,
        return_meta=True,
    )
    payload["beat_digest"] = digest_result["beat_digest"]
    payload["beat_digest_source"] = digest_result.get("beat_digest_source")
    return payload


def _resolve_sentiment_week_any(
    features: pd.DataFrame,
    season: int,
    week: int,
) -> tuple[int, int, bool]:
    has_data = not features[
        (features["season"] == season)
        & (features["week"] == week)
        & (features["yt_mention_count"].fillna(0) > 0)
    ].empty
    if has_data:
        return season, week, False
    latest = _latest_sentiment_week(features, "wr")
    if latest is None:
        latest = _latest_sentiment_week(features, "qb")
    if latest is not None:
        return latest[0], latest[1], True
    return season, week, False


def build_sentiment_index(
    season: int,
    week: int,
    sentiment_path: Path | None = None,
) -> dict[str, Any]:
    """All players with narrative data for a week, keyed by player_id."""
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
    season, week, context_fallback = _resolve_sentiment_week_any(features, season, week)

    scoped = features[(features["season"] == season) & (features["week"] == week)].copy()
    scoped = scoped[scoped["yt_mention_count"].fillna(0) > 0]
    scoped = scoped.sort_values("yt_mention_count", ascending=False)

    player_ids = set(scoped["player_id"].astype(str))
    name_map = _player_names(season, player_ids)
    channel_lookup = _channel_lookup()
    networks = load_networks()

    players: dict[str, dict] = {}
    for rank, (_, row) in enumerate(scoped.iterrows()):
        pid = str(row["player_id"])
        players[pid] = _row_to_sentiment_player(
            row,
            name_map=name_map,
            channel_lookup=channel_lookup,
            networks=networks,
            season=season,
            week=week,
            prefer_llm=False,  # SCORE-27: template/extractive only on request path
        )

    return {
        "season": season,
        "week": week,
        "requested_season": requested_season,
        "requested_week": requested_week,
        "context_fallback": context_fallback,
        "players": players,
    }


def _latest_sentiment_week(features: pd.DataFrame, position: str) -> tuple[int, int] | None:
    scoped = _position_filter(features, position)
    scoped = scoped[scoped["yt_mention_count"].fillna(0) > 0]
    if scoped.empty:
        scoped = features[features["yt_mention_count"].fillna(0) > 0]
    if scoped.empty:
        return None
    latest = scoped.sort_values(["season", "week"]).iloc[-1]
    return int(latest["season"]), int(latest["week"])


def _resolve_sentiment_week(
    features: pd.DataFrame,
    position: str,
    season: int,
    week: int,
) -> tuple[int, int, bool]:
    """Use latest available narrative week when the requested slate has no mentions."""
    scoped = _position_filter(features, position)
    has_data = not scoped[
        (scoped["season"] == season)
        & (scoped["week"] == week)
        & (scoped["yt_mention_count"].fillna(0) > 0)
    ].empty
    if has_data:
        return season, week, False
    max_season = int(features["season"].max())
    if season <= max_season + 1 and season > max_season:
        latest = _latest_sentiment_week(features, position)
        if latest is not None:
            return latest[0], latest[1], True
    return season, week, False


def build_sentiment_response(
    position: str,
    season: int,
    week: int,
    sentiment_path: Path | None = None,
) -> dict:
    position = position.lower()
    if position not in ("qb", "rb", "wr"):
        raise ValueError("position must be qb, rb, or wr")

    fp = _sentiment_fingerprint()
    cache_key = f"{position}:{season}:{week}"
    cached = _SENTIMENT_RESPONSE_CACHE.get(cache_key)
    if cached is not None and cached[0] == fp:
        return cached[1]

    features = load_sentiment_features(sentiment_path)
    refresh = get_sentiment_refresh_status()
    channels = load_channels()
    networks = load_networks()
    beat_writers = {w.team: w.display_line for w in load_beat_writers()}

    if features.empty:
        empty = {
            "position": position,
            "season": season,
            "week": week,
            "requested_season": season,
            "requested_week": week,
            "context_fallback": False,
            "count": 0,
            "meta": {
                "channels_active": 0,
                "channels_configured": len(channels),
                "last_refresh": refresh.get("completed_at"),
                "sources": _sources_meta(),
                "beat_writers_by_team": beat_writers,
                "note": "Weekly video narrative from team channels (Locked On, SB Nation, Chat Sports) and league fantasy shows. Context only — not blended into projections unless promoted.",
            },
            "players": [],
        }
        _SENTIMENT_RESPONSE_CACHE[cache_key] = (fp, empty)
        return empty

    requested_season, requested_week = season, week
    season, week, context_fallback = _resolve_sentiment_week(features, position, season, week)

    scoped = _position_filter(features, position)
    scoped = scoped[(scoped["season"] == season) & (scoped["week"] == week)]
    scoped = scoped[scoped["yt_mention_count"].fillna(0) > 0].copy()
    scoped = scoped.sort_values("yt_mention_count", ascending=False)

    player_ids = set(scoped["player_id"].astype(str))
    name_map = _player_names(season, player_ids, position)
    channel_lookup = _channel_lookup()

    players = []
    for rank, (_, row) in enumerate(scoped.iterrows()):
        players.append(
            _row_to_sentiment_player(
                row,
                name_map=name_map,
                channel_lookup=channel_lookup,
                networks=networks,
                season=season,
                week=week,
                prefer_llm=False,  # SCORE-27: no LLM on request path
            )
        )

    teams_active = int(scoped["team"].nunique()) if not scoped.empty else 0
    note = (
        "Weekly video narrative from team channels (Locked On, SB Nation, Chat Sports) and league fantasy shows. "
        "Context only — not blended into projections unless promoted."
    )
    if context_fallback:
        note = (
            f"No narrative for {requested_season} Week {requested_week}; showing latest available "
            f"({season} Week {week}). "
        ) + note
    result = {
        "position": position,
        "season": season,
        "week": week,
        "requested_season": requested_season,
        "requested_week": requested_week,
        "context_fallback": context_fallback,
        "count": len(players),
        "meta": {
            "channels_active": teams_active,
            "channels_configured": len(channels),
            "last_refresh": refresh.get("completed_at"),
            "data_coverage": float(scoped["yt_data_coverage"].iloc[0]) if not scoped.empty else 0.0,
            "sources": _sources_meta(),
            "beat_writers_by_team": beat_writers,
            "note": note,
        },
        "players": players,
    }
    _SENTIMENT_RESPONSE_CACHE[cache_key] = (fp, result)
    return result
