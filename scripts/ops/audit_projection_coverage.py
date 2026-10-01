"""Audit shared forecasts against saved NFL identities without inference or fetching.

Run after materialization: python scripts/ops/audit_projection_coverage.py
--season 2026 --week 4 --output outputs/projection-coverage.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

from src.draft_hub.trade_outlook import match
from src.integrations.nflverse_roster import load_seasonal_roster
from src.integrations.roster_identity import DROP_STATUSES, SKILL_POSITIONS
from src.projections.artifact_snapshot import read_snapshot


def audit_frame(players: list[dict], frame: pd.DataFrame, columns: tuple[str, ...]) -> dict:
    missing = []
    for player in players:
        hit = match(player, frame)
        if hit is None or not np.isfinite(pd.to_numeric(hit.reindex(columns), errors='coerce').to_numpy(dtype=float)).all():
            missing.append(player)
    return {'expected': len(players), 'projected': len(players)-len(missing),
            'missing_count': len(missing), 'missing': missing}


def audit_context(season: int, week: int) -> dict:
    from src.draft_hub.draft_pool_cache import load_draft_pool
    from src.projections.weekly_cache import load_weekly_prediction
    from src.projections.ros_cache import ROS_PREDICTIONS_DIR, ros_fingerprint
    from src.products.lineup_optimizer import build_lineup_pool

    nfl = load_seasonal_roster(season, allow_refresh=False)
    if nfl.empty:
        raise ValueError('Saved NFL roster required for a coverage audit')
    nfl = nfl[nfl.position.isin(SKILL_POSITIONS) & ~nfl.status.isin(DROP_STATUSES) & nfl.team.fillna('').ne('')]
    players = nfl.to_dict('records')
    weekly = pd.concat([load_weekly_prediction(pos,season,week,allow_compute=False)
                        for pos in ('qb','rb','wr')],ignore_index=True)
    frames=[]
    for pos in ('qb','rb','wr'):
        stem=ROS_PREDICTIONS_DIR/f'{season}_w{week}_{pos}'
        frame=read_snapshot(stem.with_suffix('.parquet'),stem.with_suffix('.meta.json'),
                            season=season,week=week,position=pos,injury=True,fingerprint=ros_fingerprint())
        if not frame.attrs.get('projection_stale'):
            frames.append(frame)
    ros=pd.concat(frames,ignore_index=True) if frames else pd.DataFrame()
    draft=load_draft_pool(season,allow_compute=False,apply_identity=False)
    dfs,_=build_lineup_pool(season,week,site='draftkings')
    quantiles=('Low (P10)','Projected Points','High (P90)')
    return {'season_year':season,'week':week,'source':'Saved NFL roster and local materialized forecasts',
            'weekly':audit_frame(players,weekly,quantiles),
            'season':audit_frame(players,draft,('Season P10','Season P50','Season P90')),
            'ros':audit_frame(players,ros,('ROS P10','ROS P50','ROS P90')),
            'dfs_skill':audit_frame(players,dfs,quantiles)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--season',type=int,required=True)
    parser.add_argument('--week',type=int,required=True)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    result=audit_context(args.season,args.week)
    text=json.dumps(result,indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(text,encoding='utf-8')
    print(text)
    return int(any(result[service]['missing_count'] for service in ('weekly','season','ros','dfs_skill')))


if __name__=='__main__':
    raise SystemExit(main())
