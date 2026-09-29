"""Vegas lines readout for a week's slate — spreads, totals, implied team totals.

Sourced from the cached nflverse schedule (`schedule_utils`). Sign convention
per nflverse: a positive ``spread_line`` means the home team is favored by
that many points, so ``home_implied = (total_line + spread_line) / 2``.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import threading
import time
from typing import Callable
from zoneinfo import ZoneInfo

import pandas as pd

from src.core.projection_context import REGULAR_SEASON_MAX_WEEK
from src.core.schedule_utils import SCHEDULE_CACHE, _load_schedules, _parse_gametime
from src.core.team_codes import normalize_team_to_mlready
from src.config import CACHE_DIR, is_testing

logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")
_LINE_HISTORY_DIR = CACHE_DIR / "vegas_line_history"
# The shared schedule cache is otherwise written once, which would freeze lines
# (and hide every move). Re-pull the season's consensus lines this often.
LINE_REFRESH_SECONDS = 3 * 60 * 60
_LINE_RETRY_SECONDS = 15 * 60
_line_refresh_lock = threading.Lock()
_line_refresh_attempts: dict[int, float] = {}


def _to_float(value) -> float | None:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if pd.notna(out) else None


def _kickoff_et(gameday, gametime) -> str | None:
    day = pd.Timestamp(gameday) if gameday is not None else pd.NaT
    if pd.isna(day):
        return None
    date_et = day.tz_convert(_ET).date() if day.tzinfo is not None else day.date()
    hh, mm = _parse_gametime(gametime)
    return datetime(date_et.year, date_et.month, date_et.day, hh, mm, tzinfo=_ET).isoformat()


def _implied_totals(spread: float | None, total: float | None) -> tuple[float | None, float | None]:
    """(home_implied, away_implied) from a home-relative spread and game total."""
    if spread is None or total is None:
        return None, None
    home = round((total + spread) / 2, 1)
    away = round((total - spread) / 2, 1)
    return home, away


def refresh_schedule_season(
    season: int,
    cache_path: Path = SCHEDULE_CACHE,
    loader: Callable[[list[int]], pd.DataFrame] | None = None,
) -> bool:
    """Replace one season in the shared schedule cache with the latest nflverse pull.

    Other seasons already in the cache are kept. The write is atomic so readers
    never see a partial file. Returns True when the cache was rewritten.
    """
    season = int(season)
    if loader is None:
        from src.etl.nflverse_etl import load_schedules as loader
    fresh = loader([season])
    if fresh is None or fresh.empty or "season" not in fresh.columns:
        return False
    fresh = fresh[fresh["season"] == season]
    if fresh.empty:
        return False
    merged = fresh
    if cache_path.exists():
        try:
            cached = pd.read_parquet(cache_path)
            kept = cached[cached["season"] != season]
            if not kept.empty:
                merged = pd.concat([kept, fresh], ignore_index=True)
        except Exception:  # unreadable cache: replace it with the fresh season
            merged = fresh
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = cache_path.with_name(f"{cache_path.stem}.refresh{cache_path.suffix}")
    merged.to_parquet(temp_path, index=False)
    temp_path.replace(cache_path)
    return True


def refresh_lines_if_stale(
    season: int,
    cache_path: Path = SCHEDULE_CACHE,
    max_age_seconds: float = LINE_REFRESH_SECONDS,
    now: float | None = None,
    start: Callable[[Callable[[], None]], None] | None = None,
) -> bool:
    """Start one background re-pull when the cached lines are older than ``max_age_seconds``.

    The board keeps serving the cached lines; the next load picks up the refresh.
    Failures are logged and retried after a short back-off. Returns True when a
    refresh was started.
    """
    season = int(season)
    now = time.time() if now is None else now
    try:
        age = now - cache_path.stat().st_mtime
    except OSError:
        return False  # no cache yet: _load_schedules downloads it on this request
    if age < max_age_seconds:
        return False
    with _line_refresh_lock:
        last = _line_refresh_attempts.get(season)
        if last is not None and now - last < _LINE_RETRY_SECONDS:
            return False
        _line_refresh_attempts[season] = now

    def _run() -> None:
        try:
            refresh_schedule_season(season, cache_path)
        except Exception:
            logger.warning("Vegas line refresh failed for %s", season, exc_info=True)

    if start is None:
        threading.Thread(target=_run, name=f"vegas-lines-{season}", daemon=True).start()
    else:
        start(_run)
    return True


def attach_line_history(board: dict, history_path: Path | None = None) -> dict:
    """Attach an honest first-seen baseline for line movement.

    nflverse schedules expose the latest consensus line, not a sportsbook's
    opening line. We therefore preserve the first value ScoreSense observed
    and label the comparison accordingly in the UI.
    """
    season = int(board["season"])
    week = int(board["week"])
    path = history_path or (_LINE_HISTORY_DIR / f"{season}_w{week}.json")
    history: dict[str, dict] = {}
    try:
        if path.exists():
            loaded = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                history = loaded
    except (OSError, ValueError, TypeError):
        history = {}

    now = datetime.now(timezone.utc).isoformat()
    changed = False
    for game in board.get("games", []):
        game_id = str(game.get("game_id") or "")
        if not game_id:
            continue
        baseline = history.get(game_id)
        if not isinstance(baseline, dict):
            baseline = {
                "spread_line": game.get("spread_line"),
                "total_line": game.get("total_line"),
                "first_seen_at": now,
            }
            history[game_id] = baseline
            changed = True
        else:
            for field in ("spread_line", "total_line"):
                if _to_float(baseline.get(field)) is None and _to_float(game.get(field)) is not None:
                    baseline[field] = game.get(field)
                    changed = True
        game["first_seen_spread_line"] = _to_float(baseline.get("spread_line"))
        game["first_seen_total_line"] = _to_float(baseline.get("total_line"))
        game["line_first_seen_at"] = baseline.get("first_seen_at")

    if changed:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = path.with_suffix(".tmp")
            temp_path.write_text(json.dumps(history, indent=2), encoding="utf-8")
            temp_path.replace(path)
        except OSError:
            # Movement is an enhancement; a read-only cache must not hide lines.
            pass
    return board


def build_vegas_board(
    season: int,
    week: int,
    schedules: pd.DataFrame | None = None,
) -> dict:
    """One week of games with spread, total, moneylines, and implied team totals."""
    season = int(season)
    week = int(week)
    use_history = schedules is None
    if schedules is None:
        if not is_testing():
            refresh_lines_if_stale(season)
        schedules = _load_schedules([season])

    games_df = schedules[
        (schedules["season"] == season)
        & (schedules["week"] == week)
        & (schedules["week"] <= REGULAR_SEASON_MAX_WEEK)
    ]

    games: list[dict] = []
    teams: dict[str, dict] = {}
    for row in games_df.to_dict(orient="records"):
        home_raw = str(row.get("home_team") or "").upper()
        away_raw = str(row.get("away_team") or "").upper()
        if not home_raw or not away_raw:
            continue
        home = normalize_team_to_mlready(home_raw)
        away = normalize_team_to_mlready(away_raw)

        spread = _to_float(row.get("spread_line"))
        total = _to_float(row.get("total_line"))
        home_implied, away_implied = _implied_totals(spread, total)
        favorite = None
        if spread is not None and spread != 0:
            favorite = home if spread > 0 else away

        roof = str(row.get("roof") or "").strip() or None
        stadium = str(row.get("stadium") or "").strip() or None
        game = {
            "game_id": str(row.get("game_id") or f"{season}_{week}_{away}_{home}"),
            "kickoff_et": _kickoff_et(row.get("gameday"), row.get("gametime")),
            "weekday": str(row.get("weekday") or "") or None,
            "away": away,
            "home": home,
            "spread_line": spread,
            "total_line": total,
            "away_moneyline": _to_float(row.get("away_moneyline")),
            "home_moneyline": _to_float(row.get("home_moneyline")),
            "home_implied": home_implied,
            "away_implied": away_implied,
            "favorite": favorite,
            "roof": roof,
            "stadium": stadium,
            "temp": _to_float(row.get("temp")),
            "wind": _to_float(row.get("wind")),
        }
        games.append(game)

        for team, opponent, implied, is_home in (
            (home, away, home_implied, True),
            (away, home, away_implied, False),
        ):
            team_spread = None
            if spread is not None:
                team_spread = -spread if is_home else spread
            teams[team] = {
                "opponent": opponent,
                "is_home": is_home,
                "implied_total": implied,
                "total_line": total,
                # Team-relative line as a book would quote it (negative = favored).
                "spread": team_spread,
                "kickoff_et": game["kickoff_et"],
                "weekday": game["weekday"],
                "roof": game["roof"],
                "stadium": game["stadium"],
                "temp": game["temp"],
                "wind": game["wind"],
            }

    games.sort(key=lambda g: (g["kickoff_et"] or "9999", g["game_id"]))
    with_lines = sum(1 for g in games if g["total_line"] is not None)
    board = {
        "season": season,
        "week": week,
        "count": len(games),
        "with_lines": with_lines,
        "games": games,
        "teams": teams,
    }
    return attach_line_history(board) if use_history else board
