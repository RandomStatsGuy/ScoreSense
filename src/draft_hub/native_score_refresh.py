"""Durable, coalesced native score refreshes; HTTP reads never load statistics."""
from __future__ import annotations

from src.ops.job_diagnostics import observe_job, annotate_job, call_phase

import time
from src.draft_hub import storage

CADENCE_SECONDS = 60
LEASE_SECONDS = 300
QUIET_CADENCE_SECONDS = 300
FAILURE_RETRY_SECONDS = 300


def request_refresh(league_id: str, season: int, week: int, *, now: float | None = None,
                    cadence_seconds: int = CADENCE_SECONDS) -> None:
    stamp = time.time() if now is None else now
    with storage.get_conn() as conn:
        conn.execute("""INSERT INTO native_score_refresh(league_id,season,week)
            VALUES(?,?,?) ON CONFLICT(league_id,season,week) DO UPDATE SET status='pending',error=NULL
            WHERE native_score_refresh.lease_until <= ?
            AND native_score_refresh.attempted_at <= ?
            AND (native_score_refresh.status != 'failed' OR native_score_refresh.attempted_at <= ?)
            AND native_score_refresh.status != 'pending'""",
            (league_id, int(season), int(week), stamp, stamp - cadence_seconds, stamp - FAILURE_RETRY_SECONDS))


def refresh_status(league_id: str, season: int, week: int) -> dict | None:
    with storage.get_conn() as conn:
        row = conn.execute("SELECT status,attempted_at,error FROM native_score_refresh WHERE league_id=? AND season=? AND week=?",
                           (league_id, int(season), int(week))).fetchone()
    return dict(row) if row else None


def _claim(*, now: float) -> dict | None:
    with storage.get_conn() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("""SELECT * FROM native_score_refresh
            WHERE status='pending' OR (status='running' AND lease_until<=?)
            OR (status='failed' AND attempted_at<=? AND COALESCE(error,'')!='settings_changed')
            ORDER BY attempted_at LIMIT 1""", (now, now - FAILURE_RETRY_SECONDS)).fetchone()
        if row is None:
            return None
        job = dict(row)
        conn.execute("""UPDATE native_score_refresh SET status='running',attempted_at=?,lease_until=?,error=NULL
            WHERE league_id=? AND season=? AND week=?""",
            (now, now + LEASE_SECONDS, job['league_id'], job['season'], job['week']))
        job['lease_until'] = now + LEASE_SECONDS
        return job


def _finish(job: dict, status: str, error: str | None = None) -> None:
    with storage.get_conn() as conn:
        conn.execute("""UPDATE native_score_refresh SET status=?,error=?,lease_until=0
            WHERE league_id=? AND season=? AND week=? AND lease_until=? AND status='running'""",
            (status, error, job['league_id'], job['season'], job['week'], job['lease_until']))


@observe_job("native_scores.batch", cadence_s=CADENCE_SECONDS)
def refresh_pending_scores(*, limit: int = 10) -> dict:
    """One bounded worker batch. Shared stats are loaded once per season/week."""
    from src.draft_hub.hub_scoring import apply_week_scores, load_week_stat_index, nfl_week_started, sleeper_hosts_scoring
    from src.draft_hub.schemas import LeagueRules, ScoringRules

    indexes = {}
    completed = failed = 0
    attempts = skipped = upcoming = 0
    for _ in range(limit):
        job = _claim(now=time.time())
        if job is None:
            break
        attempts += 1
        league_id, season, week = job['league_id'], job['season'], job['week']
        try:
            league = storage.get_league(league_id)
            run = storage.get_week_scoring_run(league_id, season, week)
            if not league or not league.get('draft_completed') or sleeper_hosts_scoring(league) or (run and run.get('final')):
                _finish(job, 'skipped')
                skipped += 1
                continue
            rules = LeagueRules.model_validate(league['rules'])
            if run and ScoringRules.model_validate(run['scoring']) != rules.scoring:
                _finish(job, 'failed', 'settings_changed')
                failed += 1
                continue
            if not run and nfl_week_started(season, week) is False:
                # A future slate has no actual stats yet. The regular scheduler
                # requeues this state, so scoring begins automatically at kickoff.
                _finish(job, 'upcoming')
                upcoming += 1
                continue
            key = (season, week)
            if key not in indexes:
                indexes[key] = call_phase("load_stats", load_week_stat_index, season, week)
            # The weekly statistics feed does not confirm live game completion.
            # Automatic updates remain provisional; explicit calculate owns final publication.
            result = call_phase("apply_scores", apply_week_scores, league_id, season, week, stat_index=indexes[key],
                                       slate_complete=False, automatic=True, refresh_lease=job['lease_until'])
            if result.get('scored'):
                _finish(job, 'complete')
                completed += 1
            else:
                _finish(job, 'failed', result.get('reason') or 'no_stats')
                failed += 1
        except Exception:
            import logging
            logging.getLogger(__name__).exception('Native score refresh failed for %s week %s', league_id, week)
            _finish(job, 'failed', 'refresh_failed')
            failed += 1
    annotate_job(attempts=attempts, skipped=skipped, upcoming=upcoming)
    return {'completed': completed, 'failed': failed}


@observe_job("native_scores.schedule", cadence_s=CADENCE_SECONDS)
def queue_current_native_weeks() -> None:
    from src.draft_hub.league_live_scoring import resolve_current_week
    from src.draft_hub.hub_scoring import sleeper_hosts_scoring
    week, state = resolve_current_week()
    season = int(state.get('season') or 0)
    if str(state.get('season_type') or 'regular').lower() not in {'regular', 'reg'}:
        return
    with storage.get_conn() as conn:
        ids = [row['id'] for row in conn.execute('SELECT id FROM league WHERE season=? AND draft_completed=1', (season,))]
        unfinished = [dict(row) for row in conn.execute('SELECT league_id,season,week FROM league_week_scoring_run WHERE season=? AND final=0', (season,))]
    keys = {(league_id, season, int(week)) for league_id in ids}
    keys.update((r['league_id'], r['season'], r['week']) for r in unfinished)
    annotate_job(checked=len(keys), season=season, week=int(week))
    from src.draft_hub.game_center import cached_game_states
    cadences = {}
    for league_id, season, week in keys:
        league = storage.get_league(league_id)
        run = storage.get_week_scoring_run(league_id, season, week)
        if league and league.get('draft_completed') and not sleeper_hosts_scoring(league) and not (run and run.get('final')):
            key = (season, week)
            if key not in cadences:
                states = cached_game_states(season, week)
                games_active = any(game.get('game_state') == 'live' for game in states.values())
                cadences[key] = CADENCE_SECONDS if games_active else QUIET_CADENCE_SECONDS
            request_refresh(league_id, season, week, cadence_seconds=cadences[key])
