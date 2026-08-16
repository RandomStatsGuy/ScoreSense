"""Structured \"Why this projection?\" payload from weekly artifacts + sentiment overlay.

Model-derived signals and narrative/sentiment context are kept separate.
Hot path is cache/artifact driven — no YouTube or Sleeper live scraping.
"""

from __future__ import annotations

import math
from typing import Any, Iterable

import numpy as np
import pandas as pd

from src.config import PROCESSED_DATA_DIR, SENTIMENT_FEATURES_PATH
from src.core.opportunity import pick_opportunity_adjustment
from src.core.projection_context import resolve_projection_context
from src.projections.player_compare import volatility
from src.projections.weekly_cache import load_weekly_prediction
from src.sentiment.aggregate import load_sentiment_features
from src.sentiment.display import sentiment_label, sentiment_label_text, sentiment_summary
from src.sentiment.fantasy_digest import extractive_fantasy_digest, fantasy_digest_for_player

POSITIONS = ("qb", "rb", "wr")

_P50_KEYS = ("Projected Points", "P50", "p50")
_P10_KEYS = ("Low (P10)", "P10", "p10")
_P90_KEYS = ("High (P90)", "P90", "p90")

# Opportunity / usage thresholds (artifact-relative).
_OPPORTUNITY_ADJUSTMENT_UP = 0.05
_SHARE_PCT_UP = 0.65
_SHARE_PCT_DOWN = 0.35
_OPP_RANK_FAVORABLE = 22  # higher Opp Def Rank = softer (more EPA allowed)
_OPP_RANK_TOUGH = 10
_VOL_HIGH = 0.70
_VOL_LOW = 0.35

_NARRATIVE_DISCLAIMER = (
    "Sentiment and beat/fantasy digests are contextual overlays — "
    "they are not ScoreSense projection drivers."
)

_USAGE_SHARE_BY_POS = {
    "qb": ("targets_avg",),  # rarely used; fallback path mostly skips
    "rb": ("carry_share_avg", "target_share_avg", "targets_avg"),
    "wr": ("target_share_avg", "targets_avg", "air_yards_share_avg"),
}


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


def _pick_num(row: dict[str, Any] | pd.Series, keys: Iterable[str]) -> float | None:
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


def _signal(
    *,
    signal_id: str,
    label: str,
    direction: str,
    strength: str,
    detail: str,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": signal_id,
        "label": label,
        "direction": direction,  # up | down | neutral
        "strength": strength,  # high | medium | low
        "source": "model_context",
        "detail": detail,
        "metrics": metrics or {},
    }


def _ensure_weekly_pool(
    position: str,
    season: int,
    week: int,
    *,
    apply_injury_adjustments: bool,
    compute_fn: Any | None = None,
) -> pd.DataFrame:
    preds = load_weekly_prediction(
        position,
        season=season,
        week=week,
        apply_injury_adjustments=apply_injury_adjustments,
        allow_compute=False,
    )
    if not preds.empty:
        return preds
    if compute_fn is not None:
        compute_fn(position, season, week, apply_injury_adjustments)
        preds = load_weekly_prediction(
            position,
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
            allow_compute=False,
        )
        if not preds.empty:
            return preds
    return load_weekly_prediction(
        position,
        season=season,
        week=week,
        apply_injury_adjustments=apply_injury_adjustments,
        allow_compute=True,
    )


def _find_player_in_pools(
    pools: dict[str, pd.DataFrame],
    player_id: str,
) -> tuple[str, pd.Series] | None:
    pid = str(player_id)
    for pos, pool in pools.items():
        if pool.empty or "player_id" not in pool.columns:
            continue
        match = pool[pool["player_id"].astype(str) == pid]
        if not match.empty:
            return pos, match.iloc[0]
    return None


