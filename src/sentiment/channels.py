"""Load and validate curated team YouTube channel registry."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from src.config import SENTIMENT_DIR
from src.sentiment.networks import load_networks

DEFAULT_TIER_WEIGHTS = {
    "reporting": 1.0,
    "analysis": 0.85,
    "fan_analysis": 0.55,
    "fan": 0.4,
}

CHANNELS_PATH = SENTIMENT_DIR / "channels.yaml"

TEAM_FRANCHISE_NAMES: dict[str, str] = {
    "ARI": "Arizona Cardinals",
    "ATL": "Atlanta Falcons",
    "BAL": "Baltimore Ravens",
    "BUF": "Buffalo Bills",
    "CAR": "Carolina Panthers",
    "CHI": "Chicago Bears",
    "CIN": "Cincinnati Bengals",
    "CLE": "Cleveland Browns",
    "DAL": "Dallas Cowboys",
    "DEN": "Denver Broncos",
    "DET": "Detroit Lions",
    "GB": "Green Bay Packers",
    "HOU": "Houston Texans",
    "IND": "Indianapolis Colts",
    "JAX": "Jacksonville Jaguars",
    "KC": "Kansas City Chiefs",
    "LAC": "Los Angeles Chargers",
    "LAR": "Los Angeles Rams",
    "LV": "Las Vegas Raiders",
    "MIA": "Miami Dolphins",
    "MIN": "Minnesota Vikings",
    "NE": "New England Patriots",
    "NO": "New Orleans Saints",
    "NYG": "New York Giants",
    "NYJ": "New York Jets",
    "PHI": "Philadelphia Eagles",
    "PIT": "Pittsburgh Steelers",
    "SEA": "Seattle Seahawks",
    "SF": "San Francisco 49ers",
    "TB": "Tampa Bay Buccaneers",
    "TEN": "Tennessee Titans",
    "WAS": "Washington Commanders",
}

SB_NATION_BLOG_NAMES: dict[str, str] = {
    "ARI": "Revenge of the Birds",
    "ATL": "The Falcoholic",
    "BAL": "Baltimore Beatdown",
    "BUF": "Buffalo Rumblings",
    "CAR": "Cat Scratch Reader",
    "CHI": "Windy City Gridiron",
    "CIN": "Cincy Jungle",
    "CLE": "Dawgs By Nature",
    "DAL": "Blogging The Boys",
    "DEN": "Mile High Report",
    "DET": "Pride of Detroit",
    "GB": "Acme Packing Company",
    "HOU": "Battle Red Blog",
    "IND": "Stampede Blue",
    "JAX": "Big Cat Country",
    "KC": "Arrowhead Pride",
    "LAC": "Bolts From The Blue",
    "LAR": "Turf Show Times",
    "LV": "Silver And Black Pride",
    "MIA": "The Phinsider",
    "MIN": "Daily Norseman",
    "NE": "Pats Pulpit",
    "NO": "Canal Street Chronicles",
    "NYG": "Big Blue View",
    "NYJ": "Gang Green Nation",
    "PHI": "Bleeding Green Nation",
    "PIT": "Behind the Steel Curtain",
    "SEA": "Field Gulls",
    "SF": "Niners Nation",
    "TB": "Bucs Nation",
    "TEN": "Music City Miracles",
    "WAS": "Hogs Haven",
}


@dataclass(frozen=True)
class ChannelEntry:
    channel_id: str
    team: str
    tier: str
    weight: float
    label: str
    network: str = "locked_on"
    search_query: str | None = None
    active: bool = True

    @property
    def uploads_playlist_id(self) -> str:
        """YouTube uploads playlist id (UU...) from channel id (UC...)."""
        cid = self.channel_id.strip()
        if cid.startswith("UC") and len(cid) > 2:
            return "UU" + cid[2:]
        return cid

    @property
    def effective_weight(self) -> float:
        """Tier weight × network multiplier."""
        networks = load_networks()
        multiplier = networks.get(self.network).weight_multiplier if self.network in networks else 1.0
        return float(self.weight) * multiplier

    def needs_resolution(self) -> bool:
        return not self.channel_id or self.channel_id.startswith("UC_PLACEHOLDER")


def _normalize_team(value) -> str:
    if value is False:
        return "NO"
    if value is True:
        return "YES"
    return str(value or "").strip().upper()


def load_channels(
    path: Path | None = None,
    *,
    include_fan: bool | None = None,
    active_only: bool = True,
    network: str | None = None,
    team: str | None = None,
) -> list[ChannelEntry]:
    import os

    team_filter = team.upper() if team else None
    path = path or CHANNELS_PATH
    if network == "chat_sports":
        from src.sentiment.chat_sports_channels import load_chat_sports_channels

        return [
            ChannelEntry(
                channel_id=cs.channel_id,
                team=cs.team,
                tier=cs.tier,
                weight=cs.weight,
                label=cs.label,
                network=cs.network,
                search_query=cs.primary_search_query(),
                active=cs.active,
            )
            for cs in load_chat_sports_channels(active_only=active_only)
            if not team_filter or cs.team == team_filter
        ]

    if not path.exists():
        return []

    networks = load_networks()
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    entries: list[ChannelEntry] = []
    for row in raw.get("channels") or []:
        if not isinstance(row, dict):
            continue
        network_key = str(row.get("network") or "locked_on")
        net_cfg = networks.get(network_key)
        tier = str(row.get("tier") or (net_cfg.default_tier if net_cfg else "analysis")).lower()
        weight = row.get("weight")
        if weight is None:
            weight = DEFAULT_TIER_WEIGHTS.get(tier, 0.7)
        team_code = _normalize_team(row.get("team"))
        entry = ChannelEntry(
            channel_id=str(row.get("channel_id") or "").strip(),
            team=team_code,
            tier=tier,
            weight=float(weight),
            label=str(row.get("label") or row.get("channel_id") or "").strip(),
            network=network_key,
            search_query=(str(row.get("search_query")).strip() if row.get("search_query") else None),
            active=bool(row.get("active", True)),
        )
        if not entry.team:
            continue
        if active_only and not entry.active:
            continue
        if network and entry.network != network:
            continue
        if team_filter and entry.team != team_filter:
            continue
        if include_fan is None:
            include_fan = os.getenv("SENTIMENT_INCLUDE_FAN", "false").strip().lower() in (
                "1",
                "true",
                "yes",
            )
        if not include_fan and entry.tier == "fan":
            continue
        entries.append(entry)

    if network is None:
        from src.sentiment.chat_sports_channels import load_chat_sports_channels

        seen_teams = {e.team for e in entries if e.network == "chat_sports"}
        for cs in load_chat_sports_channels(active_only=active_only):
            if team_filter and cs.team != team_filter:
                continue
            if cs.team in seen_teams:
                continue
            entries.append(
                ChannelEntry(
                    channel_id=cs.channel_id,
                    team=cs.team,
                    tier=cs.tier,
                    weight=cs.weight,
                    label=cs.label,
                    network=cs.network,
                    search_query=cs.primary_search_query(),
                    active=cs.active,
                )
            )
    return entries


def count_channels_by_network(active_only: bool = True) -> dict[str, int]:
    counts: dict[str, int] = {}
    for entry in load_channels(active_only=active_only):
        counts[entry.network] = counts.get(entry.network, 0) + 1
    return counts
