"""SCORE-33 — adaptive centralized Sleeper injury polling.

Browsers never initiate Sleeper network calls. A server-owned poller refreshes
``sleeper_players.json`` on a cadence that adapts by season phase / reporting
window. Request paths serve the current on-disk snapshot (stale-while-revalidate)
and may *enqueue* a due poll without blocking on the network.

Manual refresh is rate-limited enqueue + immediate serve of the current snapshot.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from src.config import (
    CACHE_DIR,
    INJURY_POLL_INSEASON_SECONDS,
    INJURY_POLL_MANUAL_COOLDOWN_SECONDS,
    INJURY_POLL_OFFSEASON_SECONDS,
    INJURY_POLL_REPORTING_SECONDS,
    INJURY_POLL_STATUS_PATH,
)
from src.integrations.sleeper import PLAYERS_CACHE, get_nfl_state, load_sleeper_players

logger = logging.getLogger(__name__)

PHASE_REPORTING = "reporting"
PHASE_INSEASON = "inseason"
PHASE_OFFSEASON = "offseason"

INJURY_STALE_SAFEGUARD_MESSAGE = (
    "Injury status changed after this projection was calculated. Refresh to update."
)

_ET = ZoneInfo("America/New_York")
_STATUS_LOCK = threading.Lock()
_POLL_LOCK = threading.Lock()

# Mon / Wed–Fri injury reports + Thu/Sun/Mon game windows (Eastern).
# Tue / Sat use the slower in-season cadence.
_REPORTING_WEEKDAYS = frozenset({0, 2, 3, 4, 6})  # Mon=0 … Sun=6


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _utc_now_iso() -> str:
    return _utc_now().isoformat()


def _parse_iso(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    try:
        ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts


def resolve_injury_poll_phase(
    nfl_state: dict[str, Any] | None = None,
    *,
    now: datetime | None = None,
) -> str:
    """Map NFL calendar + Eastern weekday → poll phase."""
    state = nfl_state if nfl_state is not None else {}
    if not state:
        try:
            state = get_nfl_state(use_cache=True)
        except Exception:
            state = {}
    season_type = str(state.get("season_type") or "off").lower()
    if season_type in {"off", "pre"}:
        return PHASE_OFFSEASON

    clock = now or _utc_now()
    if clock.tzinfo is None:
        clock = clock.replace(tzinfo=timezone.utc)
    et = clock.astimezone(_ET)
    if et.weekday() in _REPORTING_WEEKDAYS:
        return PHASE_REPORTING
    return PHASE_INSEASON


def cadence_seconds_for_phase(phase: str) -> int:
    if phase == PHASE_REPORTING:
        return int(INJURY_POLL_REPORTING_SECONDS)
    if phase == PHASE_INSEASON:
        return int(INJURY_POLL_INSEASON_SECONDS)
    return int(INJURY_POLL_OFFSEASON_SECONDS)


def _default_status() -> dict[str, Any]:
    return {
        "schema_version": "injury_poll_v1",
        "is_refreshing": False,
        "last_polled_at": None,
        "last_success_at": None,
        "last_error": None,
        "last_manual_enqueue_at": None,
        "phase": PHASE_OFFSEASON,
        "cadence_seconds": cadence_seconds_for_phase(PHASE_OFFSEASON),
        "next_poll_at": None,
        "players_cache_mtime": None,
        "source": "sleeper_players",
    }


def _load_status() -> dict[str, Any]:
    if not INJURY_POLL_STATUS_PATH.exists():
        return _default_status()
    try:
        raw = json.loads(INJURY_POLL_STATUS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return _default_status()
    if not isinstance(raw, dict):
        return _default_status()
    out = _default_status()
    out.update(raw)
    return out


def _save_status(status: dict[str, Any]) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    INJURY_POLL_STATUS_PATH.write_text(
        json.dumps(status, indent=2, default=str),
        encoding="utf-8",
    )


def _players_cache_mtime_iso() -> str | None:
    if not PLAYERS_CACHE.exists():
        return None
    try:
        return datetime.fromtimestamp(
            PLAYERS_CACHE.stat().st_mtime, tz=timezone.utc
        ).isoformat()
    except OSError:
        return None


def _enrich_status(status: dict[str, Any], *, now: datetime | None = None) -> dict[str, Any]:
    """Attach live phase / cadence / due flags without mutating disk."""
    clock = now or _utc_now()
    try:
        nfl_state = get_nfl_state(use_cache=True)
    except Exception:
        nfl_state = {}
    phase = resolve_injury_poll_phase(nfl_state, now=clock)
    cadence = cadence_seconds_for_phase(phase)
    last_polled = _parse_iso(status.get("last_polled_at") or status.get("last_success_at"))
    next_poll_at: str | None = status.get("next_poll_at")
    poll_due = False
    if last_polled is None:
        poll_due = True
        next_poll_at = clock.isoformat()
    else:
        due_at = last_polled.timestamp() + cadence
        next_poll_at = datetime.fromtimestamp(due_at, tz=timezone.utc).isoformat()
        poll_due = clock.timestamp() >= due_at

    season_type = str((nfl_state or {}).get("season_type") or "").lower() or None
    return {
        **status,
        "phase": phase,
        "cadence_seconds": cadence,
        "next_poll_at": next_poll_at,
        "poll_due": bool(poll_due) and not bool(status.get("is_refreshing")),
        "is_refreshing": bool(status.get("is_refreshing")),
        "players_cache_mtime": _players_cache_mtime_iso(),
        "players_cache_exists": PLAYERS_CACHE.exists(),
        "season_type": season_type,
        "manual_cooldown_seconds": int(INJURY_POLL_MANUAL_COOLDOWN_SECONDS),
    }


def get_injury_poll_status(*, now: datetime | None = None) -> dict[str, Any]:
    """Read poller status (no network side effects beyond cached NFL state)."""
    with _STATUS_LOCK:
        status = _load_status()
    return _enrich_status(status, now=now)


def run_injury_poll(
    force: bool = False,
    recompute_overlays: bool = True,
    trigger: str = "scheduled",
) -> dict[str, Any]:
    """Fetch Sleeper players → disk cache; optionally team-scope overlay recompute.

    Safe to call from a background worker / cron. Never invoked by browser request
    handlers synchronously on the hot path.
    """
    if not _POLL_LOCK.acquire(blocking=False):
        status = get_injury_poll_status()
        status["status"] = "already_running"
        return status

    try:
        with _STATUS_LOCK:
            status = _load_status()
            if status.get("is_refreshing") and not force:
                out = _enrich_status(status)
                out["status"] = "already_running"
                return out
            status["is_refreshing"] = True
            status["last_error"] = None
            status["last_polled_at"] = _utc_now_iso()
            status["trigger"] = trigger
            _save_status(status)

        try:
            load_sleeper_players(force_refresh=True)
            # Refresh NFL state cache while we are already on the network path.
            try:
                get_nfl_state(use_cache=False)
            except Exception:
                pass

            overlay_result: dict[str, Any] | None = None
            if recompute_overlays:
                try:
                    from src.projections.injury_overlay import recompute_injury_overlays
                    from src.projections.player_context import season_week_context

                    season, week = season_week_context(None, None)
                    overlay_result = recompute_injury_overlays(
                        season,
                        week,
                        force=force,
                        force_injury_refresh=False,  # use disk we just wrote
                    )
                except Exception as exc:
                    logger.warning("Injury overlay recompute after poll failed: %s", exc)
                    overlay_result = {"status": "error", "error": str(exc)}

            with _STATUS_LOCK:
                status = _load_status()
                now_iso = _utc_now_iso()
                status["is_refreshing"] = False
                status["last_success_at"] = now_iso
                status["last_polled_at"] = now_iso
                status["last_error"] = None
                status["players_cache_mtime"] = _players_cache_mtime_iso()
                status["last_overlay"] = (
                    {
                        "status": (overlay_result or {}).get("status"),
                        "injury_snapshot_id": (overlay_result or {}).get(
                            "injury_snapshot_id"
                        ),
                        "material_change": (overlay_result or {}).get("material_change"),
                        "recomputed_teams": (overlay_result or {}).get(
                            "recomputed_teams"
                        ),
                    }
                    if overlay_result
                    else None
                )
                phase = resolve_injury_poll_phase()
                cadence = cadence_seconds_for_phase(phase)
                status["phase"] = phase
                status["cadence_seconds"] = cadence
                due_at = _utc_now().timestamp() + cadence
                status["next_poll_at"] = datetime.fromtimestamp(
                    due_at, tz=timezone.utc
                ).isoformat()
                _save_status(status)

            out = _enrich_status(status)
            out["status"] = "ok"
            out["overlay"] = overlay_result
            return out
        except Exception as exc:
            logger.exception("Injury poll failed")
            with _STATUS_LOCK:
                status = _load_status()
                status["is_refreshing"] = False
                status["last_error"] = str(exc)
                status["last_polled_at"] = _utc_now_iso()
                _save_status(status)
            out = _enrich_status(status)
            out["status"] = "error"
            out["error"] = str(exc)
            return out
    finally:
        _POLL_LOCK.release()


def maybe_tick_injury_poll(*, enqueue: bool = True) -> dict[str, Any]:
    """If the adaptive cadence is due, enqueue (or run) a poll.

    Returns the current status. When ``enqueue`` is True the caller is expected
    to schedule ``run_injury_poll`` via a background executor; this helper only
    marks the intent and reports whether work is due.
    """
    status = get_injury_poll_status()
    if status.get("is_refreshing"):
        status["tick"] = "in_flight"
        return status
    if not status.get("poll_due"):
        status["tick"] = "not_due"
        return status
    status["tick"] = "due"
    status["should_enqueue"] = bool(enqueue)
    return status


def enqueue_manual_injury_refresh(
    *,
    force: bool = False,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Rate-limited manual refresh enqueue. Does not hit Sleeper itself.

    Returns ``{status, allowed, poll, retry_after_seconds?}``.
    """
    clock = now or _utc_now()
    with _STATUS_LOCK:
        status = _load_status()
        last_manual = _parse_iso(status.get("last_manual_enqueue_at"))
        cooldown = int(INJURY_POLL_MANUAL_COOLDOWN_SECONDS)
        if (
            not force
            and last_manual is not None
            and (clock - last_manual).total_seconds() < cooldown
        ):
            remaining = cooldown - int((clock - last_manual).total_seconds())
            enriched = _enrich_status(status, now=clock)
            return {
                "status": "rate_limited",
                "allowed": False,
                "retry_after_seconds": max(1, remaining),
                "poll": enriched,
                "should_enqueue": False,
            }
        status["last_manual_enqueue_at"] = clock.isoformat()
        _save_status(status)

    enriched = _enrich_status(status, now=clock)
    return {
        "status": "queued",
        "allowed": True,
        "poll": enriched,
        "should_enqueue": True,
        "trigger": "manual",
    }