def _load_usage_features(
    player_id: str,
    position: str,
    season: int,
    week: int,
) -> dict[str, Any] | None:
    """Latest mlready usage row for the player + position percentile for the share metric."""
    path = PROCESSED_DATA_DIR / f"{position}_mlready.parquet"
    if not path.exists():
        return None

    share_candidates = _USAGE_SHARE_BY_POS.get(position, ("target_share_avg", "targets_avg"))
    try:
        import pyarrow.parquet as pq

        available = set(pq.read_schema(path).names)
    except Exception:
        available = set(pd.read_parquet(path).columns)

    name_col = next(
        (c for c in ("player_display_name", "player_name", "Player") if c in available),
        None,
    )
    share_col = next((c for c in share_candidates if c in available), None)
    cols = [c for c in ("player_id", "season", "week", "team") if c in available]
    if name_col:
        cols.append(name_col)
    for extra in (share_col, "targets_avg", "carry_share_avg", "target_share_avg", "air_yards_share_avg"):
        if extra and extra in available and extra not in cols:
            cols.append(extra)

    if "player_id" not in cols:
        return None

    df = pd.read_parquet(path, columns=cols)
    pid = str(player_id)
    player_rows = df[df["player_id"].astype(str) == pid]
    if player_rows.empty:
        return None

    # Prefer feature rows at or before target season/week; else latest available.
    prior = player_rows[
        (player_rows["season"] < season)
        | ((player_rows["season"] == season) & (player_rows["week"] < week))
    ]
    sample = prior if not prior.empty else player_rows
    row = sample.sort_values(["season", "week"]).iloc[-1]
    feature_season = int(row["season"])
    feature_week = int(row["week"])

    out: dict[str, Any] = {
        "feature_season": feature_season,
        "feature_week": feature_week,
        "team": _json_safe(row.get("team")),
    }
    if name_col:
        out["player_name"] = _json_safe(row.get(name_col))

    for col in ("targets_avg", "carry_share_avg", "target_share_avg", "air_yards_share_avg"):
        if col in row.index:
            out[col] = _json_safe(row.get(col))

    if share_col is None:
        out["share_metric"] = None
        return out

    metric_val = _json_safe(row.get(share_col))
    out["share_metric"] = share_col
    out["share_value"] = metric_val
    if metric_val is None:
        return out

    peer = df[(df["season"] == feature_season) & (df["week"] == feature_week)]
    if peer.empty:
        peer = df[df["season"] == feature_season]
    series = pd.to_numeric(peer[share_col], errors="coerce").dropna()
    if series.empty:
        return out

    percentile = float((series <= float(metric_val)).mean())
    out["share_percentile"] = round(percentile, 4)
    out["share_peer_count"] = int(len(series))
    return out


def _empty_narrative() -> dict[str, Any]:
    return {
        "available": False,
        "label": "Narrative context",
        "disclaimer": _NARRATIVE_DISCLAIMER,
        "is_model_input": False,
        "sentiment_label": None,
        "sentiment_label_text": None,
        "sentiment_score": None,
        "sentiment_summary": None,
        "role_hype_flag": None,
        "injury_flag": None,
        "mention_count": None,
        "digest": None,
        "digest_source": None,
        "snippet": None,
        "season": None,
        "week": None,
        "context_fallback": False,
        "media_context": {
            "state": "none",
            "signal": None,
            "source_count": 0,
            "summary": None,
            "updated_at": None,
            "historical": None,
            "affects_projection": False,
        },
    }


