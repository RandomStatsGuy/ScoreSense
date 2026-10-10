"""Prepare existing Fantasy valuation configurations before serving pages."""

from src.ops.job_diagnostics import observe_job
import json
import logging

from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.value_sheet import _pool_payload_cache_key, read_draft_pool_payload


@observe_job("fantasy_valuations")
def warm_fantasy_value_snapshots(*, prepare_pools: bool = False, season: int | None = None,
                               allow_stale: bool = False) -> dict:
    """Startup may prepare last-saved values; refresh jobs require current pools."""
    if not storage.DRAFT_HUB_DB.exists():
        return {"prepared": 0, "unavailable": 0}
    # Enumerate inputs without resolving focus, reconciling rosters, or creating
    # workspaces. Each manager's imported ranges belong to their own workspace.
    with storage.get_conn() as conn:
        configs = conn.execute("""
            SELECT w.id AS range_workspace, w.season, w.rules_json, 12 AS team_count
            FROM hub_workspace w
            UNION
            SELECT w.id, l.season, l.rules_json, l.team_count
            FROM hub_workspace w JOIN league l ON l.commissioner_sub=w.user_sub
            UNION
            SELECT w.id, l.season, l.rules_json, l.team_count
            FROM hub_workspace w JOIN team t ON t.user_sub=w.user_sub
            JOIN league l ON l.id=t.league_id
        """).fetchall()
    prepared, unavailable, seen, inputs, failed_seasons = 0, 0, set(), [], set()
    target_season = season
    for config in configs:
        season = config["season"]
        if target_season is not None and season != target_season:
            continue
        try:
            season = int(config["season"])
            rules = LeagueRules.model_validate(json.loads(config["rules_json"]))
            ranges = storage.list_salary_ranges(config["range_workspace"])
            team_count = int(config["team_count"] or 12)
            key = _pool_payload_cache_key(season, rules, ranges, team_count=team_count)
            if key in seen:
                continue
            seen.add(key)
            inputs.append((season, rules, ranges, team_count))
        except Exception:
            unavailable += 1
            failed_seasons.add(season)
            logging.getLogger(__name__).warning("Fantasy valuation configuration unavailable for season %s", season, exc_info=True)

    # Discover every configured season's source inputs before making valuations.
    # A later season can invalidate an earlier pool; the refresh finalizer then
    # repeats preparation against the complete shared source revision.
    pool_errors = set()
    if prepare_pools:
        from src.draft_hub.draft_pool_cache import load_draft_pool

        for season in sorted({item[0] for item in inputs}):
            try:
                load_draft_pool(season, apply_identity=False)
            except Exception:
                pool_errors.add(season)
                logging.getLogger(__name__).warning("Fantasy projection pool unavailable for season %s", season, exc_info=True)
    for season, rules, ranges, team_count in inputs:
        if season in pool_errors:
            unavailable += 1
            failed_seasons.add(season)
            continue
        try:
            read_draft_pool_payload(season, rules, ranges, team_count=team_count,
                                    allow_stale=allow_stale and not prepare_pools)
            prepared += 1
        except Exception:
            unavailable += 1
            failed_seasons.add(season)
            logging.getLogger(__name__).warning(
                "Fantasy valuation snapshot unavailable for season %s (%s teams)", season, team_count, exc_info=True)
    return {"prepared": prepared, "unavailable": unavailable, "failed_seasons": sorted(failed_seasons, key=str)}
