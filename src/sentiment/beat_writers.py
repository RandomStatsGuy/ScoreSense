"""Load per-team beat reporter registry for UI attribution."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from src.config import SENTIMENT_DIR

BEAT_WRITERS_PATH = SENTIMENT_DIR / "beat_writers.yaml"


@dataclass(frozen=True)
class BeatWriterRef:
    name: str
    outlet: str
    network: str = "local"
    tier: str = "reporting"
    twitter_handle: str | None = None
    espn_team_slug: str | None = None


@dataclass(frozen=True)
class TeamBeatWriters:
    team: str
    primary: BeatWriterRef
    also: tuple[BeatWriterRef, ...] = ()

    @property
    def display_line(self) -> str:
        return f"{self.primary.name} ({self.primary.outlet})"


def _parse_writer(row: dict) -> BeatWriterRef:
    return BeatWriterRef(
        name=str(row.get("name") or "").strip(),
        outlet=str(row.get("outlet") or "").strip(),
        network=str(row.get("network") or "local"),
        tier=str(row.get("tier") or "reporting"),
        twitter_handle=(str(row["twitter_handle"]).strip() if row.get("twitter_handle") else None),
        espn_team_slug=(str(row["espn_team_slug"]).strip() if row.get("espn_team_slug") else None),
    )


def load_beat_writers(
    team: str | None = None,
    path: Path | None = None,
) -> list[TeamBeatWriters]:
    path = path or BEAT_WRITERS_PATH
    if not path.exists():
        return []

    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out: list[TeamBeatWriters] = []
    for row in payload.get("writers") or []:
        if not isinstance(row, dict):
            continue
        team_code = str(row.get("team") or "").strip().upper()
        if team_code == "FALSE":
            team_code = "NO"
        if not team_code:
            continue
        primary_raw = row.get("primary") or {}
        if not isinstance(primary_raw, dict):
            continue
        also = tuple(_parse_writer(x) for x in (row.get("also") or []) if isinstance(x, dict))
        out.append(
            TeamBeatWriters(
                team=team_code,
                primary=_parse_writer(primary_raw),
                also=also,
            )
        )

    if team:
        team = team.upper()
        return [w for w in out if w.team == team]
    return out


def beat_writer_for_team(team: str, path: Path | None = None) -> TeamBeatWriters | None:
    rows = load_beat_writers(team, path=path)
    return rows[0] if rows else None
