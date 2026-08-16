"""Cached player-context read model (SCORE-23).

Background jobs join weekly inj/no_inj projections, a frozen injury snapshot,
and pre-aggregated sentiment digests into a versioned parquet artifact.

Page-view serving reads that artifact only — never YouTube ingest, LLM, Sleeper
polling, or live ``predict_*``.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from src.config import (
    BEAT_DIGEST_CACHE_VERSION,
    PLAYER_CONTEXT_DIR,
    PROCESSED_DATA_DIR,
    SENTIMENT_FEATURES_PATH,
)
from src.core.projection_context import resolve_projection_context
from src.integrations.injury_snapshot import (
    build_injury_snapshot,
    index_availability_by_player_id,
    name_to_player_ids,
    save_injury_snapshot,
)
from src.projections.weekly_cache import load_weekly_prediction, weekly_fingerprint

POSITIONS = ("qb", "rb", "wr")
SCHEMA_VERSION = "player_context_v1"
_P50_KEYS = ("Projected Points", "P50", "p50")

_CONTEXT_CACHE: dict[str, tuple[str, pd.DataFrame, dict[str, Any]]] = {}

_NOTE_SEGMENT_RE = re.compile(
    r"^\s*(?P<name>.+?)\s*(?:\((?P<status>[^)]*)\))?\s*$"
)


def _json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        num = float(value)
        if math.isnan(num) or math.isinf(num):
            return None
        return num
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, (np.bool_,)):
        return bool(value)
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _pick_num(row: dict[str, Any] | pd.Series, keys: tuple[str, ...]) -> float | None:
    for key in keys:
        if isinstance(row, dict):
            if key not in row:
                continue
            value = row[key]
        else:
            if key not in row.index:
                continue
            value = row[key]
        num = _json_safe(value)
        if isinstance(num, (int, float)):
            return float(num)
    return None


def season_week_context(season: int | None, week: int | None) -> tuple[int, int]:
    path = PROCESSED_DATA_DIR / "qb_mlready.parquet"
    df = pd.read_parquet(path, columns=["season", "week"])
    return resolve_projection_context(df, season, week)


def _artifact_paths(season: int, week: int) -> tuple[Path, Path]:
    PLAYER_CONTEXT_DIR.mkdir(parents=True, exist_ok=True)
    stem = f"{int(season)}_w{int(week)}"
    return (
        PLAYER_CONTEXT_DIR / f"{stem}.parquet",
        PLAYER_CONTEXT_DIR / f"{stem}.meta.json",
    )


def player_context_fingerprint(
    *,
    injury_snapshot_id: str,
    sentiment_mtime_ns: int | None = None,
) -> str:
    parts = [
        f"schema:{SCHEMA_VERSION}",
        f"weekly:{weekly_fingerprint()}",
        f"injury:{injury_snapshot_id}",
        f"digest_cache:{BEAT_DIGEST_CACHE_VERSION}",
    ]
    if sentiment_mtime_ns is not None:
        parts.append(f"sentiment:{sentiment_mtime_ns}")
    elif SENTIMENT_FEATURES_PATH.exists():
        parts.append(f"sentiment:{SENTIMENT_FEATURES_PATH.stat().st_mtime_ns}")
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def slugify_player_name(name: str) -> str:
    text = str(name or "").lower().strip()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_]+", "-", text)
    return text.strip("-")


def parse_opportunity_drivers(
    injury_note: str,
    *,
    name_index: dict[str, str] | None = None,
) -> list[str]:
    """Parse ``Injury Note`` into driver ids (gsis/sleeper) or name slugs."""
    note = str(injury_note or "").strip()
    if not note:
        return []
    name_index = name_index or {}
    drivers: list[str] = []
    seen: set[str] = set()
    for segment in note.split(";"):
        segment = segment.strip()
        if not segment:
            continue
        match = _NOTE_SEGMENT_RE.match(segment)
        raw_name = (match.group("name") if match else segment).strip()
        if not raw_name:
            continue
        mapped = name_index.get(raw_name.lower())
        token = mapped or slugify_player_name(raw_name)
        if not token or token in seen:
            continue
        seen.add(token)
        drivers.append(token)
    return drivers


def _media_signal(row: dict[str, Any] | None) -> str | None:
    if not row:
        return None
    if float(row.get("yt_role_hype_flag") or 0) > 0:
        return "role_up"
    if float(row.get("yt_injury_flag") or 0) > 0:
        return "injury_watch"
    if float(row.get("yt_mention_count") or 0) > 0:
        return "mentioned"
    return None


def _media_source_count(row: dict[str, Any] | None) -> int:
    if not row:
        return 0
    for key in ("narrative_source_count", "yt_channel_count", "yt_mention_count"):
        num = _json_safe(row.get(key))
        if isinstance(num, (int, float)) and num > 0:
            return int(num)
    return 0


def _load_sentiment_index(season: int, week: int) -> dict[str, dict[str, Any]]:
    """Index sentiment feature rows for season/week by player_id (no LLM)."""
    if not SENTIMENT_FEATURES_PATH.exists():
        return {}
    try:
        df = pd.read_parquet(SENTIMENT_FEATURES_PATH)
    except (OSError, ValueError):
        return {}
    if df.empty or "player_id" not in df.columns:
        return {}
    scoped = df
    if "season" in df.columns:
        scoped = scoped[scoped["season"].astype(int) == int(season)]
    if "week" in scoped.columns:
        scoped = scoped[scoped["week"].astype(int) == int(week)]
    if scoped.empty:
        return {}
    index: dict[str, dict[str, Any]] = {}
    for _, row in scoped.iterrows():
        pid = str(row["player_id"])
        index[pid] = {str(k): _json_safe(v) for k, v in row.items()}
    return index


def _cached_digest_summary(
    player_id: str,
    player_name: str,
    season: int,
    week: int,
    sentiment_row: dict[str, Any] | None,
) -> tuple[str | None, str | None]:
    """Read prewarmed fantasy digest cache only — never call LLM."""
    if not sentiment_row:
        return None, None
    try:
        from src.sentiment.analyst_context import compute_evidence_hash, evidence_cache_key
        from src.sentiment.fantasy_digest import _cache_get
    except Exception:
        return None, None

    chapter_notes = str(sentiment_row.get("yt_chapter_notes") or sentiment_row.get("chapter_notes") or "")
    top_sentence = str(
        sentiment_row.get("yt_top_sentence")
        or sentiment_row.get("top_sentence")
        or sentiment_row.get("yt_top_snippet")
        or sentiment_row.get("snippet")
        or ""
    )
    snippet = chapter_notes or top_sentence or str(sentiment_row.get("yt_top_snippet") or "")
    ehash = compute_evidence_hash(
        chapter_notes=chapter_notes,
        top_sentence=top_sentence,
        snippet=snippet,
        sentiment_label=str(sentiment_row.get("sentiment_label") or "neutral"),
        injury_flag=float(sentiment_row.get("yt_injury_flag") or sentiment_row.get("injury_flag") or 0),
        role_hype_flag=float(sentiment_row.get("yt_role_hype_flag") or sentiment_row.get("role_hype_flag") or 0),
        mention_count=float(sentiment_row.get("yt_mention_count") or sentiment_row.get("mention_count") or 0),
    )
    cache_key = evidence_cache_key(
        player_id=player_id,
        player_name=player_name,
        season=season,
        week=week,
        evidence_hash=ehash,
        scope="fantasy|weekly",
    )
    cached = _cache_get("weekly", cache_key)
    if cached:
        return cached, datetime.now(timezone.utc).isoformat()

    # Fallback: materialize template/extractive summary at *build* time only (caller).
    if not snippet and float(sentiment_row.get("yt_mention_count") or 0) <= 0:
        return None, None
    try:
        from src.sentiment.fantasy_digest import build_fantasy_template_or_extractive

        digest, _source = build_fantasy_template_or_extractive(
            player_name,
            scope="weekly",
            snippet=snippet,
            chapter_notes=chapter_notes,
            top_sentence=top_sentence,
            sentiment_label=str(sentiment_row.get("sentiment_label") or "neutral"),
            injury_flag=float(sentiment_row.get("yt_injury_flag") or 0),
            role_hype_flag=float(sentiment_row.get("yt_role_hype_flag") or 0),
            mention_count=float(sentiment_row.get("yt_mention_count") or 0),
        )
        return digest or None, datetime.now(timezone.utc).isoformat()
    except Exception:
        return (snippet or None), datetime.now(timezone.utc).isoformat()


def _load_weekly_pair(season: int, week: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load inj + no_inj weekly artifacts with allow_compute=False."""
    frames_inj: list[pd.DataFrame] = []
    frames_base: list[pd.DataFrame] = []
    for pos in POSITIONS:
        inj = load_weekly_prediction(
            pos,
            season=season,
            week=week,
            apply_injury_adjustments=True,
            allow_compute=False,
        )
        base = load_weekly_prediction(
            pos,
            season=season,
            week=week,
            apply_injury_adjustments=False,
            allow_compute=False,
        )
        if not inj.empty:
            frames_inj.append(inj)
        if not base.empty:
            frames_base.append(base)
    inj_df = pd.concat(frames_inj, ignore_index=True) if frames_inj else pd.DataFrame()
    base_df = pd.concat(frames_base, ignore_index=True) if frames_base else pd.DataFrame()
    return inj_df, base_df


