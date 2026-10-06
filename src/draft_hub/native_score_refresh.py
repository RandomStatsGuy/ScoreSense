"""Durable, coalesced native score refreshes; HTTP reads never load statistics."""
from __future__ import annotations

from src.ops.job_diagnostics import observe_job, annotate_job, call_phase

import time
import logging
from datetime import datetime, timezone
from typing import Any, Callable
from src.config import NATIVE_SCORING_FINAL_SETTLE_SECONDS, NATIVE_SCORING_TESTING
from src.draft_hub.schemas import LeagueRules
from src.draft_hub.native_stats import SOURCE, NativeStatsUnavailable, get_week_snapshot, resolve_lineup_stats, cached_scheduled_teams
logger = logging.getLogger(__name__)
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
    """Claim durable jobs and share one verified actual snapshot per NFL week."""
    from src.draft_hub.hub_scoring import sleeper_hosts_scoring
    from src.draft_hub.schemas import ScoringRules
    snapshots = {}
    warmed_seasons = set()
    completed = failed = attempts = skipped = upcoming = 0
    for _ in range(limit):
        job = _claim(now=time.time())
        if job is None:
            break
        attempts += 1
        league_id, season, week = job['league_id'], job['season'], job['week']
        league = None
        try:
            league = storage.get_league(league_id)
            run = storage.get_week_scoring_run(league_id, season, week)
            if not league or not league.get('draft_completed') or league.get('test_mode') or str(league.get('status') or '').lower() in {'archived', 'deleted'} or sleeper_hosts_scoring(league) or (run and run.get('final')):
                _finish(job, 'skipped')
                skipped += 1
                continue
            rules = LeagueRules.model_validate(league['rules'])
            if run and ScoringRules.model_validate(run['scoring']) != rules.scoring:
                _finish(job, 'failed', 'settings_changed')
                failed += 1
                continue
            key = (season, week)
            prior = storage.get_native_live_week(league_id, season, week) or {}
            mismatch = any('cached schedule' in str(e) or 'cached season schedule' in str(e) for e in prior.get('errors') or [])
            if season not in warmed_seasons and not NATIVE_SCORING_TESTING and (cached_scheduled_teams(season, week) is None or mismatch):
                warmed_seasons.add(season)
                try:
                    call_phase('warm_schedule', _warm_schedule_cache, season)
                except Exception:
                    logger.warning('NFL season schedule unavailable for %s; final results will remain pending.', season)
            started = _prepare_lineups_for_refresh(league, season, week)
            if started is False:
                _finish(job, 'upcoming')
                upcoming += 1
                continue
            if key not in snapshots:
                try:
                    snapshots[key] = call_phase('load_stats', get_week_snapshot, season, week, force_refresh=True)
                except Exception as exc:
                    snapshots[key] = exc
            snapshot = snapshots[key]
            if isinstance(snapshot, Exception):
                raise snapshot
            # Existing snapshots can be reconciled in any period. Missing past
            # ownership is never inferred unless the verified slate is pregame.
            result = call_phase('apply_scores', refresh_league_week, league, season, week, snapshot,
                                current_week=True, automatic=True, refresh_lease=job['lease_until'])
            _finish(job, 'complete')
            completed += 1
        except Exception as exc:
            logger.exception('Native score refresh failed for %s week %s', league_id, week)
            if league:
                _save_error(league, season, week, exc, now=_clock())
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
    regular = str(state.get('season_type') or 'regular').lower() in {'regular', 'reg'}
    with storage.get_conn() as conn:
        ids = [row['id'] for row in conn.execute("SELECT id FROM league WHERE season=? AND draft_completed=1 AND COALESCE(test_mode,0)=0 AND status NOT IN ('archived','deleted')", (season,))]
        unfinished = [dict(row) for row in conn.execute('SELECT league_id,season,week FROM league_week_scoring_run WHERE final=0')]
        retained = [dict(row) for row in conn.execute('SELECT league_id,season,week FROM league_native_live_week')]
    keys = {(league_id, season, int(week)) for league_id in ids} if regular else set()
    keys.update((r['league_id'], r['season'], r['week']) for r in unfinished + retained)
    annotate_job(checked=len(keys), season=season, week=int(week))
    from src.draft_hub.game_center import cached_game_states
    cadences = {}
    for league_id, season, week in keys:
        league = storage.get_league(league_id)
        run = storage.get_week_scoring_run(league_id, season, week)
        if league and league.get('draft_completed') and not league.get('test_mode') and str(league.get('status') or '').lower() not in {'archived', 'deleted'} and not sleeper_hosts_scoring(league) and not (run and run.get('final')):
            rules = LeagueRules.model_validate(league.get('rules') or {})
            start = rules.playoffs.start_week or rules.regular_season_games + 1
            end = start + (rules.playoffs.teams - 1).bit_length() - 1
            if not (1 <= week <= rules.regular_season_games or (rules.playoffs.enabled and start <= week <= end)):
                continue
            key = (season, week)
            if key not in cadences:
                from src.draft_hub.native_stats import cached_week_snapshot
                actual = cached_week_snapshot(season, week)
                states = (actual or {}).get('game_states') or cached_game_states(season, week)
                games_active = any(game.get('game_state') == 'live' for game in states.values())
                cadences[key] = CADENCE_SECONDS if games_active else QUIET_CADENCE_SECONDS
            request_refresh(league_id, season, week, cadence_seconds=cadences[key])


