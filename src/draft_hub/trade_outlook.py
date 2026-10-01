"""Artifact-only, explicitly PPR trade outlook. Never run inference on page reads."""
from __future__ import annotations
import math
from typing import Any
import pandas as pd
from src.config import ROS_PREDICTIONS_DIR
from src.draft_hub.draft_pool_cache import load_draft_pool
from src.draft_hub.player_name_match import roster_name_key
from src.draft_hub.rules_engine import normalize_position
from src.core.team_codes import normalize_team_for_match
from src.projections.artifact_snapshot import read_snapshot

def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None

def match(row, frame):
    if frame.empty:
        return None
    pid = str(row.get('player_id') or '')
    aliases = {pid, pid.removeprefix('sleeper-'), str(row.get('gsis_id') or '')} - {''}
    if 'player_id' in frame:
        hits = frame[frame.player_id.astype(str).isin(aliases)]
        if len(hits) == 1:
            return hits.iloc[0]
    key = roster_name_key(row.get('player_name'))
    if not key or 'Player' not in frame:
        return None
    hits = frame[frame.Player.map(roster_name_key) == key]
    for col in ('Position', 'position'):
        if col in hits:
            hits = hits[hits[col].map(normalize_position) == normalize_position(row.get('position'))]
    team = normalize_team_for_match(row.get('team') or '')
    if team and 'Team' in hits:
        hits = hits[hits.Team.map(normalize_team_for_match) == team]
    return hits.iloc[0] if len(hits) == 1 else None

def outlook_from_frames(overview, pool, ros, *, week, specialists=None, remaining_games=None):
    out = {}
    for block in overview.get('teams') or []:
        for row in block.get('roster') or []:
            if str(row.get('roster_status') or 'active') != 'active':
                continue
            full = match(row, pool)
            remaining = match(row, ros)
            annual = None if full is None else number(full.get('Season P50', full.get('Season Proj')))
            points = annual if week == 1 else (None if remaining is None else number(remaining.get('ROS P50')))
            source = 'Season model' if week == 1 else 'ROS model'
            forecast_row = full if week == 1 else remaining
            if forecast_row is not None and forecast_row.get('projection_source') == 'Roster estimate':
                source = 'Roster estimate'
            if normalize_position(row.get('position')) in {'K', 'DEF'}:
                from src.draft_hub.k_def_pool_cache import find_k_def_projection
                hit = find_k_def_projection(row, specialists or {})
                if hit:
                    annual = number(hit.get('p50'))
                    games = (remaining_games or {}).get(normalize_team_for_match(hit.get('team')))
                    points = annual if week == 1 else (round(hit['per_game'] * games, 1) if games is not None and week else None)
                    source = 'Rank-curve estimate'
            out[str(row.get('player_id'))] = {'remaining_points': points, 'annual_points': annual,
                                              'source': source if points is not None else 'Unavailable'}
    return {'players': out, 'week': week, 'basis': 'PPR', 'contract_method': 'same_pace'}

def build_trade_outlook(overview: dict[str, Any]) -> dict:
    league = overview.get('league') or {}
    season = int(league.get('season') or 0)
    from src.core.schedule_utils import current_projection_week
    from src.projections.ros_cache import ros_fingerprint
    week = current_projection_week(season) if season else None
    # A future/pre-draft season uses its full-season artifact; a completed season has no future games.
    if not league.get('draft_completed'):
        week = 1
    pool = load_draft_pool(season, allow_compute=False, apply_identity=False, allow_stale=True) if season else pd.DataFrame()
    frames = []
    sources = {'draft': {'rows': len(pool), 'stale': bool(pool.attrs.get('projection_stale')),
                         'built_at': pool.attrs.get('built_at')}}
    rebuild = ['draft'] if season and (pool.empty or pool.attrs.get('projection_stale')) else []
    if week and week > 1:
        fingerprint = ros_fingerprint()
        for pos in ('qb', 'rb', 'wr'):
            stem = ROS_PREDICTIONS_DIR / f'{season}_w{week}_{pos}'
            frame = read_snapshot(
                stem.with_suffix('.parquet'), stem.with_suffix('.meta.json'),
                season=season, week=week, position=pos, injury=True, fingerprint=fingerprint,
                required_columns=('ROS P50',),
            )
            sources[pos] = {'rows': len(frame), 'built_at': frame.attrs.get('built_at'),
                            'stale': bool(frame.attrs.get('projection_stale'))}
            if frame.empty or frame.attrs.get('projection_stale'):
                rebuild.append('ros')
            if not frame.empty:
                frames.append(frame)
    ros = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    from src.draft_hub.k_def_pool_cache import k_def_projection_index
    from src.integrations.sleeper import players_dataframe
    # Cross-provider IDs come only from the saved NFL player feed.
    try:
        identity = players_dataframe(allow_refresh=False)
    except (OSError, ValueError):
        identity = pd.DataFrame()
    gsis_ids = {str(row.sleeper_id): str(row.gsis_id) for row in identity.itertuples()
                if hasattr(row, 'gsis_id') and pd.notna(row.gsis_id)} if not identity.empty else {}
    blocks = [{'roster': [{**row, 'gsis_id': gsis_ids.get(str(row.get('player_id', '')).removeprefix('sleeper-'))}
                           for row in block.get('roster') or []]} for block in overview.get('teams') or []]
    remaining_games = {}
    from src.core.schedule_utils import SCHEDULE_CACHE
    if week and SCHEDULE_CACHE.exists():
        try:
            schedule = pd.read_parquet(SCHEDULE_CACHE)
            games = schedule[(schedule.season == season) & (schedule.week >= week) & (schedule.week <= 18)]
            remaining_games = pd.concat([games.home_team, games.away_team]).map(normalize_team_for_match).value_counts().to_dict()
        except (OSError, ValueError, AttributeError, KeyError):
            pass
    specialists = k_def_projection_index(allow_fetch=False)
    has_specialists = any(normalize_position(row.get('position')) in {'K', 'DEF'}
                          for block in blocks for row in block['roster'])
    if has_specialists and week and (not specialists or (week > 1 and not remaining_games)):
        rebuild.append('specialists')
    result = outlook_from_frames(
        {**overview, 'teams': blocks}, pool, ros, week=week,
        specialists=specialists, remaining_games=remaining_games,
    )
    missing = [pid for pid, forecast in result['players'].items() if forecast['remaining_points'] is None]
    if week and week > 1:
        from src.projections.weekly_cache import load_weekly_prediction
        weekly = pd.concat([load_weekly_prediction(pos, season, week, allow_compute=False, allow_stale=True)
                            for pos in ('qb', 'rb', 'wr')], ignore_index=True)
        if any(str(row.get('player_id')) in missing and match(row, weekly) is not None
               for block in blocks for row in block['roster']):
            rebuild.append('ros')
    return {**result, 'season': season, 'projection_sources': sources,
            'stale': any(source['stale'] for source in sources.values()),
            'missing_player_ids': missing, 'rebuild_kinds': sorted(set(rebuild))}
