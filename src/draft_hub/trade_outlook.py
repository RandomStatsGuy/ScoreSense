"""Artifact-only, explicitly PPR trade outlook. Never run inference on page reads."""
from __future__ import annotations
import json
import math
from typing import Any
import pandas as pd
from src.config import ROS_PREDICTIONS_DIR
from src.draft_hub.draft_pool_cache import load_draft_pool
from src.draft_hub.player_name_match import roster_name_key
from src.draft_hub.rules_engine import normalize_position

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
    aliases = {pid, pid.removeprefix('sleeper-')}
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
    return hits.iloc[0] if len(hits) == 1 else None

def outlook_from_frames(overview, pool, ros, *, week):
    out = {}
    for block in overview.get('teams') or []:
        for row in block.get('roster') or []:
            if str(row.get('roster_status') or 'active') != 'active':
                continue
            full = match(row, pool)
            remaining = match(row, ros)
            annual = None if full is None else number(full.get('Season P50', full.get('Season Proj')))
            points = annual if week == 1 else (None if remaining is None else number(remaining.get('ROS P50')))
            out[str(row.get('player_id'))] = {'remaining_points': points, 'annual_points': annual}
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
    pool = load_draft_pool(season, allow_compute=False, apply_identity=False) if season else pd.DataFrame()
    frames = []
    if week and week > 1:
        fingerprint = ros_fingerprint()
        for pos in ('qb', 'rb', 'wr'):
            stem = ROS_PREDICTIONS_DIR / f'{season}_w{week}_{pos}'
            try:
                meta = json.loads(stem.with_suffix('.meta.json').read_text(encoding='utf-8'))
                if meta.get('fingerprint') == fingerprint:
                    frames.append(pd.read_parquet(stem.with_suffix('.parquet')))
            except (OSError, ValueError):
                continue
    ros = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    return {**outlook_from_frames(overview, pool, ros, week=week), 'season': season}