def _narrative_from_sentiment(
    player_id: str,
    *,
    season: int,
    week: int,
    player_name: str | None,
    include_historical: bool = False,
) -> dict[str, Any]:
    """Read pre-aggregated sentiment parquet only — no live scrape, no LLM on miss.

    SCORE-28: do not silently inject historical rows as current-week narrative.
    Historical content requires ``include_historical=True``.
    """
    from src.sentiment.media_context import (
        MEDIA_STATE_CURRENT,
        MEDIA_STATE_HISTORICAL_AVAILABLE,
        MEDIA_STATE_NONE,
        empty_media_context,
        find_player_historical_row,
    )

    empty = _empty_narrative()
    if not SENTIMENT_FEATURES_PATH.exists():
        return empty

    try:
        features = load_sentiment_features()
    except Exception:
        return empty
    if features.empty or "player_id" not in features.columns:
        return empty

    pid = str(player_id)
    scoped = features[features["player_id"].astype(str) == pid]
    if scoped.empty:
        return empty

    exact = scoped[(scoped["season"] == season) & (scoped["week"] == week)]
    context_fallback = False
    hist_meta: dict[str, Any] | None = None

    if not exact.empty and float(exact.iloc[0].get("yt_mention_count") or 0) > 0:
        row = exact.iloc[0]
        media_state = MEDIA_STATE_CURRENT
        serve_season, serve_week = int(row["season"]), int(row["week"])
    else:
        hist = find_player_historical_row(features, pid, season=season, week=week)
        if hist is None:
            return {
                **empty,
                "media_context": empty_media_context(state=MEDIA_STATE_NONE),
            }
        hist_season, hist_week, hist_row = hist
        hist_meta = {"season": hist_season, "week": hist_week}
        if not include_historical:
            return {
                **empty,
                "available": False,
                "season": None,
                "week": None,
                "context_fallback": False,
                "media_context": empty_media_context(
                    state=MEDIA_STATE_HISTORICAL_AVAILABLE,
                    historical_season=hist_season,
                    historical_week=hist_week,
                ),
            }
        row = hist_row
        context_fallback = True
        media_state = MEDIA_STATE_HISTORICAL_AVAILABLE
        serve_season, serve_week = hist_season, hist_week

    score = float(row.get("yt_sentiment_score") or 0.0)
    injury_flag = float(row.get("yt_injury_flag") or 0.0)
    role_hype = float(row.get("yt_role_hype_flag") or 0.0)
    mentions = float(row.get("yt_mention_count") or 0.0)
    label_key = sentiment_label(score, injury_flag=injury_flag, role_hype_flag=role_hype)
    snippet = str(row.get("yt_top_snippet") or "") or None
    chapter_notes = str(row.get("yt_chapter_notes") or "") if "yt_chapter_notes" in row.index else ""
    top_sentence = str(row.get("yt_top_sentence") or "") if "yt_top_sentence" in row.index else ""

    name = player_name or "This player"
    sentiment_payload = {
        "sentiment_label": label_key,
        "injury_flag": injury_flag,
        "role_hype_flag": role_hype,
        "chapter_notes": chapter_notes,
        "top_sentence": top_sentence or snippet or "",
        "snippet": snippet or "",
    }

    digest = None
    digest_source = None
    try:
        # prefer_llm=False: use disk cache if present, else extractive only.
        result = fantasy_digest_for_player(
            name,
            sentiment_payload,
            scope="weekly",
            player_id=pid,
            season=serve_season,
            week=serve_week,
            prefer_llm=False,
            return_meta=True,
        )
        if isinstance(result, dict):
            digest = result.get("fantasy_media_digest") or None
            digest_source = result.get("fantasy_media_digest_source")
    except Exception:
        digest = extractive_fantasy_digest(
            name,
            scope="weekly",
            snippet=snippet or "",
            chapter_notes=chapter_notes,
            top_sentence=top_sentence or snippet or "",
            sentiment_label=label_key,
            injury_flag=injury_flag,
            role_hype_flag=role_hype,
        )
        digest_source = "extractive"

    media_context = {
        "state": media_state,
        "signal": (
            "role_up"
            if role_hype > 0
            else ("injury_watch" if injury_flag > 0 else ("mentioned" if mentions > 0 else None))
        ),
        "source_count": int(round(mentions)),
        "summary": digest,
        "updated_at": None,
        "historical": hist_meta if media_state == MEDIA_STATE_HISTORICAL_AVAILABLE else None,
        "affects_projection": False,
    }

    return {
        "available": True,
        "label": "Narrative context",
        "disclaimer": _NARRATIVE_DISCLAIMER,
        "is_model_input": False,
        "sentiment_label": label_key,
        "sentiment_label_text": sentiment_label_text(label_key),
        "sentiment_score": round(score, 4),
        "sentiment_summary": sentiment_summary(
            label=label_key,
            mention_count=mentions,
            injury_flag=injury_flag,
            role_hype_flag=role_hype,
        ),
        "role_hype_flag": role_hype,
        "injury_flag": injury_flag,
        "mention_count": int(round(mentions)),
        "digest": digest,
        "digest_source": digest_source,
        "snippet": snippet,
        "season": serve_season,
        "week": serve_week,
        "context_fallback": context_fallback,
        "media_context": media_context,
    }


