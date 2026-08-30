"""League atmosphere: account themes, team identity, week trophies, and victory reactions.

Catalogs and merge/validation stay here so storage and routes stay thin.
These extras are opt-in. They never rewrite contracts, scoring, or roster rules.
"""

from __future__ import annotations

from typing import Any

ATMOSPHERE_THEMES = ("none", "snow", "leaves", "footballs")

PHOTO_PRESETS = (
    "gridiron",
    "tunnel",
    "night",
    "turf",
    "storm",
    "locker_lights",
)

BANNER_PRESETS = (
    "navy_stripe",
    "teal_fade",
    "amber_edge",
    "home_white",
    "away_slate",
    "championship",
)

ROOM_THEMES = ("none", "locker")

MAX_LOCKER_PLAYERS = 8
MAX_TEAM_NAME_CHARS = 48
MAX_MEDIA_BYTES = 2 * 1024 * 1024
ALLOWED_MEDIA_TYPES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}

TROPHY_POLLS: dict[str, dict[str, str]] = {
    "hearts_loser": {
        "title": "Loser in our hearts",
        "support": "Who is most voted to drop this matchup.",
    },
    "week_mvp": {
        "title": "Week MVP",
        "support": "Who is running the board this week.",
    },
    "lucky_break": {
        "title": "Got away with it",
        "support": "Who is surviving a matchup they should not.",
    },
    "heartbreak": {
        "title": "Closest call",
        "support": "Whose week is hanging on one score.",
    },
}

VICTORY_EMOTES: dict[str, dict[str, str]] = {
    "walkoff": {"title": "Walk-off", "hint": "Leave the field first."},
    "salute": {"title": "Salute", "hint": "A clean, smug tip of the cap."},
    "flex": {"title": "Flex", "hint": "Show the work."},
    "bow": {"title": "Bow", "hint": "Thank the crowd. Or don't."},
    "point": {"title": "Point", "hint": "That's you. That's the loss."},
    "micdrop": {"title": "Mic drop", "hint": "Scoreboard closed."},
}


def default_atmosphere_prefs() -> dict[str, Any]:
    return {"atmosphere": "none"}


def merge_atmosphere_prefs(raw: Any) -> dict[str, Any]:
    base = default_atmosphere_prefs()
    if not isinstance(raw, dict):
        return base
    theme = str(raw.get("atmosphere") or "none").strip().lower()
    if theme not in ATMOSPHERE_THEMES:
        theme = "none"
    base["atmosphere"] = theme
    return base


def default_team_identity() -> dict[str, Any]:
    return {
        "photo_preset": "gridiron",
        "banner_preset": "navy_stripe",
        "photo_media_id": None,
        "banner_media_id": None,
        "room_theme": "none",
        "locker_player_ids": [],
    }