def _clock(now: datetime | None = None) -> datetime:
    value = now or datetime.now(timezone.utc)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)



def _warm_schedule_cache(season: int) -> None:
    """Refresh one year in the background while retaining every other year."""
    import pandas as pd
    from src.core import schedule_utils
    from src.etl.nflverse_etl import load_schedules
    refreshed = load_schedules([int(season)])
    if refreshed is None or refreshed.empty or "season" not in refreshed:
        raise NativeStatsUnavailable("The season schedule is unavailable.")
    refreshed = refreshed[pd.to_numeric(refreshed["season"], errors="coerce") == int(season)]
    if refreshed.empty:
        raise NativeStatsUnavailable("The season schedule returned a different year.")
    if not schedule_utils.save_schedule_snapshot(refreshed, schedule_utils.SCHEDULE_CACHE):
        raise NativeStatsUnavailable("The season schedule could not be saved.")
    schedule_utils._league_week_windows.cache_clear()



def _save_error(league: dict[str, Any], season: int, week: int, error: Exception,
                *, now: datetime) -> dict[str, Any]:
    previous = storage.get_native_live_week(league["id"], season, week) or {}
    payload = {**previous, "source": SOURCE, "status": "error",
               "attempted_at": now.isoformat(), "errors": [str(error)],
               "season": int(season), "week": int(week)}
    if payload.get("scoring") is not None:
        payload["last_successful_scoring"] = payload.pop("scoring")
    try:
        storage.save_native_live_week(league["id"], season, week, payload)
    except ValueError:
        # The league can be linked/deleted while the provider request is in
        # flight. That must not prevent unrelated leagues from refreshing.
        logger.warning("Native scoring availability changed for league %s", league["id"])
    logger.warning("Native scores pending for league %s week %s: %s", league["id"], week, error)
    return payload



