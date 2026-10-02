"""Prepare existing Fantasy valuation configurations before serving pages."""
import json
import logging

from src.draft_hub import storage
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.value_sheet import _pool_payload_cache_key, read_draft_pool_payload


def warm_fantasy_value_snapshots(*, prepare_pools: bool = False) -> dict:
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
    prepared, unavailable, seen, pool_seasons = 0, 0, set(), set()
    for config in configs:
        try:
            season = int(config["season"])
            rules = LeagueRules.model_validate(json.loads(config["rules_json"]))
            ranges = storage.list_salary_ranges(config["range_workspace"])
            team_count = int(config["team_count"] or 12)
            key = _pool_payload_cache_key(season, rules, ranges, team_count=team_count)
            if key in seen:
                continue
            seen.add(key)
            # Only explicit refresh jobs may fit missing projection artifacts.
            # Startup and HTTP readers remain artifact-only. Older configured
            # league seasons need their own pool after a model/input revision.
            if prepare_pools and season not in pool_seasons:
                from src.draft_hub.draft_pool_cache import load_draft_pool
                load_draft_pool(season, apply_identity=False)
                pool_seasons.add(season)
            read_draft_pool_payload(season, rules, ranges, team_count=team_count)
            prepared += 1
        except Exception:
            unavailable += 1
            logging.getLogger(__name__).warning("Fantasy valuation snapshot unavailable", exc_info=True)
    return {"prepared": prepared, "unavailable": unavailable}
