"""The Odds API client for NFL player prop market lines."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from typing import Any

import pandas as pd
import requests

from src.config import CACHE_DIR
from src.integrations.external_projections import _normalize_name

ODDS_CACHE_DIR = CACHE_DIR / "props"
ODDS_BASE_URL = "https://api.the-odds-api.com/v4"
NFL_SPORT_KEY = "americanfootball_nfl"

# Odds API market keys -> ScoreSense prop_type
MARKET_TO_PROP = {
    "player_pass_yds": "pass_yards",
    "player_pass_tds": "pass_tds",
    "player_rush_yds": "rush_yards",
    "player_reception_yds": "rec_yards",
    "player_receptions": "receptions",
    "player_anytime_td": "anytime_td",
}

PROP_MARKETS = tuple(MARKET_TO_PROP.keys())
PREFERRED_BOOKS = ("draftkings", "fanduel", "betmgm", "caesars")


def odds_api_key_configured() -> bool:
    return bool(os.getenv("ODDS_API_KEY", "").strip())


def get_odds_api_key() -> str:
    key = os.getenv("ODDS_API_KEY", "").strip()
    if not key:
        raise RuntimeError("ODDS_API_KEY is not set. Add it to .env (never commit the key).")
    return key


def _cache_path(season: int, week: int) -> Any:
    ODDS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return ODDS_CACHE_DIR / f"{season}_week{week:02d}_props.parquet"


def _meta_path(season: int, week: int) -> Any:
    ODDS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return ODDS_CACHE_DIR / f"{season}_week{week:02d}_meta.json"


def _odds_get(path: str, params: dict | None = None) -> Any:
    query = dict(params or {})
    query["apiKey"] = get_odds_api_key()
    url = f"{ODDS_BASE_URL}/{path.lstrip('/')}"
    response = requests.get(url, params=query, timeout=60)
    response.raise_for_status()
    return response.json()


def _pick_bookmaker(bookmakers: list[dict]) -> dict | None:
    by_key = {str(b.get("key") or ""): b for b in bookmakers if isinstance(b, dict)}
    for key in PREFERRED_BOOKS:
        if key in by_key:
            return by_key[key]
    return bookmakers[0] if bookmakers else None


def parse_event_odds_payload(payload: dict) -> pd.DataFrame:
    """Flatten one event odds response into name_key / prop_type / market_line rows."""
    rows: list[dict] = []
    bookmakers = payload.get("bookmakers") or []
    book = _pick_bookmaker(bookmakers)
    if not book:
        return pd.DataFrame()

    book_key = str(book.get("key") or "")
    for market in book.get("markets") or []:
        if not isinstance(market, dict):
            continue
        market_key = str(market.get("key") or "")
        prop_type = MARKET_TO_PROP.get(market_key)
        if not prop_type:
            continue

        over_lines: dict[str, list[float]] = {}
        for outcome in market.get("outcomes") or []:
            if not isinstance(outcome, dict):
                continue
            if str(outcome.get("name") or "").lower() != "over":
                continue
            player = str(outcome.get("description") or outcome.get("name") or "").strip()
            if not player or player.lower() == "over":
                continue
            point = outcome.get("point")
            try:
                line = float(point)
            except (TypeError, ValueError):
                continue
            over_lines.setdefault(player, []).append(line)

        for player, lines in over_lines.items():
            if not lines:
                continue
            rows.append(
                {
                    "player_name": player,
                    "name_key": _normalize_name(player),
                    "prop_type": prop_type,
                    "market_line": sum(lines) / len(lines),
                    "bookmaker": book_key,
                    "event_id": str(payload.get("id") or ""),
                }
            )

    return pd.DataFrame(rows)


def fetch_nfl_player_props(
    *,
    regions: str = "us",
    force_refresh: bool = False,
) -> pd.DataFrame:
    """Fetch current-week NFL player prop lines across upcoming events."""
    events = _odds_get(f"sports/{NFL_SPORT_KEY}/events")
    if not isinstance(events, list):
        raise ValueError("Unexpected Odds API events payload")

    frames: list[pd.DataFrame] = []
    markets = ",".join(PROP_MARKETS)
    for event in events:
        if not isinstance(event, dict):
            continue
        event_id = event.get("id")
        if not event_id:
            continue
        try:
            payload = _odds_get(
                f"sports/{NFL_SPORT_KEY}/events/{event_id}/odds",
                {
                    "regions": regions,
                    "markets": markets,
                    "oddsFormat": "american",
                },
            )
        except requests.HTTPError:
            continue
        if isinstance(payload, dict):
            frame = parse_event_odds_payload(payload)
            if not frame.empty:
                frames.append(frame)
        time.sleep(0.2)

    if not frames:
        return pd.DataFrame(columns=["name_key", "prop_type", "market_line"])
    out = pd.concat(frames, ignore_index=True)
    return out.drop_duplicates(subset=["name_key", "prop_type"], keep="last")


def load_cached_props(season: int, week: int) -> pd.DataFrame:
    path = _cache_path(season, week)
    if path.exists():
        return pd.read_parquet(path)
    return pd.DataFrame()


def archive_props_for_week(
    season: int,
    week: int,
    *,
    force_refresh: bool = False,
) -> dict:
    """Fetch and cache prop lines for a logical NFL week."""
    if not odds_api_key_configured():
        return {"status": "skipped", "reason": "ODDS_API_KEY not set"}

    cache = _cache_path(season, week)
    if cache.exists() and not force_refresh:
        cached = pd.read_parquet(cache)
        return {
            "status": "cached",
            "season": season,
            "week": week,
            "rows": len(cached),
        }

    try:
        props = fetch_nfl_player_props(force_refresh=force_refresh)
    except Exception as exc:
        return {"status": "error", "season": season, "week": week, "detail": str(exc)}

    props["season"] = season
    props["week"] = week
    if not props.empty:
        props.to_parquet(cache, index=False)
    _meta_path(season, week).write_text(
        json.dumps(
            {
                "season": season,
                "week": week,
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "rows": len(props),
            },
            indent=2,
        )
    )
    return {
        "status": "ok",
        "season": season,
        "week": week,
        "rows": len(props),
    }


def load_market_lines(season: int, week: int, *, live: bool = False) -> pd.DataFrame:
    """Return cached market lines, optionally refreshing from the API."""
    if live and odds_api_key_configured():
        archive_props_for_week(season, week, force_refresh=True)
    cached = load_cached_props(season, week)
    if cached.empty:
        return pd.DataFrame(columns=["name_key", "prop_type", "market_line"])
    return cached[["name_key", "prop_type", "market_line"]].copy()