def refresh_league_week(league: dict[str, Any], season: int, week: int,
                       snapshot: dict[str, Any], *, current_week: bool = True,
                       now: datetime | None = None, automatic: bool = False,
                       refresh_lease: float | None = None) -> dict[str, Any]:
    """Compute provisional scores without changing standings or locking a slate."""
    from src.draft_hub.hub_scoring import (
        LineupError, apply_week_scores, ensure_season_schedule, ensure_team_lineup,
        fantasy_points_from_stats, require_position_stats, week_scoring_team_ids,
        validated_native_lineups, native_lineup_is_scoring_owner,
    )
    stamp = _clock(now)
    if league.get("sleeper_league_id"):
        raise NativeStatsUnavailable("Sleeper owns scoring for this linked league.")
    rules = LeagueRules.model_validate(league.get("rules") or {})
    league_id = str(league["id"])
    run = storage.get_week_scoring_run(league_id, season, week)
    if run and run.get("final", True):
        return storage.get_native_live_week(league_id, season, week) or {
            "season": int(season), "week": int(week), "status": "final", "errors": [],
        }
    states = snapshot.get("game_states") or {}
    teams = storage.list_league_teams(league_id)
    # Bracket rounds become available after the preceding saved result, even
    # when the app restarts after kickoff and nobody visits a Fantasy page.
    ensure_season_schedule(league_id, season=season, rules=rules)
    matchups = storage.list_week_matchups(league_id, season, week)
    if not matchups:
        raise NativeStatsUnavailable("The league matchup schedule is unavailable for this week.")
    participating = week_scoring_team_ids(rules, teams, matchups, week)
    teams = [team for team in teams if str(team["id"]) in participating]
    # Seed before the slate starts; during games only reconcile saved snapshots.
    # This updates unstarted acquisitions without reconstructing missing history.
    if current_week:
        pregame = bool(states) and all(g.get("game_state") == "pregame" for g in states.values())
        for team in teams:
            if pregame or storage.has_team_lineup_snapshot(league_id, str(team["id"]), season, week):
                ensure_team_lineup(league_id, str(team["id"]), season, week, rules=rules, identity_snapshot=snapshot)
    lineups = storage.list_week_lineups(league_id, season, week)
    recorded = {str(row["team_id"]) for row in storage.list_week_lineup_snapshots(league_id, season, week)}
    if any(str(t["id"]) not in recorded for t in teams):
        raise NativeStatsUnavailable("Historical starting lineups are missing; commissioner correction is required.")
    previous = storage.get_native_live_week(league_id, season, week) or {}
    players: list[dict[str, Any]] = []
    warnings: list[str] = []
    totals = {str(t["id"]): 0.0 for t in teams}
    resolved_index: dict[str, dict[str, float]] = {}
    lineups, starter_owners = validated_native_lineups(lineups, rules, season, week, participating, snapshot=snapshot)
    for row in lineups:
        if str(row["team_id"]) not in participating:
            continue
        if row.get("lineup_role") == "starter" and str(row.get("position") or "").upper() not in {"QB", "RB", "WR", "TE", "K", "DEF"}:
            raise NativeStatsUnavailable("Native scoring does not support this lineup position.")
        if not native_lineup_is_scoring_owner(row, starter_owners):
            reason = f"This week's points for {row.get('player_name') or row['player_id']} stay with the team that started the player."
            warnings.append(reason)
            players.append({"player_id": row["player_id"], "team_id": row["team_id"],
                            "slot": row.get("slot"), "lineup_role": row.get("lineup_role"),
                            "points": None, "stats": {}, "error": reason})
            continue
        try:
            if row.get("_identity_unavailable"):
                raise NativeStatsUnavailable(f"Player identity is unavailable for {row.get('player_name') or row['player_id']}.")
            stats = resolve_lineup_stats(row, snapshot)
        except NativeStatsUnavailable as exc:
            if row.get("lineup_role") == "starter":
                raise
            # Missing optional bench statistics do not decide the matchup. Keep
            # them unknown; the final scorer omits their player-score rows.
            warnings.append(str(exc))
            resolved_index[str(row["player_id"])] = {"_native_stats_unavailable": 1.0}
            players.append({"player_id": row["player_id"], "team_id": row["team_id"],
                            "slot": row.get("slot"), "lineup_role": row.get("lineup_role"),
                            "points": None, "stats": {}, "error": str(exc)})
            continue
        require_position_stats(row.get("position"), stats, rules.scoring)
        points = fantasy_points_from_stats(stats, rules.scoring)
        resolved_index[str(row["player_id"])] = stats
        if row.get("lineup_role") == "starter":
            totals[str(row["team_id"])] += points
        players.append({"player_id": row["player_id"], "team_id": row["team_id"],
                        "slot": row.get("slot"), "lineup_role": row.get("lineup_role"),
                        "points": points, "stats": stats})
    complete = bool(snapshot.get("complete"))
    pending_reason = snapshot.get("scoring_pending_reason")
    any_started = any(g.get("game_state") in {"live", "final"} for g in states.values())
    payload = {"season": int(season), "week": int(week), "source": SOURCE,
               "status": "pending" if complete or pending_reason else "live" if any_started else "pregame",
               "synced_at": snapshot["fetched_at"], "game_states": states,
               "players": players, "teams": [{"team_id": tid, "points": round(pts, 2)} for tid, pts in totals.items()],
               "scoring": rules.scoring.model_dump(), "errors": [pending_reason] if pending_reason else [], "warnings": warnings,
               "scoring_pending_reason": pending_reason,
               "stats_fingerprint": snapshot["fingerprint"]}
    settle_since = snapshot.get("all_final_since")
    try:
        final_age = (stamp - datetime.fromisoformat(str(settle_since).replace("Z", "+00:00"))).total_seconds()
    except (ValueError, TypeError):
        final_age = -1
    stable = previous.get("stats_fingerprint") == snapshot["fingerprint"] and previous.get("status") in {"pending", "error"}
    if complete and stable and final_age >= NATIVE_SCORING_FINAL_SETTLE_SECONDS:
        # Explicitly passing both actual stats and confirmed completion avoids
        # the legacy last-kickoff-plus-four-hours assumption entirely.
        result = apply_week_scores(league_id, season, week, stat_index=resolved_index,
                                   slate_complete=True, now=stamp, identity_snapshot=snapshot,
                                   automatic=automatic, refresh_lease=refresh_lease)
        if not result.get("scored"):
            raise LineupError(f"Native score finalization is pending: {result.get('reason') or 'unavailable inputs'}.")
        payload["status"] = "final"
    storage.save_native_live_week(league_id, season, week, payload)
    return payload



