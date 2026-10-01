"""Complete inference identities from Sleeper and the current NFL roster.

Inactive is a weekly availability state, not a reason to remove a rostered
injured player from season/ROS forecasts. NFL roster rows also cover players
whose Sleeper identity or statistical history has not arrived yet.
"""
from __future__ import annotations

import pandas as pd

from src.draft_hub.player_name_match import roster_name_key
from src.integrations.roster_identity import DROP_STATUSES, SKILL_POSITIONS, cell_text


def roster_input_revisions() -> list[str]:
    """Local file revisions; new identities must invalidate all forecast caches."""
    from src.config import CACHE_DIR
    from src.core.artifact_revision import artifact_revision

    paths = [CACHE_DIR / 'sleeper_players.json', *sorted(CACHE_DIR.glob('nflverse_roster_*.parquet'))]
    return [f'roster:{path.name}:{artifact_revision(path)}' for path in paths]


def projection_roster_players(season: int, *, sleeper_df=None, nflverse_df=None) -> pd.DataFrame:
    from src.integrations.sleeper import players_dataframe
    from src.integrations.nflverse_roster import load_seasonal_roster

    sleeper = players_dataframe() if sleeper_df is None else sleeper_df
    # Resolve the cached NFL snapshot before building the pool. Otherwise a
    # cold cache's later identity overlay can discover players after feature
    # selection has already omitted them. Jobs/CPU workers own this inference.
    nfl = load_seasonal_roster(season) if nflverse_df is None else nflverse_df
    out = sleeper.copy().reset_index(drop=True)
    out['_projection_rostered'] = False
    if nfl.empty:
        return out
    by_id = {cell_text(row.get('gsis_id')): i for i, row in out.iterrows() if cell_text(row.get('gsis_id'))}
    by_name = {}
    for i, row in out.iterrows():
        key = roster_name_key(row.get('full_name'))
        if key:
            by_name.setdefault(key, []).append(i)
    extra = []
    for row in nfl.to_dict('records'):
        position, status = cell_text(row.get('position')).upper(), cell_text(row.get('status')).upper()
        if position not in SKILL_POSITIONS:
            continue
        pid, team = cell_text(row.get('player_id')), cell_text(row.get('team'))
        matches = by_name.get(roster_name_key(row.get('player_name')), [])
        idx = by_id.get(pid)
        if idx is None and len(matches) == 1:
            idx = matches[0]
        rostered = bool(team) and status not in DROP_STATUSES
        if idx is not None:
            out.at[idx, '_projection_rostered'] = rostered
            out.at[idx, 'gsis_id'] = pid
            out.at[idx, 'position'] = position
            out.at[idx, 'team'] = team
            if rostered and cell_text(out.at[idx, 'status']) == 'Retired':
                out.at[idx, 'status'] = 'Active' if status == 'ACT' else 'Inactive'
            if not rostered:
                out.at[idx, 'status'] = 'Retired' if status == 'RET' else 'Inactive'
            continue
        if rostered:
            extra.append({'sleeper_id': f'nflverse-{pid}', 'gsis_id': pid,
                          'full_name': cell_text(row.get('player_name')), 'team': team, 'position': position,
                          'status': 'Active' if status == 'ACT' else 'Inactive',
                          'injury_status': '' if status == 'ACT' else 'Inactive',
                          'years_exp': None, 'depth_chart_order': None, 'search_rank': None,
                          '_projection_rostered': True})
    if extra:
        out = pd.concat([out, pd.DataFrame(extra)], ignore_index=True)
    return out