def _clean_media_id(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text or len(text) > 64:
        return None
    if any(ch in text for ch in ("/", "\\", "..")):
        return None
    return text


def merge_team_identity(raw: Any) -> dict[str, Any]:
    base = default_team_identity()
    if not isinstance(raw, dict):
        return base
    photo = str(raw.get("photo_preset") or base["photo_preset"]).strip().lower()
    banner = str(raw.get("banner_preset") or base["banner_preset"]).strip().lower()
    room = str(raw.get("room_theme") or "none").strip().lower()
    if photo not in PHOTO_PRESETS:
        photo = base["photo_preset"]
    if banner not in BANNER_PRESETS:
        banner = base["banner_preset"]
    if room not in ROOM_THEMES:
        room = "none"
    ids: list[str] = []
    seen: set[str] = set()
    for item in raw.get("locker_player_ids") or []:
        pid = str(item or "").strip()
        if not pid or pid in seen:
            continue
        seen.add(pid)
        ids.append(pid)
        if len(ids) >= MAX_LOCKER_PLAYERS:
            break
    base.update(
        {
            "photo_preset": photo,
            "banner_preset": banner,
            "photo_media_id": _clean_media_id(raw.get("photo_media_id")),
            "banner_media_id": _clean_media_id(raw.get("banner_media_id")),
            "room_theme": room,
            "locker_player_ids": ids,
        }
    )
    return base


def locker_players_from_roster(
    identity: dict[str, Any],
    roster: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Resolve locker nameplates against the current active roster."""
    merged = merge_team_identity(identity)
    wanted = list(merged.get("locker_player_ids") or [])
    by_id = {
        str(row.get("player_id") or ""): row
        for row in (roster or [])
        if str(row.get("roster_status") or "active") == "active"
    }
    out: list[dict[str, Any]] = []
    for pid in wanted:
        row = by_id.get(pid)
        if not row:
            continue
        name = str(row.get("player_name") or "").strip()
        last = name.split()[-1] if name else pid
        out.append(
            {
                "player_id": pid,
                "player_name": name or pid,
                "nameplate": last[:12],
                "position": str(row.get("position") or ""),
            }
        )
    return out


def detect_image_type(payload: bytes, content_type: str | None = None) -> str | None:
    if not payload or len(payload) > MAX_MEDIA_BYTES:
        return None
    if payload.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if payload.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if payload.startswith(b"RIFF") and payload[8:12] == b"WEBP":
        return "image/webp"
    hinted = str(content_type or "").split(";")[0].strip().lower()
    if hinted in ALLOWED_MEDIA_TYPES and any(payload.startswith(sig) for sig in ALLOWED_MEDIA_TYPES[hinted]):
        return hinted
    return None


def atmosphere_catalog() -> dict[str, Any]:
    return {
        "atmosphere": [
            {"id": "none", "title": "Off", "support": "Keep Fantasy quiet. Recommended default."},
            {"id": "snow", "title": "Snow", "support": "A faint winter drift behind the page."},
            {"id": "leaves", "title": "Fall leaves", "support": "A light autumn fall, never in front of the board."},
            {"id": "footballs", "title": "Footballs", "support": "Soft footballs drifting in the background."},
        ],
        "photos": [
            {"id": "gridiron", "title": "Gridiron"},
            {"id": "tunnel", "title": "Tunnel"},
            {"id": "night", "title": "Night kickoff"},
            {"id": "turf", "title": "Turf"},
            {"id": "storm", "title": "Storm"},
            {"id": "locker_lights", "title": "Locker lights"},
        ],
        "banners": [
            {"id": "navy_stripe", "title": "Navy stripe"},
            {"id": "teal_fade", "title": "Teal fade"},
            {"id": "amber_edge", "title": "Amber edge"},
            {"id": "home_white", "title": "Home white"},
            {"id": "away_slate", "title": "Away slate"},
            {"id": "championship", "title": "Championship"},
        ],
        "rooms": [
            {"id": "none", "title": "No room theme", "support": "Keep My team on the standard surface."},
            {"id": "locker", "title": "Locker room", "support": "Put selected names on lockers behind your roster."},
        ],
        "trophies": [
            {"id": key, **meta} for key, meta in TROPHY_POLLS.items()
        ],
        "emotes": [
            {"id": key, **meta} for key, meta in VICTORY_EMOTES.items()
        ],
    }


def tally_poll_votes(
    votes: list[dict[str, Any]],
    teams: list[dict[str, Any]],
    *,
    viewer_team_id: str | None = None,
) -> dict[str, Any]:
    counts: dict[str, int] = {}
    viewer_vote = None
    for vote in votes or []:
        nominee = str(vote.get("nominee_team_id") or "")
        if not nominee:
            continue
        counts[nominee] = counts.get(nominee, 0) + 1
        if viewer_team_id and str(vote.get("voter_team_id") or "") == str(viewer_team_id):
            viewer_vote = nominee
    ranked = []
    for team in teams:
        tid = str(team.get("id") or "")
        if not tid:
            continue
        ranked.append(
            {
                "team_id": tid,
                "team_name": team.get("name") or team.get("sleeper_team_name") or "Team",
                "votes": int(counts.get(tid, 0)),
            }
        )
    ranked.sort(key=lambda row: (-row["votes"], row["team_name"].lower()))
    return {
        "options": ranked,
        "total_votes": sum(row["votes"] for row in ranked),
        "viewer_vote": viewer_vote,
        "leader_team_id": ranked[0]["team_id"] if ranked and ranked[0]["votes"] else None,
    }


def matchup_winner_and_loser(matchup: dict[str, Any] | None) -> tuple[str | None, str | None]:
    teams = list((matchup or {}).get("teams") or [])
    if len(teams) < 2:
        return None, None
    scored = []
    for team in teams:
        tid = str(team.get("hub_team_id") or team.get("team_id") or team.get("id") or "")
        if not tid:
            continue
        scored.append((tid, float(team.get("points") or 0)))
    if len(scored) < 2:
        return None, None
    scored.sort(key=lambda item: -item[1])
    if scored[0][1] <= scored[1][1]:
        return None, None
    return scored[0][0], scored[1][0]


def can_send_victory_emote(
    *,
    from_team_id: str | None,
    to_team_id: str | None,
    matchup: dict[str, Any] | None,
) -> bool:
    winner, loser = matchup_winner_and_loser(matchup)
    return bool(
        from_team_id
        and to_team_id
        and winner == str(from_team_id)
        and loser == str(to_team_id)
    )


def viewer_matchup(matchups: list[dict[str, Any]] | None, viewer_team_id: str | None) -> dict[str, Any] | None:
    if not viewer_team_id:
        return None
    wanted = str(viewer_team_id)
    for matchup in matchups or []:
        teams = matchup.get("teams") or []
        ids = {
            str(team.get("hub_team_id") or team.get("team_id") or team.get("id") or "")
            for team in teams
        }
        if wanted in ids:
            return matchup
    return None
