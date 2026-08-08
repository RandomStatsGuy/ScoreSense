"""Materialized Insights caches — cap, scoring derived, fair values."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.draft_pool_cache import pool_fingerprint

# Bump when fair-value math changes so stored snapshots invalidate.
FAIR_VALUE_ALGO = "v2-roster-min"


def _fair_fingerprint() -> str:
    return f"{pool_fingerprint()}|{FAIR_VALUE_ALGO}"


def cap_season_key(history_mode: str, history_year: int | None) -> str:
    if history_mode == "year" and history_year is not None:
        return str(history_year)
    if history_mode == "all":
        return "all"
    return "current"


def scoring_season_key(scoring_season: str | None) -> str:
    return str(scoring_season or "current")


def read_cap_cache(
    league_id: str,
    *,
    history_mode: str,
    history_year: int | None,
) -> tuple[dict[str, Any] | None, str]:
    """Return (cached payload or None, source_version)."""
    version = storage.insights_source_version(league_id)
    season_key = cap_season_key(history_mode, history_year)
    row = storage.get_insights_cap_cache(league_id, season_key)
    if not row or row.get("source_version") != version:
        return None, version
    return row["payload"], version


def write_cap_cache(
    league_id: str,
    *,
    history_mode: str,
    history_year: int | None,
    payload: dict[str, Any],
    source_version: str | None = None,
) -> None:
    version = source_version or storage.insights_source_version(league_id)
    season_key = cap_season_key(history_mode, history_year)
    storage.upsert_insights_cap_cache(
        league_id,
        season_key,
        payload,
        source_version=version,
    )


def invalidate_cap_cache(league_id: str) -> None:
    storage.delete_insights_cap_cache(league_id)


def read_scoring_derived(
    sleeper_league_id: str,
    season_key: str,
) -> dict[str, Any] | None:
    if not sleeper_league_id:
        return None
    return storage.get_insights_scoring_derived(sleeper_league_id, season_key)


def write_scoring_derived(
    sleeper_league_id: str,
    season_key: str,
    *,
    awards: list[dict[str, Any]],
    efficiency: dict[str, Any],
) -> None:
    if not sleeper_league_id:
        return
    storage.upsert_insights_scoring_derived(
        sleeper_league_id,
        season_key,
        awards=awards,
        efficiency=efficiency,
    )


def read_fair_values(league_id: str, season: int) -> dict[str, float] | None:
    return storage.get_insights_fair_values(league_id, season, _fair_fingerprint())


def build_and_store_fair_values(
    league_id: str,
    overview: dict[str, Any],
    season: int,
) -> dict[str, float]:
    """Warm fair-value snapshot (loads draft pool — sync/warm path only)."""
    from src.draft_hub.pre_draft_cap import is_active_for_pre_draft
    from src.draft_hub.schemas import LeagueRules
    from src.draft_hub.trade_insights import _player_fair_values
    from src.draft_hub.value_sheet import _load_draft_pool

    league = overview.get("league") or {}
    rules = LeagueRules.model_validate(league.get("rules") or {})
    team_count = int(league.get("team_count") or 12)
    pool = _load_draft_pool(season)
    all_rosters: list[dict[str, Any]] = []
    for block in overview.get("teams") or []:
        all_rosters.extend(
            r for r in (block.get("roster") or []) if is_active_for_pre_draft(r)
        )
    fair_map = _player_fair_values(all_rosters, pool, rules, team_count)
    if fair_map:
        storage.upsert_insights_fair_values(
            league_id,
            season,
            fair_map,
            pool_fingerprint=_fair_fingerprint(),
        )
    return fair_map


def insights_status(league_id: str, sleeper_league_id: str | None) -> dict[str, Any]:
    """Lightweight cache freshness for prefetch hints."""
    version = storage.insights_source_version(league_id)
    cap_row = storage.get_insights_cap_cache(league_id, "current")
    cap_hit = bool(cap_row and cap_row.get("source_version") == version)
    scoring_cached = False
    scoring_synced_at = None
    if sleeper_league_id:
        sc = storage.get_sleeper_scoring_cache(str(sleeper_league_id))
        if sc:
            scoring_cached = True
            scoring_synced_at = sc.get("synced_at")
    league = storage.get_league(league_id) or {}
    season = int(league.get("season") or 2025)
    fair_hit = read_fair_values(league_id, season) is not None
    return {
        "cap": "hit" if cap_hit else "miss",
        "scoring": "hit" if scoring_cached else "miss",
        "fair_values": "hit" if fair_hit else "miss",
        "source_version": version,
        "scoring_synced_at": scoring_synced_at,
    }