def parse_freshness_timestamp(value: Any) -> datetime | None:
    """Parse ISO / epoch ms / epoch s into aware UTC datetime."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        ts = float(value)
        if ts > 1e12:
            ts = ts / 1000.0
        try:
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    return _parse_iso(value)


def compute_inclusion_trust(
    *,
    opportunity_included: bool,
    artifact_stale: bool,
    projection_freshness_at: Any,
    injury_status_freshness_at: Any,
) -> dict[str, Any]:
    """SCORE-33 stale safeguard for \"Included in projection\" labeling.

    Only label included when the projection snapshot is ≥ as recent as the
    displayed injury status (and the artifact is not fingerprint-stale).
    """
    proj_at = parse_freshness_timestamp(projection_freshness_at)
    inj_at = parse_freshness_timestamp(injury_status_freshness_at)
    stale_vs_projection = bool(
        inj_at is not None and proj_at is not None and proj_at < inj_at
    )
    can_label = bool(opportunity_included) and not bool(artifact_stale) and not stale_vs_projection
    message = INJURY_STALE_SAFEGUARD_MESSAGE if stale_vs_projection else None
    return {
        "included": bool(opportunity_included),
        "can_label_included": can_label,
        "stale_vs_projection": stale_vs_projection,
        "message": message,
        "projection_freshness_at": proj_at.isoformat() if proj_at else None,
        "injury_status_freshness_at": inj_at.isoformat() if inj_at else None,
    }


def main() -> None:
    """Cron / ops entry: ``python -m src.integrations.injury_poll``."""
    import argparse

    parser = argparse.ArgumentParser(description="Adaptive Sleeper injury poll (SCORE-33)")
    parser.add_argument("--force", action="store_true", help="Run even if cadence not due")
    parser.add_argument(
        "--no-overlays",
        action="store_true",
        help="Skip injury-overlay recompute after poll",
    )
    parser.add_argument(
        "--status-only",
        action="store_true",
        help="Print poll status and exit",
    )
    args = parser.parse_args()
    if args.status_only:
        print(json.dumps(get_injury_poll_status(), indent=2, default=str))
        return
    status = get_injury_poll_status()
    if not args.force and not status.get("poll_due") and not status.get("is_refreshing"):
        print(json.dumps({**status, "status": "skipped_not_due"}, indent=2, default=str))
        return
    result = run_injury_poll(
        force=bool(args.force),
        recompute_overlays=not args.no_overlays,
        trigger="cli",
    )
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
