"""Load Chat Sports per-team YouTube channel registry."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from src.config import SENTIMENT_DIR
from src.sentiment.channels import DEFAULT_TIER_WEIGHTS
from src.sentiment.networks import load_networks

CHAT_SPORTS_CHANNELS_PATH = SENTIMENT_DIR / "chat_sports_channels.yaml"
CHAT_SPORTS_DISCOVERED_PATH = SENTIMENT_DIR / "chat_sports_channels.discovered.yaml"
NETWORK_KEY = "chat_sports"

CHAT_SPORTS_SHORT: dict[str, str] = {
    "ARI": "Cardinals",
    "ATL": "Falcons",
    "BAL": "Ravens",
    "BUF": "Bills",
    "CAR": "Panthers",
    "CHI": "Bears",
    "CIN": "Bengals",
    "CLE": "Browns",
    "DAL": "Cowboys",
    "DEN": "Broncos",
    "DET": "Lions",
    "GB": "Packers",
    "HOU": "Texans",
    "IND": "Colts",
    "JAX": "Jaguars",
    "KC": "Chiefs",
    "LAC": "Chargers",
    "LAR": "Rams",
    "LV": "Raiders",
    "MIA": "Dolphins",
    "MIN": "Vikings",
    "NE": "Patriots",
    "NO": "Saints",
    "NYG": "Giants",
    "NYJ": "Jets",
    "PHI": "Eagles",
    "PIT": "Steelers",
    "SEA": "Seahawks",
    "SF": "49ers",
    "TB": "Buccaneers",
    "TEN": "Titans",
    "WAS": "Commanders",
}

# Extra keywords for disambiguation (e.g. NYG vs NYJ)
CHAT_SPORTS_KEYWORDS: dict[str, list[str]] = {
    "NYG": ["giants", "new york giants"],
    "NYJ": ["jets", "new york jets"],
    "LAR": ["rams", "los angeles rams"],
    "LAC": ["chargers", "los angeles chargers"],
}

GENERIC_PARENT_PATTERNS = (
    "chat sports",
    "chatsportstv",
    "chat sports tv",
    "chat sports nfl",
    "chat sports nba",
    "chat sports cfb",
)


def team_keywords(team: str) -> list[str]:
    team = team.upper()
    short = CHAT_SPORTS_SHORT[team].lower()
    keywords = [short, short.rstrip("s")]
    keywords.extend(CHAT_SPORTS_KEYWORDS.get(team, []))
    if team == "GB":
        keywords.extend(["packers", "green bay"])
    if team == "NE":
        keywords.extend(["patriots", "new england"])
    if team == "NO":
        keywords.extend(["saints", "new orleans"])
    if team == "SF":
        keywords.extend(["49ers", "niners", "san francisco"])
    if team == "TB":
        keywords.extend(["buccaneers", "bucs", "tampa bay"])
    if team == "JAX":
        keywords.extend(["jaguars", "jags", "jacksonville"])
    return list(dict.fromkeys(k for k in keywords if k))


def _is_generic_parent(title: str) -> bool:
    import re

    title_l = title.lower().strip()
    if title_l in GENERIC_PARENT_PATTERNS:
        return True
    if title_l == "chat sports":
        return True
    if "chat sports" in title_l and not re.search(r"\b(report|now)\b", title_l, re.I):
        return len(title_l.split()) <= 4
    return False


def score_chat_sports_match(title: str, team: str) -> int:
    import re

    title_l = title.lower()
    score = 0
    if "chat sports" in title_l:
        score += 10
    for kw in team_keywords(team):
        if kw in title_l:
            score += 8
            break
    if re.search(r"\b(report|now)\b", title_l, re.I):
        score += 5
    if _is_generic_parent(title):
        score -= 20
    if any(x in title_l for x in ("nba", "basketball", "college football", "cfb")) and not any(
        kw in title_l for kw in team_keywords(team)
    ):
        score -= 15
    return score


def confidence_from_score(score: int) -> str:
    if score >= 12:
        return "high"
    if score >= 8:
        return "medium"
    return "unresolved"


def naming_variant_from_title(title: str) -> str:
    title_l = title.lower()
    if " now" in title_l or title_l.endswith(" now"):
        return "now"
    if "report" in title_l:
        return "report"
    return "unknown"


def search_queries_for_team(team: str) -> list[str]:
    short = CHAT_SPORTS_SHORT[team.upper()]
    return [
        f"{short} Report Chat Sports",
        f"{short} Now Chat Sports",
        f"{short} Chat Sports NFL",
    ]


def handle_candidates_for_team(team: str) -> list[str]:
    """YouTube @handles to probe via channels.list (cheaper than search API)."""
    team = team.upper()
    short = CHAT_SPORTS_SHORT[team]
    mascot = short.replace(" ", "")
    handles = [
        f"{mascot}Today",
        f"{mascot}Report",
        f"{mascot}Now",
        f"{mascot}TV",
        f"{short.lower()}news",
        f"the{mascot}Report",
        f"{mascot}Talk",
        f"{mascot}Breakdown",
        f"{mascot}Rundown",
    ]
    if team == "JAX":
        handles.extend(["jagsnews", "JagsReport"])
    if team == "TB":
        handles.extend(["BucsNow", "bucsreport"])
    if team == "IND":
        handles.extend(["ColtsTalk", "coltsnews"])
    if team == "NYG":
        handles.extend(["thegiantsreport", "GiantsReport"])
    if team == "WAS":
        handles.extend(["CommandersReport", "commandersreport"])
    return list(dict.fromkeys(handles))


def resolve_channel_by_handles(
    team: str,
    *,
    api_get,
    min_score: int = 8,
) -> dict | None:
    """Return best Chat Sports channel match for team using handle lookup."""
    best: dict | None = None
    for handle in handle_candidates_for_team(team):
        try:
            payload = api_get(
                "channels",
                {"part": "snippet,statistics", "forHandle": handle.lstrip("@")},
            )
        except Exception:
            continue
        items = payload.get("items") or []
        if not items:
            continue
        item = items[0]
        snippet = item.get("snippet") or {}
        stats = item.get("statistics") or {}
        title = str(snippet.get("title") or "")
        score = score_chat_sports_match(title, team)
        if score < min_score:
            continue
        candidate = {
            "channel_id": item["id"],
            "title": title,
            "score": score,
            "handle": handle,
            "custom_url": snippet.get("customUrl"),
            "subscriber_count": int(stats.get("subscriberCount") or 0),
            "video_count": int(stats.get("videoCount") or 0),
            "confidence": confidence_from_score(score),
            "naming_variant": naming_variant_from_title(title),
        }
        if best is None or score > best["score"]:
            best = candidate
        elif score == best["score"] and candidate["subscriber_count"] > best["subscriber_count"]:
            best = candidate
    return best


@dataclass(frozen=True)
class ChatSportsChannelEntry:
    channel_id: str
    team: str
    network: str
    tier: str
    weight: float
    label: str
    search_queries: tuple[str, ...] = ()
    search_query: str | None = None
    naming_variant: str = "unknown"
    confidence: str = "unresolved"
    active: bool = True
    promote_to_features: bool = False
    custom_url: str | None = None
    subscriber_count: int | None = None
    video_count: int | None = None

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

    @property
    def channel_label(self) -> str:
        return self.label

    def needs_resolution(self) -> bool:
        return not self.channel_id or self.channel_id.startswith("UC_PLACEHOLDER")

    def primary_search_query(self) -> str:
        if self.search_queries:
            return self.search_queries[0]
        return self.search_query or self.label


def _parse_queries(row: dict) -> tuple[str, ...]:
    raw = row.get("search_queries")
    if isinstance(raw, list) and raw:
        return tuple(str(q).strip() for q in raw if str(q).strip())
    sq = row.get("search_query")
    if sq:
        return (str(sq).strip(),)
    return ()


def load_chat_sports_channels(
    path: Path | None = None,
    *,
    active_only: bool = True,
    team: str | None = None,
) -> list[ChatSportsChannelEntry]:
    path = path or CHAT_SPORTS_CHANNELS_PATH
    if not path.exists():
        return []

    networks = load_networks()
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    entries: list[ChatSportsChannelEntry] = []
    for row in raw.get("channels") or []:
        if not isinstance(row, dict):
            continue
        team_code = str(row.get("team") or "").upper()
        network_key = str(row.get("network") or NETWORK_KEY)
        net_cfg = networks.get(network_key)
        tier = str(row.get("tier") or (net_cfg.default_tier if net_cfg else "reporting")).lower()
        weight = row.get("weight")
        if weight is None:
            weight = DEFAULT_TIER_WEIGHTS.get(tier, 1.0)
        queries = _parse_queries(row)
        entry = ChatSportsChannelEntry(
            channel_id=str(row.get("channel_id") or "").strip(),
            team=team_code,
            network=network_key,
            tier=tier,
            weight=float(weight),
            label=str(row.get("label") or "").strip(),
            search_queries=queries,
            search_query=queries[0] if queries else None,
            naming_variant=str(row.get("naming_variant") or "unknown"),
            confidence=str(row.get("confidence") or "unresolved"),
            active=bool(row.get("active", True)),
            promote_to_features=bool(row.get("promote_to_features", False)),
            custom_url=(str(row.get("custom_url")).strip() if row.get("custom_url") else None),
            subscriber_count=row.get("subscriber_count"),
            video_count=row.get("video_count"),
        )
        if not team_code:
            continue
        if active_only and not entry.active:
            continue
        if team and entry.team != team.upper():
            continue
        entries.append(entry)
    return entries


def chat_sports_channel_for_team(team: str) -> ChatSportsChannelEntry | None:
    team = team.upper()
    for entry in load_chat_sports_channels():
        if entry.team == team:
            return entry
    return None


def promoted_chat_sports_channel_ids() -> set[str]:
    return {
        c.channel_id
        for c in load_chat_sports_channels()
        if c.promote_to_features and not c.needs_resolution()
    }
