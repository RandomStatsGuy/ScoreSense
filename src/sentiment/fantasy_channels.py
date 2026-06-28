"""Load league-wide fantasy YouTube channel registry."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from src.config import SENTIMENT_DIR
from src.sentiment.channels import DEFAULT_TIER_WEIGHTS
from src.sentiment.networks import load_networks

FANTASY_CHANNELS_PATH = SENTIMENT_DIR / "fantasy_channels.yaml"
LEAGUE_TEAM_CODE = "NFL"

FANTASY_NETWORK_COLUMNS = {
    "draft_sharks": "yt_draft_sharks_mentions",
    "fantasy_footballers": "yt_fantasy_footballers_mentions",
    "fantasypros_yt": "yt_fantasypros_mentions",
    "playerprofiler": "yt_playerprofiler_mentions",
    "late_round": "yt_late_round_mentions",
    "establish_the_run": "yt_establish_the_run_mentions",
    "fantasy_points": "yt_fantasy_points_mentions",
    "qb_list": "yt_qb_list_mentions",
    "underdog_fantasy": "yt_underdog_fantasy_mentions",
    "reception_perception": "yt_reception_perception_mentions",
}


@dataclass(frozen=True)
class FantasyChannelEntry:
    channel_id: str
    network: str
    tier: str
    weight: float
    label: str
    search_query: str | None = None
    hosts: str | None = None
    active: bool = True
    promote_to_features: bool = False

    @property
    def team(self) -> str:
        return LEAGUE_TEAM_CODE

    @property
    def uploads_playlist_id(self) -> str:
        cid = self.channel_id.strip()
        if cid.startswith("UC") and len(cid) > 2:
            return "UU" + cid[2:]
        return cid

    @property
    def effective_weight(self) -> float:
        networks = load_networks()
        multiplier = networks.get(self.network).weight_multiplier if self.network in networks else 1.0
        return float(self.weight) * multiplier

    def needs_resolution(self) -> bool:
        return not self.channel_id or self.channel_id.startswith("UC_PLACEHOLDER")


def load_fantasy_channels(
    path: Path | None = None,
    *,
    active_only: bool = True,
    network: str | None = None,
) -> list[FantasyChannelEntry]:
    path = path or FANTASY_CHANNELS_PATH
    if not path.exists():
        return []

    networks = load_networks()
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    entries: list[FantasyChannelEntry] = []
    for row in raw.get("channels") or []:
        if not isinstance(row, dict):
            continue
        network_key = str(row.get("network") or "")
        net_cfg = networks.get(network_key)
        tier = str(row.get("tier") or (net_cfg.default_tier if net_cfg else "analysis")).lower()
        weight = row.get("weight")
        if weight is None:
            weight = DEFAULT_TIER_WEIGHTS.get(tier, 0.85)
        entry = FantasyChannelEntry(
            channel_id=str(row.get("channel_id") or "").strip(),
            network=network_key,
            tier=tier,
            weight=float(weight),
            label=str(row.get("label") or row.get("channel_id") or "").strip(),
            search_query=(str(row.get("search_query")).strip() if row.get("search_query") else None),
            hosts=(str(row.get("hosts")).strip() if row.get("hosts") else None),
            active=bool(row.get("active", True)),
            promote_to_features=bool(row.get("promote_to_features", False)),
        )
        if not entry.network or not entry.label:
            continue
        if active_only and not entry.active:
            continue
        if network and entry.network != network:
            continue
        entries.append(entry)
    return entries


def promoted_fantasy_channel_ids() -> set[str]:
    return {c.channel_id for c in load_fantasy_channels() if c.promote_to_features and not c.needs_resolution()}
