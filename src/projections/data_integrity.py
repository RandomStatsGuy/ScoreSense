"""Read-only, structured checks for the saved projection data supply chain.

Run from refresh/CI or the operational CLI, never from a player-card request.
Scheduled games without a player row do not prove that player participated.
"""
from __future__ import annotations

import json
from typing import Any

import pandas as pd
import pyarrow.parquet as pq

from src.config import PROCESSED_DATA_DIR
from src.core.projection_read_scope import projection_read_scope
from src.core.schedule_utils import SCHEDULE_CACHE
from src.draft_hub.player_identity import PlayerIdentityError, read_player_identity
from src.projections.player_card_history import recorded_player_history
from src.projections.ros_cache import load_ros_prediction
from src.projections.weekly_cache import load_weekly_prediction


def _diagnostic_safe(value):
    if isinstance(value, dict):
        return {str(k): _diagnostic_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_diagnostic_safe(v) for v in value]
    if value is None or value is pd.NA:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, float) and not float("-inf") < value < float("inf"):
        return None
    return value.item() if hasattr(value, "item") else value


def audit_projection_integrity(*, season: int, week: int, player_ids=(),
                               apply_injury_adjustments: bool = True) -> dict[str, Any]:
    """Inspect actual cached inputs/outputs without inference, fetches, or writes."""
    if not 1 <= int(week) <= 18:
        raise ValueError("week must be a regular-season week from 1 through 18")
    report: dict[str, Any] = {"schema_version": 1, "season": int(season), "week": int(week),
        "scoring": "standard_ppr", "apply_injury_adjustments": bool(apply_injury_adjustments),
        "sources": {}, "artifacts": {}, "players": [], "findings": []}

    def finding(severity, code, source, **context):
        report["findings"].append({"severity": severity, "code": code, "source": source,
                                   "season": season, "week": week, **context})

    completed_week = None
    try:
        schedule = pd.read_parquet(SCHEDULE_CACHE)
        regular = schedule[(schedule["season"] == season) & schedule["game_type"].eq("REG")
                           & schedule["week"].between(1, week - 1)]
        finals = regular[pd.to_numeric(regular["home_score"], errors="coerce").notna()
                         & pd.to_numeric(regular["away_score"], errors="coerce").notna()]
        completed_week = int(finals["week"].max()) if len(finals) else None
        report["sources"]["schedule"] = {"latest_completed_game_week": completed_week,
            "completed_games": len(finals), "scheduled_prior_games": len(regular)}
    except Exception as exc:
        finding("warning", "schedule_unavailable", "schedule", reason=type(exc).__name__)

    for position in ("qb", "rb", "wr"):
        path = PROCESSED_DATA_DIR / f"{position}_mlready.parquet"
        try:
            columns = set(pq.read_schema(path).names)
            required = {"player_id", "season", "week"}
            if not required <= columns:
                raise ValueError("source_schema_mismatch")
            frame = pd.read_parquet(path, columns=sorted(required))
            current = frame[pd.to_numeric(frame["season"], errors="coerce").eq(season)
                            & pd.to_numeric(frame["week"], errors="coerce").between(1, 18)]
            cutoff = int(current["week"].max()) if len(current) else None
            stat = path.stat()
            report["sources"][position] = {"source_through_week": cutoff, "rows": len(current),
                "source_revision": {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size},
                "source_ingested_at": None}
            duplicates = current.duplicated(["player_id", "season", "week"], keep=False)
            if duplicates.any():
                finding("error", "duplicate_player_game_keys", str(path),
                    examples=current.loc[duplicates].head(8).to_dict(orient="records"))
            if current["player_id"].isna().any() or current["player_id"].astype(str).str.strip().eq("").any():
                finding("error", "missing_player_identity", str(path))
            if completed_week is not None and (cutoff is None or cutoff < completed_week):
                finding("warning", "source_cutoff_behind_completed_games", str(path),
                        source_through_week=cutoff, latest_completed_game_week=completed_week)
        except Exception as exc:
            finding("error", "feature_source_unavailable", str(path), reason=str(exc)[:160])

    # Recorded results have a different contract from model features. Inspect
    # their provenance even when no individual player was requested.
    from src.etl.recorded_games import RECORDED_GAMES_FILENAME, RECORDED_GAMES_VERSION, METADATA_KEY
    history_path = PROCESSED_DATA_DIR / RECORDED_GAMES_FILENAME
    if not history_path.exists():
        finding("warning", "legacy_source_provenance", "recorded_history",
                reason="raw_recorded_derivative_not_published")
    else:
        try:
            schema = pq.read_schema(history_path)
            metadata = json.loads((schema.metadata or {}).get(METADATA_KEY, b"{}"))
            required = {"player_id", "season", "week", "position", "team", "game_type", "points"}
            if not required <= set(schema.names) or metadata.get("version") != RECORDED_GAMES_VERSION or metadata.get("scoring") != "standard_ppr":
                raise ValueError("recorded_source_schema_mismatch")
            recorded = pd.read_parquet(history_path, columns=sorted(required))
            current = recorded[recorded["season"].eq(season)]
            report["sources"]["recorded_games"] = metadata
            duplicates = current.duplicated(["player_id", "season", "week"], keep=False)
            if duplicates.any():
                finding("error", "duplicate_recorded_game_keys", "recorded_history",
                        examples=current.loc[duplicates, ["player_id", "season", "week"]].head(8).to_dict(orient="records"))
            if current["player_id"].isna().any() or current["game_type"].isna().any():
                finding("error", "invalid_recorded_game_context", "recorded_history")
            regular = current[current["game_type"].eq("REG") & current["week"].between(1, week - 1)]
            if pd.to_numeric(regular["points"], errors="coerce").isna().any():
                finding("warning", "missing_recorded_scores", "recorded_history")
        except Exception as exc:
            finding("error", "recorded_source_invalid", "recorded_history", reason=str(exc)[:160])

    pools = {}
    with projection_read_scope(anonymous=True):
        for kind, loader in (("weekly", load_weekly_prediction), ("ros", load_ros_prediction)):
            for position in ("qb", "rb", "wr"):
                key = f"{kind}:{position}"
                try:
                    pool = loader(position, season=season, week=week,
                        apply_injury_adjustments=apply_injury_adjustments, allow_compute=False, allow_stale=True)
                    pools[key] = pool
                    diagnostic = dict(pool.attrs.get("artifact_status") or {"status": "ready" if len(pool) else "missing"})
                    report["artifacts"][key] = diagnostic
                    if diagnostic.get("artifact_version") == 0:
                        finding("warning", "legacy_artifact_publication_unverified", key,
                                reason="legacy_sidecar_pair_has_no_coherent_generation_attestation")
                    if diagnostic.get("sidecar_status") not in {None, "matching", "legacy"}:
                        finding("warning", "artifact_sidecar_out_of_date", key, diagnostic=diagnostic)
                    if diagnostic["status"] != "ready":
                        finding("error" if diagnostic["status"] in {"invalid", "missing"} else "warning",
                                f"artifact_{diagnostic['status']}", key, diagnostic=diagnostic)
                    seen = {}
                    for pid in pool.get("player_id", pd.Series(dtype=str)).astype(str):
                        try:
                            identity = read_player_identity(pid, season=season)
                        except PlayerIdentityError as exc:
                            finding("error", "ambiguous_identity", key, requested_id=pid, reason=str(exc))
                            continue
                        canonical = identity["canonical_id"]
                        if canonical in seen:
                            finding("error", "duplicate_canonical_projection", key,
                                    requested_id=pid, resolved_id=canonical, other_id=seen[canonical])
                        seen[canonical] = pid
                        if identity["status"] == "unresolved":
                            finding("warning", "unresolved_identity", key, requested_id=pid, resolved_id=canonical)
                except Exception as exc:
                    finding("error", "artifact_read_failed", key, reason=str(exc)[:160])

        from src.draft_hub.draft_pool_cache import load_draft_pool
        try:
            pool = load_draft_pool(season, allow_compute=False, apply_identity=False)
            diagnostic = dict(pool.attrs.get("artifact_status") or {"status": "ready" if len(pool) else "missing"})
            report["artifacts"]["draft_pool"] = diagnostic
            if diagnostic["status"] != "ready":
                finding("error" if diagnostic["status"] == "invalid" else "warning",
                        f"artifact_{diagnostic['status']}", "draft_pool", diagnostic=diagnostic)
            if diagnostic.get("artifact_version") == 0:
                finding("warning", "legacy_artifact_publication_unverified", "draft_pool")
            if diagnostic.get("sidecar_status") not in {None, "matching", "legacy"}:
                finding("warning", "artifact_sidecar_out_of_date", "draft_pool", diagnostic=diagnostic)
        except Exception as exc:
            finding("error", "artifact_read_failed", "draft_pool", reason=str(exc)[:160])

        for pid in dict.fromkeys(str(pid) for pid in player_ids):
            try:
                identity = read_player_identity(pid, season=season)
                if identity["status"] == "unresolved":
                    finding("warning", "unresolved_requested_identity", "player", requested_id=pid,
                            resolved_id=identity["canonical_id"])
                position = str(identity.get("position") or "").lower()
                model = {"te": "wr", "fb": "rb"}.get(position, position)
                history = recorded_player_history(identity["canonical_id"], position, season, week, preseason=week == 1)
                result = {"identity": identity, "history_coverage": history.get("history_coverage"), "projections": {}}
                for kind in ("weekly", "ros"):
                    pool = pools.get(f"{kind}:{model}", pd.DataFrame())
                    hits = pool[pool["player_id"].astype(str).isin(identity["aliases"])] if "player_id" in pool else pool
                    result["projections"][kind] = {"matched_rows": len(hits)}
                    if model in {"qb", "rb", "wr"} and len(hits) != 1:
                        finding("error" if len(hits) > 1 else "warning",
                                "duplicate_requested_projection" if len(hits) > 1 else "requested_projection_missing",
                                f"{kind}:{model}", requested_id=pid, resolved_id=identity["canonical_id"],
                                matched_rows=len(hits))
                report["players"].append(result)
                coverage = history.get("history_coverage") or {}
                if coverage.get("status") in {"partial", "unavailable"}:
                    finding("warning", "player_history_incomplete", "recorded_history", requested_id=pid,
                            resolved_id=identity["canonical_id"], coverage=coverage)
            except PlayerIdentityError as exc:
                finding("error", "ambiguous_identity", "player", requested_id=pid, reason=str(exc))

    # This is an API-process snapshot only; durable refresh failures are separate.
    try:
        from app.projection_recovery import projection_recovery_snapshot
        report["recovery"] = projection_recovery_snapshot()
        for job in report["recovery"]:
            if job.get("status") == "failed":
                finding("error", "recovery_failed", "projection_recovery", job=job)
        from src.jobs.weekly_refresh import get_refresh_status
        refresh = get_refresh_status()
        report["refresh"] = {key: refresh.get(key) for key in ("status", "season", "week", "completed_at", "error", "warnings")}
        if refresh.get("status") == "error":
            finding("error", "refresh_failed", "weekly_refresh", reason=refresh.get("error"))
    except ImportError:
        report["recovery"] = []
    report["status"] = ("failed" if any(f["severity"] == "error" for f in report["findings"])
                        else "warning" if report["findings"] else "passed")
    # Reject accidental NaN diagnostics rather than publishing nonstandard JSON.
    report = _diagnostic_safe(report)
    json.dumps(report, allow_nan=False, default=str)
    return report


