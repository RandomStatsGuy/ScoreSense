"""Prepare shared Fantasy reads before an API process accepts traffic.

No league state, lineup writes, live inference, or roster refresh is involved.
Data jobs remain responsible for replacing the source snapshots.
"""
import logging


def warm_fantasy_week_context() -> None:
    try:
        from src.draft_hub.weekly_command_center import (
            _load_projection_index, _load_prior_ppg_index, _load_def_vs_pos,
            _load_vegas_teams, resolve_week_context,
        )
        season, week = resolve_week_context(None, None)
        _load_projection_index(season, week, apply_injury_adjustments=True)
        _load_prior_ppg_index(season)
        _load_def_vs_pos(season, week)
        _load_vegas_teams(season, week)
    except Exception:
        logging.getLogger(__name__).warning("Fantasy context warmup unavailable", exc_info=True)
