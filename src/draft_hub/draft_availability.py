"""Shared draft-night availability calendar.

Opens 31 days before the first regular-season NFL game and closes the day
before that game. One calendar per league; members mark hours that work.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from src.draft_hub import storage
from src.draft_hub.owner_display import attach_owner_names_to_teams

OPEN_DAYS_BEFORE = 31
SLOT_HOURS = (12, 14, 16, 18, 19, 20, 21, 22)
DEFAULT_TZ = "America/New_York"


def first_regular_season_kickoff_utc(season: int) -> datetime:
    from src.draft_hub.sleeper_week1_snapshot import _week1_kickoff_utc

    return _week1_kickoff_utc(int(season))


def _as_tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(str(name or DEFAULT_TZ))
    except Exception:
        return ZoneInfo(DEFAULT_TZ)


def _parse_date(value: str) -> date:
    return date.fromisoformat(str(value).strip()[:10])


def _local_now(timezone_name: str | None, now: datetime | None = None) -> datetime:
    tz = _as_tz(timezone_name)
    ref = now or datetime.now(timezone.utc)
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=timezone.utc)
    return ref.astimezone(tz)


def hour_still_open(day_iso: str, hour: int, window: dict[str, Any]) -> bool:
    today = str(window.get("today") or "")
    if not today:
        return True
    day = str(day_iso)[:10]
    if day > today:
        return True
    if day < today:
        return False
    current = window.get("current_hour")
    if current is None or current == "":
        return True
    return int(hour) >= int(current)


def open_hours_for_date(day_iso: str, window: dict[str, Any]) -> list[int]:
    hours = [int(h) for h in (window.get("hours") or SLOT_HOURS)]
    return [hour for hour in hours if hour_still_open(day_iso, hour, window)]


def availability_window(
    season: int,
    *,
    timezone_name: str | None = None,
    now: datetime | None = None,
    first_kickoff: datetime | None = None,
) -> dict[str, Any]:
    tz = _as_tz(timezone_name)
    kick = first_kickoff or first_regular_season_kickoff_utc(int(season))
    if kick.tzinfo is None:
        kick = kick.replace(tzinfo=timezone.utc)
    first_game = kick.astimezone(tz).date()
    last_day = first_game - timedelta(days=1)
    first_day = first_game - timedelta(days=OPEN_DAYS_BEFORE)
    now_local = _local_now(timezone_name, now)
    today = now_local.date()
    if today < first_day:
        state = "upcoming"
    elif today > last_day:
        state = "closed"
    else:
        state = "open"
    span = (last_day - first_day).days
    span_dates = [(first_day + timedelta(days=i)).isoformat() for i in range(span + 1)]
    dates = [day for day in span_dates if day >= today.isoformat()]
    return {
        "state": state,
        "season": int(season),
        "timezone": str(timezone_name or DEFAULT_TZ),
        "first_game_date": first_game.isoformat(),
        "opens_on": first_day.isoformat(),
        "closes_on": last_day.isoformat(),
        "hours": list(SLOT_HOURS),
        "dates": dates,
        "today": today.isoformat(),
        "current_hour": now_local.hour,
    }


def window_for_league(
    league: dict[str, Any],
    *,
    now: datetime | None = None,
    first_kickoff: datetime | None = None,
) -> dict[str, Any]:
    return availability_window(
        int(league.get("season") or 0),
        timezone_name=league.get("draft_timezone") or DEFAULT_TZ,
        now=now,
        first_kickoff=first_kickoff,
    )


def validate_slots(
    slots: list[tuple[str, int]] | list[dict[str, Any]],
    window: dict[str, Any],
) -> list[tuple[str, int]]:
    allowed_dates = set(window.get("dates") or [])
    allowed_hours = {int(h) for h in (window.get("hours") or SLOT_HOURS)}
    cleaned: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()
    for raw in slots:
        if isinstance(raw, dict):
            date_text = str(raw.get("date") or "").strip()
            hour_raw = raw.get("hour")
        else:
            date_text = str(raw[0]).strip()
            hour_raw = raw[1]
        try:
            day = _parse_date(date_text).isoformat()
            hour = int(hour_raw)
        except (TypeError, ValueError):
            raise ValueError("Each time needs a date and hour") from None
        if day not in allowed_dates:
            continue
        if hour not in allowed_hours:
            raise ValueError("That hour is not on the calendar")
        if not hour_still_open(day, hour, window):
            continue
        key = (day, hour)
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(key)
    return cleaned


def _person_label(team: dict[str, Any]) -> str:
    owner = str(team.get("owner_name") or "").strip()
    name = str(team.get("name") or "").strip()
    if owner and name and owner.lower() != name.lower():
        return f"{owner} · {name}"
    return owner or name or "Manager"


def build_availability_payload(
    league_id: str,
    user_sub: str,
    *,
    now: datetime | None = None,
    first_kickoff: datetime | None = None,
) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    window = window_for_league(league, now=now, first_kickoff=first_kickoff)
    teams = storage.list_league_teams(league_id)
    attach_owner_names_to_teams(league_id, teams, season_year=league.get("season"))
    humans = [t for t in teams if not t.get("is_bot")]
    team_by_id = {str(t["id"]): t for t in humans}
    viewer = storage.get_team_by_user(league_id, user_sub)
    allowed = set(window["dates"])
    rows = [
        row
        for row in storage.list_draft_availability(league_id)
        if row["date"] in allowed and hour_still_open(row["date"], int(row["hour"]), window)
    ]
    by_slot: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
    submitted: set[str] = set()
    for row in rows:
        team = team_by_id.get(str(row["team_id"]))
        if not team:
            continue
        submitted.add(str(team["id"]))
        by_slot[(row["date"], int(row["hour"]))].append(
            {
                "team_id": team["id"],
                "name": _person_label(team),
            }
        )

    heat: list[dict[str, Any]] = []
    for day in window["dates"]:
        for hour in open_hours_for_date(day, window):
            people = by_slot.get((day, int(hour))) or []
            heat.append(
                {
                    "date": day,
                    "hour": int(hour),
                    "count": len(people),
                    "people": people,
                }
            )
    best = sorted(
        [slot for slot in heat if slot["count"] > 0],
        key=lambda item: (-int(item["count"]), item["date"], int(item["hour"])),
    )[:8]
    mine = [
        {"date": row["date"], "hour": int(row["hour"])}
        for row in rows
        if viewer and str(row["team_id"]) == str(viewer["id"])
    ]
    return {
        "window": window,
        "mine": mine,
        "heat": heat,
        "best": best,
        "submitted": len(submitted),
        "team_count": int(league.get("team_count") or len(humans) or 12),
        "can_edit": window["state"] == "open" and bool(viewer),
        "viewer_team_id": viewer.get("id") if viewer else None,
    }


def save_availability(
    league_id: str,
    user_sub: str,
    slots: list[dict[str, Any]] | list[tuple[str, int]],
    *,
    now: datetime | None = None,
    first_kickoff: datetime | None = None,
) -> dict[str, Any]:
    league = storage.get_league(league_id)
    if not league:
        raise ValueError("League not found")
    window = window_for_league(league, now=now, first_kickoff=first_kickoff)
    if window["state"] == "upcoming":
        raise ValueError(f"Availability opens {window['opens_on']}")
    if window["state"] == "closed":
        raise ValueError("Availability closed the day before the NFL season")
    team = storage.get_team_by_user(league_id, user_sub)
    if not team:
        raise ValueError("Claim a team before marking times")
    cleaned = validate_slots(slots, window)
    storage.replace_team_draft_availability(league_id, str(team["id"]), user_sub, cleaned)
    return build_availability_payload(
        league_id,
        user_sub,
        now=now,
        first_kickoff=first_kickoff,
    )