def run_native_score_tick(*, leagues: list[dict[str, Any]] | None = None,
                          nfl_state: dict[str, Any] | None = None,
                          snapshot_loader: Callable[..., dict[str, Any]] = get_week_snapshot,
                          now: datetime | None = None) -> list[dict[str, Any]]:
    """One refresh per NFL period, reused across all native scoring leagues."""
    stamp = _clock(now)
    candidates = storage.list_native_scoring_leagues() if leagues is None else leagues
    candidates = [l for l in candidates if not l.get("sleeper_league_id") and not l.get("test_mode") and l.get("draft_completed")]
    if not candidates:
        return []
    if nfl_state is None:
        from src.integrations.sleeper import get_nfl_state
        nfl_state = get_nfl_state()
    regular_season = str(nfl_state.get("season_type") or "regular").lower() in {"regular", "reg"}
    season, week = int(nfl_state.get("season") or stamp.year), int(nfl_state.get("week") or 1)
    results: list[dict[str, Any]] = []
    shared: dict[tuple[int, int], dict[str, Any] | Exception] = {}
    for league in candidates:
        league_season = int(league.get("season") or season)
        rules = LeagueRules.model_validate(league.get("rules") or {})
        playoff_start = rules.playoffs.start_week or rules.regular_season_games + 1
        playoff_end = playoff_start + (rules.playoffs.teams - 1).bit_length() - 1
        def scheduled_fantasy_week(value: int) -> bool:
            return value <= rules.regular_season_games or (
                rules.playoffs.enabled and playoff_start <= value <= playoff_end)
        pending = storage.list_native_pending_weeks(league["id"], league_season)
        current_targets = [week] if regular_season and league_season == season and scheduled_fantasy_week(week) else []
        # Current games lead. Delayed regular-season stats are still retried
        # after a week rollover, postseason transition, or new calendar year.
        targets = current_targets + [int(w) for w in sorted(pending) if int(w) not in current_targets]
        for target_week in targets:
            if not 1 <= target_week <= 18 or not scheduled_fantasy_week(target_week) or (regular_season and league_season == season and target_week > week):
                continue
            run = storage.get_week_scoring_run(league["id"], league_season, target_week)
            if run and run.get("final", True):
                continue
            key = league_season, target_week
            if key not in shared:
                try:
                    previous = storage.get_native_live_week(league["id"], *key) or {}
                    mismatch = any("cached schedule" in str(error) or "cached season schedule" in str(error)
                                   for error in previous.get("errors") or [])
                    if snapshot_loader is get_week_snapshot and not NATIVE_SCORING_TESTING and (cached_scheduled_teams(*key) is None or mismatch):
                        # Background-only warm/retry. Fantasy presentation reads
                        # never fetch; cold deployments still acquire bye proof.
                        try:
                            _warm_schedule_cache(league_season)
                        except Exception:
                            logger.warning("NFL season schedule could not warm for %s; results will remain pending.", league_season)
                    shared[key] = snapshot_loader(*key, force_refresh=True)
                except Exception as exc:
                    shared[key] = exc
            try:
                snapshot = shared[key]
                if isinstance(snapshot, Exception):
                    raise snapshot
                result = refresh_league_week(league, league_season, target_week, snapshot,
                                             current_week=target_week in current_targets, now=stamp)
            except Exception as exc:
                result = _save_error(league, league_season, target_week, exc, now=stamp)
            results.append({"league_id": league["id"], **result})
    return results



def _prepare_lineups_for_refresh(league: dict, season: int, week: int) -> bool | None:
    """Seed every upcoming team before a future statistics feed becomes available.

    Uses only cached schedule/identity reads; background cache warming belongs
    to the durable batch and remains shared across leagues.
    """
    from src.draft_hub.hub_scoring import nfl_week_started, ensure_season_schedule, ensure_team_lineup, week_scoring_team_ids
    started = nfl_week_started(season, week)
    if started is False:
        rules = LeagueRules.model_validate(league.get("rules") or {})
        ensure_season_schedule(league["id"], season=season, rules=rules)
        teams = storage.list_league_teams(league["id"])
        matches = storage.list_week_matchups(league["id"], season, week)
        participating = week_scoring_team_ids(rules, teams, matches, week)
        for team in teams:
            if str(team["id"]) in participating:
                ensure_team_lineup(league["id"], str(team["id"]), season, week, rules=rules)
    return started
