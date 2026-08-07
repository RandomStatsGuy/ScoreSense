"""Rookie projection role tiers from Sleeper depth chart, overrides, and sentiment."""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from src.config import ROOKIE_ROLE_OVERRIDES_PATH
from src.integrations.external_projections import _normalize_name

logger = logging.getLogger(__name__)

BACKUP_BASELINE_MULT = 1.0
MULT_MIN = 0.08
MULT_MAX = 3.5


def _safe_int(value: Any) -> int | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return n


def _search_rank(value: Any) -> int | None:
    n = _safe_int(value)
    if n is None or n >= 9_999_999:
        return None
    return n


def resolve_rookie_skill_position(position: str, sleeper_row: pd.Series | None = None) -> str:
    """Normalize to qb/rb/wr/te using Sleeper position when available."""
    if sleeper_row is not None:
        sleeper_pos = str(sleeper_row.get("position") or "").strip().upper()
        if sleeper_pos == "FB":
            return "rb"
        if sleeper_pos in {"QB", "RB", "WR", "TE"}:
            return sleeper_pos.lower()
    pos = str(position or "").strip().lower()
    if pos in {"qb", "rb", "wr", "te"}:
        return pos
    if pos in {"rec", "flex"}:
        return "wr"
    return pos or "wr"


def draft_capital_factor(search_rank: int | None) -> tuple[float, str]:
    """Multiplicative draft-capital prior from Sleeper search_rank (proxy for pick quality).

    Sleeper does not expose draft round/pick on the players endpoint, so search_rank
    is the best available capital signal. 1.0 = neutral.
    """
    if search_rank is None:
        return 1.0, ""
    if search_rank <= 20:
        return 1.28, "elite-capital"
    if search_rank <= 60:
        return 1.16, "r1-capital"
    if search_rank <= 120:
        return 1.08, "day2-capital"
    if search_rank <= 250:
        return 1.0, ""
    if search_rank <= 500:
        return 0.92, "late-capital"
    return 0.82, "udfa-capital"


def _depth_role_multiplier(pos: str, dc: int | None) -> tuple[float, str] | None:
    """Depth-chart tier when Sleeper has an order; None if depth is unknown."""
    if dc is None:
        return None

    if pos == "qb":
        if dc == 1:
            return 2.0, "depth-qb1"
        if dc == 2:
            return 0.60, "backup"
        return 0.28, "third-string"

    if pos == "rb":
        if dc == 1:
            return 1.75, "rb1-path"
        if dc == 2:
            return 0.78, "rb2"
        return 0.42, "depth"

    if pos == "te":
        if dc == 1:
            return 1.45, "te1-path"
        if dc == 2:
            return 0.72, "te2"
        return 0.38, "depth"

    # WR (default skill)
    if dc == 1:
        return 1.65, "wr1-path"
    if dc == 2:
        return 1.05, "wr2"
    if dc == 3:
        return 0.68, "slot"
    return 0.38, "depth"


def _capital_only_baseline(pos: str, rank: int | None) -> tuple[float, str]:
    """Fallback when depth chart order is missing — capital-driven absolute mult."""
    cap, cap_label = draft_capital_factor(rank)
    if pos == "qb":
        base, label = 0.32, "development"
        if rank is not None and rank <= 200:
            base, label = 1.15, "hyped-rookie"
    elif pos == "rb":
        base, label = 0.45, "development"
        if rank is not None and rank <= 250:
            base, label = 1.05, "draft-capital"
    elif pos == "te":
        base, label = 0.40, "development"
        if rank is not None and rank <= 250:
            base, label = 0.95, "draft-capital"
    else:
        base, label = 0.42, "development"
        if rank is not None and rank <= 300:
            base, label = 0.95, "draft-capital"

    # Cap factor already informs the absolute baseline above for mid ranks;
    # still nudge extremes so elite/UDFA diverge further.
    if cap_label in {"elite-capital", "r1-capital", "udfa-capital", "late-capital"}:
        mult = base * cap
        label = f"{label}+{cap_label}" if cap_label else label
        return mult, label
    return base, label