def build_projection_signals(
    *,
    projection: dict[str, Any],
    usage: dict[str, Any] | None,
    p10: float | None,
    p50: float | None,
    p90: float | None,
) -> list[dict[str, Any]]:
    """Deterministic structured signals from projection + feature context (no LLM)."""
    signals: list[dict[str, Any]] = []

    boost = pick_opportunity_adjustment(projection) or 0.0
    injury_note = str(projection.get("Injury Note") or projection.get("injury_note") or "").strip()
    if boost >= _OPPORTUNITY_ADJUSTMENT_UP:
        strength = "high" if boost >= 0.12 else "medium"
        detail = (
            f"Opportunity adjustment of {boost:.0%} from teammate availability."
        )
        if injury_note:
            detail = f"{detail} Context: {injury_note}."
        signals.append(
            _signal(
                signal_id="expected_volume",
                label="Expected volume",
                direction="up",
                strength=strength,
                detail=detail,
                metrics={
                    "opportunity_adjustment": round(boost, 4),
                    # Compat alias during SCORE-26 rollout.
                    "injury_boost": round(boost, 4),
                    "injury_note": injury_note or None,
                },
            )
        )

    if usage and usage.get("share_percentile") is not None:
        pct = float(usage["share_percentile"])
        metric = usage.get("share_metric")
        value = usage.get("share_value")
        usage_metrics = {
            "share_metric": metric,
            "share_value": value,
            "share_percentile": pct,
            "feature_season": usage.get("feature_season"),
            "feature_week": usage.get("feature_week"),
        }
        if pct >= _SHARE_PCT_UP:
            signals.append(
                _signal(
                    signal_id="recent_usage",
                    label="Recent usage",
                    direction="up",
                    strength="medium" if pct >= 0.8 else "low",
                    detail=(
                        f"Recent {str(metric).replace('_', ' ') if metric else 'usage'} "
                        f"ranks near the {pct:.0%} mark among positional peers."
                    ),
                    metrics=usage_metrics,
                )
            )
        elif pct <= _SHARE_PCT_DOWN:
            signals.append(
                _signal(
                    signal_id="recent_usage",
                    label="Recent usage",
                    direction="down",
                    strength="medium" if pct <= 0.2 else "low",
                    detail=(
                        f"Recent {str(metric).replace('_', ' ') if metric else 'usage'} "
                        f"is muted vs positional peers ({pct:.0%} percentile)."
                    ),
                    metrics=usage_metrics,
                )
            )

    opp_rank = _pick_num(projection, ("Opp Def Rank", "opp_def_rank"))
    opp_epa = _pick_num(projection, ("Opp Def EPA", "opp_def_epa"))
    opponent = projection.get("Opponent") or projection.get("opponent")
    if opp_rank is not None and opponent not in (None, "", "BYE"):
        if opp_rank >= _OPP_RANK_FAVORABLE:
            signals.append(
                _signal(
                    signal_id="game_environment",
                    label="Favorable game environment",
                    direction="up",
                    strength="medium" if opp_rank >= 26 else "low",
                    detail=f"Opponent defense ranks {int(opp_rank)} (softer matchup).",
                    metrics={
                        "opponent": opponent,
                        "opp_def_rank": int(opp_rank),
                        "opp_def_epa": opp_epa,
                    },
                )
            )
        elif opp_rank <= _OPP_RANK_TOUGH:
            signals.append(
                _signal(
                    signal_id="game_environment",
                    label="Tough game environment",
                    direction="down",
                    strength="medium" if opp_rank <= 5 else "low",
                    detail=f"Opponent defense ranks {int(opp_rank)} (tougher matchup).",
                    metrics={
                        "opponent": opponent,
                        "opp_def_rank": int(opp_rank),
                        "opp_def_epa": opp_epa,
                    },
                )
            )

    injury_status = str(
        projection.get("Injury Status") or projection.get("injury_status") or ""
    ).strip()
    if injury_status:
        severity = {
            "Out": "high",
            "IR": "high",
            "PUP": "high",
            "Doubtful": "high",
            "Questionable": "medium",
        }.get(injury_status, "low")
        signals.append(
            _signal(
                signal_id="injury_status",
                label="Injury / availability",
                direction="down",
                strength=severity,
                detail=f"Player listed as {injury_status}.",
                metrics={"injury_status": injury_status},
            )
        )

    vol = volatility(p10, p50, p90)
    if vol is not None:
        if vol >= _VOL_HIGH:
            signals.append(
                _signal(
                    signal_id="uncertainty",
                    label="Elevated uncertainty",
                    direction="down",
                    strength="high" if vol >= 1.0 else "medium",
                    detail=(
                        f"Wide P10–P90 band (volatility {vol:.2f}) — outcome range is elevated."
                    ),
                    metrics={
                        "volatility": round(vol, 4),
                        "p10": p10,
                        "p50": p50,
                        "p90": p90,
                    },
                )
            )
        elif vol <= _VOL_LOW:
            signals.append(
                _signal(
                    signal_id="uncertainty",
                    label="Tighter outcome band",
                    direction="up",
                    strength="low",
                    detail=f"Narrower P10–P90 band (volatility {vol:.2f}).",
                    metrics={
                        "volatility": round(vol, 4),
                        "p10": p10,
                        "p50": p50,
                        "p90": p90,
                    },
                )
            )

    return signals