def validate_recorded_backfill(*, season: int, week: int) -> dict[str, Any]:
    """Require fresh raw coverage for every finalized prior-week team game.

    This gate checks source coverage, not per-player participation. Player cards
    retain their separate conservative history/participation coverage contract.
    """
    from src.core.team_codes import normalize_team_for_match
    from src.etl.recorded_games import RECORDED_GAMES_FILENAME, METADATA_KEY, RECORDED_GAMES_VERSION
    schedule = pd.read_parquet(SCHEDULE_CACHE)
    needed = {"season", "week", "game_type", "home_score", "away_score", "home_team", "away_team"}
    if not needed.issubset(schedule.columns):
        raise ValueError("source_backfill_schedule_schema_invalid")
    completed = schedule[
        pd.to_numeric(schedule["season"], errors="coerce").eq(season)
        & schedule["game_type"].eq("REG")
        & pd.to_numeric(schedule["week"], errors="coerce").between(1, week - 1)
        & pd.to_numeric(schedule["home_score"], errors="coerce").notna()
        & pd.to_numeric(schedule["away_score"], errors="coerce").notna()
    ]
    path = PROCESSED_DATA_DIR / RECORDED_GAMES_FILENAME
    schema = pq.read_schema(path)
    metadata = json.loads((schema.metadata or {}).get(METADATA_KEY, b"{}"))
    if metadata.get("version") != RECORDED_GAMES_VERSION or metadata.get("scoring") != "standard_ppr":
        raise ValueError("source_backfill_recorded_schema_invalid")
    recorded = pd.read_parquet(path, columns=["season", "week", "team", "game_type", "points"])
    current = recorded[recorded["season"].eq(season) & recorded["game_type"].eq("REG")]
    actual = {(int(row.week), normalize_team_for_match(row.team))
              for row in current.itertuples()}
    expected = {(int(row.week), normalize_team_for_match(team))
                for row in completed.itertuples()
                for team in (row.home_team, row.away_team)}
    missing = sorted(expected - actual)
    if missing:
        raise ValueError("source_backfill_incomplete: missing finalized team games "
                         + ", ".join(f"week {w} {team}" for w, team in missing[:12]))
    return {"status": "ready", "season": season, "week": week,
            "completed_games": len(completed), "completed_team_games": len(expected),
            "source_through_week": int(current["week"].max()) if len(current) else None,
            "source_ingested_at": metadata.get("ingested_at"),
            "missing_score_rows": int(current["points"].isna().sum())}