def rookie_role_multiplier(position: str, sleeper_row: pd.Series) -> tuple[float, str]:
    """Scale factor from Sleeper depth chart + search-rank draft capital."""
    pos = resolve_rookie_skill_position(position, sleeper_row)
    dc = _safe_int(sleeper_row.get("depth_chart_order"))
    rank = _search_rank(sleeper_row.get("search_rank"))

    depth = _depth_role_multiplier(pos, dc)
    if depth is None:
        return _capital_only_baseline(pos, rank)

    mult, label = depth
    # Mild capital nudge when depth is known (avoid double-counting starter bumps).
    cap, cap_label = draft_capital_factor(rank)
    if pos == "qb" and dc == 1 and rank is not None and rank <= 100:
        # Keep prior "starter-likely" behavior for hyped QB1 rookies.
        mult = 2.6
        label = "starter-likely"
    else:
        # Blend: depth dominates; capital moves ± up to ~14% of the gap from 1.0.
        mult = mult * (1.0 + 0.5 * (cap - 1.0))
        if cap_label:
            label = f"{label}+{cap_label}"
    return mult, label


@lru_cache(maxsize=8)
def _load_overrides_file(path: str, mtime_ns: int) -> dict[int, list[dict[str, Any]]]:
    p = Path(path)
    if not p.exists():
        return {}
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    out: dict[int, list[dict[str, Any]]] = {}
    if isinstance(raw, dict):
        for season_key, rows in raw.items():
            if str(season_key).startswith("_"):
                continue
            try:
                season = int(season_key)
            except (TypeError, ValueError):
                continue
            if isinstance(rows, list):
                out[season] = [r for r in rows if isinstance(r, dict)]
    return out


def load_rookie_role_overrides(season: int, path: Path | None = None) -> list[dict[str, Any]]:
    """Manual camp-battle overrides for a target season."""
    p = path or ROOKIE_ROLE_OVERRIDES_PATH
    resolved = str(p.resolve())
    mtime_ns = p.stat().st_mtime_ns if p.exists() else 0
    return list(_load_overrides_file(resolved, mtime_ns).get(int(season), []))


def lookup_rookie_override(
    *,
    player_name: str,
    team: str,
    position: str,
    season: int | None,
    path: Path | None = None,
) -> dict[str, Any] | None:
    if season is None:
        return None
    name_key = _normalize_name(player_name)
    team_u = str(team or "").upper()
    pos_u = str(position or "").upper()
    for row in load_rookie_role_overrides(season, path=path):
        row_name = _normalize_name(str(row.get("player") or row.get("player_name") or ""))
        if row_name != name_key:
            continue
        row_team = str(row.get("team") or "").upper()
        if row_team and row_team != team_u:
            continue
        row_pos = str(row.get("position") or "").upper()
        if row_pos and row_pos != pos_u:
            continue
        return row
    return None


def _resolve_sentiment_row(
    features: pd.DataFrame,
    *,
    player_name: str,
    team: str,
    player_id: str | None,
    season: int,
    position: str = "",
) -> pd.Series | None:
    scoped = features[features["season"] == season]
    if scoped.empty:
        scoped = features[features["season"] == features["season"].max()]

    candidate_ids: list[str] = []
    pid = str(player_id or "").strip()
    if pid:
        candidate_ids.append(pid)

    try:
        from src.integrations.sleeper import match_player_to_sleeper

        pos = str(position or "QB").upper()
        if pos == "REC":
            pos = "WR"
        matched = match_player_to_sleeper(player_name, team, pos)
        if matched is not None:
            gsis = str(matched.get("gsis_id") or "").strip()
            if gsis:
                candidate_ids.append(gsis)
            candidate_ids.append(f"sleeper-{matched['sleeper_id']}")
    except Exception:
        pass

    seen: set[str] = set()
    for cid in candidate_ids:
        if not cid or cid in seen:
            continue
        seen.add(cid)
        hit = scoped[scoped["player_id"].astype(str) == cid]
        if not hit.empty:
            return hit.sort_values("week").iloc[-1]

    return None


