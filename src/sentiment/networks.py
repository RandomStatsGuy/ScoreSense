"""Load network taxonomy for sentiment source weighting."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from src.config import SENTIMENT_DIR

NETWORKS_PATH = SENTIMENT_DIR / "networks.yaml"

DEFAULT_NETWORKS: dict[str, dict] = {
    "locked_on": {
        "label": "Locked On",
        "default_tier": "reporting",
        "weight_multiplier": 1.0,
    },
    "sb_nation": {
        "label": "SB Nation",
        "default_tier": "fan_analysis",
        "weight_multiplier": 0.55,
    },
    "espn": {
        "label": "ESPN NFL Nation",
        "default_tier": "reporting",
        "weight_multiplier": 1.0,
    },
    "athletic": {
        "label": "The Athletic",
        "default_tier": "analysis",
        "weight_multiplier": 0.85,
    },
    "chat_sports": {
        "label": "Chat Sports",
        "default_tier": "reporting",
        "weight_multiplier": 0.9,
    },
    "draft_sharks": {
        "label": "Draft Sharks",
        "default_tier": "analysis",
        "weight_multiplier": 1.0,
    },
    "fantasy_footballers": {
        "label": "The Fantasy Footballers",
        "default_tier": "analysis",
        "weight_multiplier": 0.95,
    },
    "fantasypros_yt": {
        "label": "FantasyPros YouTube",
        "default_tier": "analysis",
        "weight_multiplier": 0.95,
    },
    "playerprofiler": {
        "label": "PlayerProfiler",
        "default_tier": "analysis",
        "weight_multiplier": 0.9,
    },
    "late_round": {
        "label": "Late-Round Fantasy Football",
        "default_tier": "analysis",
        "weight_multiplier": 0.9,
    },
    "establish_the_run": {
        "label": "Establish The Run",
        "default_tier": "analysis",
        "weight_multiplier": 0.9,
    },
    "fantasy_points": {
        "label": "Fantasy Points",
        "default_tier": "analysis",
        "weight_multiplier": 0.9,
    },
}


@dataclass(frozen=True)
class NetworkConfig:
    key: str
    label: str
    default_tier: str
    weight_multiplier: float


def load_networks(path: Path | None = None) -> dict[str, NetworkConfig]:
    path = path or NETWORKS_PATH
    raw: dict = {}
    if path.exists():
        payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        raw = payload.get("networks") or {}
    if not raw:
        raw = DEFAULT_NETWORKS

    out: dict[str, NetworkConfig] = {}
    for key, row in raw.items():
        if not isinstance(row, dict):
            continue
        out[str(key)] = NetworkConfig(
            key=str(key),
            label=str(row.get("label") or key),
            default_tier=str(row.get("default_tier") or "analysis"),
            weight_multiplier=float(row.get("weight_multiplier") or 1.0),
        )
    return out


def network_label(network_key: str, networks: dict[str, NetworkConfig] | None = None) -> str:
    networks = networks or load_networks()
    cfg = networks.get(network_key)
    return cfg.label if cfg else network_key
