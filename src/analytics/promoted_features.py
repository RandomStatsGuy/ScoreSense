"""Load features promoted by the analytics screening gate."""

from __future__ import annotations

import json
from pathlib import Path

from src.analytics.usage_features import USAGE_BUNDLE, normalize_position
from src.config import ANALYTICS_DIR

# Fallback when screening has not run or gate returns nothing.
DEFAULT_PROMOTED: dict[str, list[str]] = {
    "qb": ["carry_share_avg", "rz_carries_avg", "explosive_plays_avg"],
    "rb": ["implied_team_total_avg", "offense_pct_avg", "rz_carries_avg"],
    "wr": ["explosive_plays_avg", "target_share_avg_volatility", "implied_team_total_avg"],
}


def _load_gate_promoted(key: str) -> list[str]:
    path = ANALYTICS_DIR / f"promoted_features_{key}.json"
    if not path.exists():
        return list(DEFAULT_PROMOTED.get(key, []))
    data = json.loads(path.read_text())
    gate = list(data.get("features") or [])
    if gate:
        return gate
    return list(DEFAULT_PROMOTED.get(key, []))


def get_promoted_features(position: str) -> list[str]:
    """Gate-passed features + always-on usage bundle (deduped, order preserved)."""
    key = normalize_position(position)
    gate = _load_gate_promoted(key)
    bundle = USAGE_BUNDLE.get(key, [])
    return list(dict.fromkeys(gate + bundle))


def save_promoted_features(position: str, features: list[str]) -> Path:
    ANALYTICS_DIR.mkdir(parents=True, exist_ok=True)
    path = ANALYTICS_DIR / f"promoted_features_{position}.json"
    path.write_text(json.dumps({"position": position, "features": features}, indent=2))
    return path