def sentiment_role_boost(
    *,
    player_name: str,
    team: str,
    player_id: str | None,
    position: str,
    season: int | None,
) -> tuple[float, str]:
    """Multiplicative bump from YouTube role-hype / camp buzz (1.0 = no change)."""
    if not season:
        return 1.0, ""
    try:
        from src.sentiment.aggregate import load_sentiment_features

        features = load_sentiment_features()
    except Exception as exc:
        logger.debug("sentiment features unavailable for rookie role: %s", exc)
        return 1.0, ""

    if features.empty:
        return 1.0, ""

    row = _resolve_sentiment_row(
        features,
        player_name=player_name,
        team=team,
        player_id=player_id,
        season=int(season),
        position=position,
    )
    if row is None:
        return 1.0, ""

    injury = float(row.get("yt_injury_flag") or 0)
    if injury > 0:
        return 0.88, "injury-note"

    hype = float(row.get("yt_role_hype_flag") or 0)
    mentions = float(row.get("yt_mention_count") or 0)
    score = float(row.get("yt_sentiment_score") or 0)

    if hype > 0:
        boost = 1.0 + min(0.22, 0.06 + mentions * 0.05 + max(0.0, score) * 0.12)
        return boost, "role-hype"

    if mentions >= 1.0 and score >= 0.12:
        boost = 1.0 + min(0.10, mentions * 0.03)
        return boost, "camp-buzz"

    return 1.0, ""


def compute_rookie_role(
    position: str,
    sleeper_row: pd.Series,
    *,
    season: int | None = None,
) -> tuple[float, str]:
    """Final rookie multiplier: Sleeper tier, optional override, sentiment blend."""
    player_name = str(sleeper_row.get("full_name") or "")
    team = str(sleeper_row.get("team") or "")
    player_id = str(sleeper_row.get("gsis_id") or sleeper_row.get("player_id") or "").strip() or None
    skill_pos = resolve_rookie_skill_position(position, sleeper_row)

    base_mult, label = rookie_role_multiplier(skill_pos, sleeper_row)
    override = lookup_rookie_override(
        player_name=player_name,
        team=team,
        position=skill_pos,
        season=season,
    )

    if override:
        mult = float(override.get("role_mult") or base_mult)
        label = str(override.get("role_label") or "override")
        blend_sentiment = override.get("sentiment_blend", True) is not False
    else:
        mult = base_mult
        blend_sentiment = True

    if blend_sentiment and season:
        sent_mult, sent_tag = sentiment_role_boost(
            player_name=player_name,
            team=team,
            player_id=player_id,
            position=skill_pos,
            season=season,
        )
        mult *= sent_mult
        if sent_tag:
            label = f"{label}+{sent_tag}"

    mult = max(MULT_MIN, min(MULT_MAX, mult))
    return round(mult, 3), label


def scale_rookie_stub_features(stub: pd.Series, medians: pd.Series, mult: float) -> pd.Series:
    """Multiply numeric feature columns on a rookie stub by the role multiplier."""
    out = stub.copy()
    skip = {"season", "week", "_rookie_role_mult"}
    for col in medians.index:
        if col in skip or col not in out.index:
            continue
        val = medians[col]
        if not isinstance(val, (int, float)) or pd.isna(val):
            continue
        out[col] = float(val) * mult
    return out


def rookie_role_note_suffix(roster: pd.DataFrame) -> str:
    """Short note when role-adjusted rookies are present."""
    if roster.empty or "_rookie_role_label" not in roster.columns:
        return ""
    rookies = roster[roster.get("_rookie_estimate", False) == True]  # noqa: E712
    if rookies.empty:
        return ""
    labels = rookies["_rookie_role_label"].astype(str).value_counts()
    top = ", ".join(f"{k} ({v})" for k, v in labels.head(4).items())
    return (
        f" Rookie estimates use backup-usage features, Sleeper depth, draft-capital "
        f"(search rank), camp overrides, and role-hype sentiment ({top})."
    )