def _row_by_player_id(df: pd.DataFrame) -> dict[str, pd.Series]:
    if df.empty or "player_id" not in df.columns:
        return {}
    out: dict[str, pd.Series] = {}
    for _, row in df.iterrows():
        pid = str(row["player_id"])
        if pid not in out:
            out[pid] = row
    return out


def build_player_context_rows(
    season: int,
    week: int,
    *,
    injury_snapshot: dict[str, Any] | None = None,
    force_injury_refresh: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Join pipeline outputs into per-player context payloads (build path)."""
    if injury_snapshot is None:
        injury_snapshot = build_injury_snapshot(
            season=season,
            week=week,
            force_refresh=force_injury_refresh,
        )
        save_injury_snapshot(injury_snapshot)

    inj_df, base_df = _load_weekly_pair(season, week)
    if inj_df.empty and base_df.empty:
        raise FileNotFoundError(
            f"Weekly prediction artifacts missing for {season} week {week}. "
            "Run weekly/preseason refresh before building player context."
        )

    inj_index = _row_by_player_id(inj_df)
    base_index = _row_by_player_id(base_df)
    player_ids = list(dict.fromkeys([*inj_index.keys(), *base_index.keys()]))

    avail_index = index_availability_by_player_id(injury_snapshot)
    name_index = name_to_player_ids(injury_snapshot)
    # Also index names from weekly rows for driver resolution.
    for pid, row in {**base_index, **inj_index}.items():
        pname = str(row.get("Player") or "").strip().lower()
        if pname and pname not in name_index:
            name_index[pname] = pid

    sentiment_index = _load_sentiment_index(season, week)
    snapshot_id = str(injury_snapshot["injury_snapshot_id"])
    built_at = datetime.now(timezone.utc).isoformat()
    rows: list[dict[str, Any]] = []

    for pid in player_ids:
        inj_row = inj_index.get(pid)
        base_row = base_index.get(pid)
        primary = inj_row if inj_row is not None else base_row
        assert primary is not None

        final_pts = _pick_num(inj_row, _P50_KEYS) if inj_row is not None else None
        base_pts = _pick_num(base_row, _P50_KEYS) if base_row is not None else None
        if final_pts is None:
            final_pts = base_pts
        if base_pts is None:
            base_pts = final_pts
        injury_delta = None
        if base_pts is not None and final_pts is not None:
            injury_delta = round(float(final_pts) - float(base_pts), 2)

        injury_note = ""
        if inj_row is not None:
            injury_note = str(inj_row.get("Injury Note") or "")
        drivers = parse_opportunity_drivers(injury_note, name_index=name_index)
        included = bool(injury_delta and abs(injury_delta) >= 0.01)

        avail = avail_index.get(pid) or {
            "status": None,
            "practice": None,
            "updated_at": None,
        }
        # Prefer projection Injury Status when snapshot has no status.
        if not avail.get("status") and inj_row is not None:
            status = str(inj_row.get("Injury Status") or "").strip() or None
            if status:
                avail = {**avail, "status": status}

        sent = sentiment_index.get(pid)
        signal = _media_signal(sent)
        source_count = _media_source_count(sent)
        player_name = str(primary.get("Player") or "")
        summary, media_updated = _cached_digest_summary(
            pid, player_name, season, week, sent
        )
        if sent and not media_updated and SENTIMENT_FEATURES_PATH.exists():
            media_updated = datetime.fromtimestamp(
                SENTIMENT_FEATURES_PATH.stat().st_mtime, tz=timezone.utc
            ).isoformat()
        media_state = "current" if sent and source_count > 0 else "none"
        if media_state == "none":
            signal = None
            summary = None

        payload = {
            "player_id": pid,
            "player_name": player_name or None,
            "position": str(primary.get("Position") or "").upper() or None,
            "team": primary.get("Team"),
            "projection": {
                "base": None if base_pts is None else round(float(base_pts), 2),
                "final": None if final_pts is None else round(float(final_pts), 2),
                "injury_delta": injury_delta,
                "injury_snapshot_id": snapshot_id,
            },
            "availability": {
                "status": avail.get("status"),
                "practice": avail.get("practice"),
                "updated_at": avail.get("updated_at"),
            },
            "opportunity_adjustment": {
                "points": injury_delta if included else (0.0 if injury_delta is not None else None),
                "drivers": drivers,
                "included": included,
            },
            "media_context": {
                "state": media_state,
                "signal": signal,
                "source_count": source_count,
                "summary": summary,
                "updated_at": media_updated,
                "affects_projection": False,
            },
            "meta": {
                "season": int(season),
                "week": int(week),
                "context_built_at": built_at,
                "schema_version": SCHEMA_VERSION,
            },
        }
        rows.append(payload)

    meta = {
        "season": int(season),
        "week": int(week),
        "schema_version": SCHEMA_VERSION,
        "injury_snapshot_id": snapshot_id,
        "injury_snapshot_built_at": injury_snapshot.get("built_at"),
        "built_at": built_at,
        "rows": len(rows),
        "fingerprint": player_context_fingerprint(injury_snapshot_id=snapshot_id),
        "weekly_fingerprint": weekly_fingerprint(),
    }
    return rows, meta


def save_player_context_artifact(
    season: int,
    week: int,
    *,
    rows: list[dict[str, Any]] | None = None,
    meta: dict[str, Any] | None = None,
    force_injury_refresh: bool = False,
) -> Path:
    """Persist player-context parquet + meta sidecar; refresh in-process cache."""
    if rows is None or meta is None:
        rows, meta = build_player_context_rows(
            season,
            week,
            force_injury_refresh=force_injury_refresh,
        )
    parquet_path, meta_path = _artifact_paths(season, week)
    frame = pd.DataFrame(
        {
            "player_id": [r["player_id"] for r in rows],
            "player_name": [r.get("player_name") for r in rows],
            "position": [r.get("position") for r in rows],
            "team": [r.get("team") for r in rows],
            "payload_json": [json.dumps(r, default=str) for r in rows],
        }
    )
    frame.to_parquet(parquet_path, index=False)
    meta_path.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
    fp = str(meta["fingerprint"])
    _CONTEXT_CACHE[f"{season}:w{week}"] = (fp, frame, meta)
    return parquet_path


def prewarm_player_context(
    season: int,
    week: int,
    *,
    force_injury_refresh: bool = False,
) -> dict[str, Any]:
    """Job helper: build + save player-context artifact."""
    path = save_player_context_artifact(
        season,
        week,
        force_injury_refresh=force_injury_refresh,
    )
    meta_path = _artifact_paths(season, week)[1]
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    return {
        "status": "ok",
        "path": str(path),
        "rows": meta.get("rows"),
        "fingerprint": meta.get("fingerprint"),
        "injury_snapshot_id": meta.get("injury_snapshot_id"),
        "built_at": meta.get("built_at"),
    }


def invalidate_player_context_cache() -> None:
    _CONTEXT_CACHE.clear()


def load_player_context_frame(
    season: int,
    week: int,
    *,
    require_fresh: bool = True,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Serve-only load of player-context artifact (no compute / no network)."""
    key = f"{int(season)}:w{int(week)}"
    parquet_path, meta_path = _artifact_paths(season, week)
    if not parquet_path.exists() or not meta_path.exists():
        raise FileNotFoundError(
            f"Player context artifact missing for {season} week {week}. "
            "Run player-context prewarm / weekly refresh."
        )
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise FileNotFoundError(
            f"Player context meta unreadable for {season} week {week}"
        ) from exc

    expected_fp = player_context_fingerprint(
        injury_snapshot_id=str(meta.get("injury_snapshot_id") or ""),
    )
    cached = _CONTEXT_CACHE.get(key)
    if cached is not None and cached[0] == meta.get("fingerprint"):
        return cached[1].copy(), dict(cached[2])

    if require_fresh and meta.get("fingerprint") != expected_fp:
        # Stale relative to current weekly/sentiment inputs — still serve with
        # staleness flag rather than recomputing on the request path.
        meta = {**meta, "stale": True, "expected_fingerprint": expected_fp}
    else:
        meta = {**meta, "stale": False}

    df = pd.read_parquet(parquet_path)
    _CONTEXT_CACHE[key] = (str(meta.get("fingerprint") or ""), df.copy(), meta)
    return df, meta


def _payloads_from_frame(df: pd.DataFrame) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if df.empty or "payload_json" not in df.columns:
        return out
    for raw in df["payload_json"].tolist():
        try:
            out.append(json.loads(raw))
        except (TypeError, json.JSONDecodeError):
            continue
    return out


def get_player_context(
    player_id: str,
    *,
    season: int | None = None,
    week: int | None = None,
) -> dict[str, Any]:
    """Serve a single player's cached context payload."""
    pid = str(player_id or "").strip()
    if not pid:
        raise ValueError("player_id is required")
    resolved_season, resolved_week = season_week_context(season, week)
    df, meta = load_player_context_frame(resolved_season, resolved_week)
    if "player_id" not in df.columns:
        raise FileNotFoundError("Player context artifact has no player_id column")
    hit = df[df["player_id"].astype(str) == pid]
    if hit.empty:
        raise ValueError(f"No player context for player_id={pid}")
    payload = json.loads(str(hit.iloc[0]["payload_json"]))
    payload["meta"] = {
        **(payload.get("meta") or {}),
        "season": resolved_season,
        "week": resolved_week,
        "artifact_built_at": meta.get("built_at"),
        "injury_snapshot_id": meta.get("injury_snapshot_id"),
        "fingerprint": meta.get("fingerprint"),
        "stale": bool(meta.get("stale")),
        "schema_version": meta.get("schema_version") or SCHEMA_VERSION,
    }
    return payload


def list_player_context(
    *,
    season: int | None = None,
    week: int | None = None,
    player_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Serve the full (or filtered) player-context list for a slate."""
    resolved_season, resolved_week = season_week_context(season, week)
    df, meta = load_player_context_frame(resolved_season, resolved_week)
    players = _payloads_from_frame(df)
    if player_ids:
        wanted = {str(p).strip() for p in player_ids if str(p).strip()}
        players = [p for p in players if str(p.get("player_id")) in wanted]
    return {
        "count": len(players),
        "players": players,
        "meta": {
            "season": resolved_season,
            "week": resolved_week,
            "built_at": meta.get("built_at"),
            "injury_snapshot_id": meta.get("injury_snapshot_id"),
            "fingerprint": meta.get("fingerprint"),
            "stale": bool(meta.get("stale")),
            "schema_version": meta.get("schema_version") or SCHEMA_VERSION,
            "rows": meta.get("rows"),
        },
    }