def build_projection_explanation(
    player_id: str,
    *,
    season: int | None = None,
    week: int | None = None,
    position: str | None = None,
    apply_injury_adjustments: bool = True,
    include_historical: bool = False,
    compute_fn: Any | None = None,
) -> dict[str, Any]:
    """Build a lightweight Why? panel payload for one projected player."""
    pid = str(player_id or "").strip()
    if not pid:
        raise ValueError("player_id is required")

    resolved_season, resolved_week = season_week_context(season, week)
    preferred = (position or "").lower().strip()
    position_order = (
        [preferred] + [p for p in POSITIONS if p != preferred]
        if preferred in POSITIONS
        else list(POSITIONS)
    )

    pools: dict[str, pd.DataFrame] = {}
    hit: tuple[str, pd.Series] | None = None
    service_error: FileNotFoundError | None = None

    # Pass 1: cached artifacts only.
    for pos in position_order:
        pool = load_weekly_prediction(
            pos,
            season=resolved_season,
            week=resolved_week,
            apply_injury_adjustments=apply_injury_adjustments,
            allow_compute=False,
        )
        pools[pos] = pool
    hit = _find_player_in_pools(pools, pid)

    # Pass 2: warm empty preferred / remaining pools until found.
    if hit is None:
        for pos in position_order:
            if not pools.get(pos, pd.DataFrame()).empty:
                continue
            try:
                pool = _ensure_weekly_pool(
                    pos,
                    resolved_season,
                    resolved_week,
                    apply_injury_adjustments=apply_injury_adjustments,
                    compute_fn=compute_fn,
                )
            except FileNotFoundError as exc:
                service_error = exc
                continue
            pools[pos] = pool
            hit = _find_player_in_pools(pools, pid)
            if hit is not None:
                break

    if hit is None:
        if service_error is not None:
            raise service_error
        raise ValueError(
            f"No weekly projection found for player_id={pid} "
            f"(season={resolved_season}, week={resolved_week})"
        )

    pos, row = hit
    projection = {str(k): _json_safe(v) for k, v in row.items()}
    p10 = _pick_num(projection, _P10_KEYS)
    p50 = _pick_num(projection, _P50_KEYS)
    p90 = _pick_num(projection, _P90_KEYS)
    vol = volatility(p10, p50, p90)

    usage = _load_usage_features(pid, pos, resolved_season, resolved_week)
    signals = build_projection_signals(
        projection=projection,
        usage=usage,
        p10=p10,
        p50=p50,
        p90=p90,
    )

    player_name = projection.get("Player") or (usage or {}).get("player_name")
    narrative = _narrative_from_sentiment(
        pid,
        season=resolved_season,
        week=resolved_week,
        player_name=str(player_name) if player_name else None,
        include_historical=include_historical,
    )

    return {
        "player_id": pid,
        "player_name": player_name,
        "position": str(projection.get("Position") or pos).upper(),
        "position_key": pos,
        "team": projection.get("Team") or (usage or {}).get("team"),
        "meta": {
            "season": resolved_season,
            "week": resolved_week,
            "apply_injury_adjustments": apply_injury_adjustments,
            "sentiment_is_model_input": False,
            "projection_movement_available": False,
            "artifact_driven": True,
        },
        "note": (
            "Projection signals are derived from ScoreSense weekly artifacts and "
            "processed usage features. Narrative context is a separate overlay and "
            "does not enter the projection model."
        ),
        "projection": {
            "p10": None if p10 is None else round(p10, 2),
            "p50": None if p50 is None else round(p50, 2),
            "p90": None if p90 is None else round(p90, 2),
            "volatility": None if vol is None else round(vol, 4),
            "opponent": projection.get("Opponent"),
            "injury_status": projection.get("Injury Status") or None,
            "opportunity_adjustment": pick_opportunity_adjustment(projection),
            # Compat alias during SCORE-26 rollout (prefer opportunity_adjustment).
            "injury_boost": pick_opportunity_adjustment(projection),
            "injury_note": (projection.get("Injury Note") or None) or None,
            "opp_def_rank": _pick_num(projection, ("Opp Def Rank",)),
            "opp_def_epa": _pick_num(projection, ("Opp Def EPA",)),
        },
        "projection_signals": signals,
        "narrative_context": narrative,
        "movement": {
            "available": False,
            "delta_p50": None,
            "prior_p50": None,
            "note": "Projection movement tracking is not available yet.",
        },
        "usage_context": usage,
    }
