"""Trusted, cache-only identities for saved native lineups.

Keep stored player IDs and historical rows intact. Provider event identities
establish the NFL team for that particular week; today's catalog supplies the
crosswalk and position only when the historical event is absent.
"""
from __future__ import annotations

from typing import Any

from src.core.team_codes import normalize_team_for_match
from src.draft_hub.player_identity import cached_player_identity, PlayerIdentityError, NFL_TEAMS, POSITIONS
from src.draft_hub.rules_engine import normalize_position


def lineup_player_identity(row: dict[str, Any], season: int, week: int,
                           *, snapshot: dict[str, Any] | None = None) -> dict[str, Any] | None:
    pid = str(row.get("player_id") or "").strip()
    supplied_sid = str(row.get("sleeper_player_id") or "").strip()
    try:
        known = cached_player_identity(pid, season=season, sleeper_player_id=supplied_sid or None)
    except PlayerIdentityError:
        return None
    # A separately supplied provider ID never establishes an unrelated raw ID.
    if known and pid not in known["aliases"]:
        return None
    if snapshot is None:
        from src.draft_hub.native_stats import cached_week_snapshot
        snapshot = cached_week_snapshot(season, week)
    snapshot = snapshot or {}
    aliases = [pid, *(known.get("aliases") or ())] if known else [pid]
    events = snapshot.get("identities") or {}
    event = next((events[alias] for alias in aliases if alias in events), None)
    if event is None and known:
        # The historical provider can lack a GSIS alias. Match its trusted name
        # and position, without requiring today's NFL team after an NFL trade.
        name = " ".join(str(known.get("player_name") or "").lower().split())
        matches = [record for record in snapshot.get("records") or []
                   if name and " ".join(str(record.get("name") or "").lower().split()) == name
                   and normalize_position(record.get("position")) == known["position"]]
        if len(matches) == 1:
            event = matches[0]
        elif len(matches) > 1:
            return None
    if event:
        sid = str(event.get("sleeper_player_id") or "").strip()
        if supplied_sid and supplied_sid != sid:
            return None
        team = normalize_team_for_match(event.get("team") or "")
        position = normalize_position(event.get("position"))
        if team not in NFL_TEAMS or position not in POSITIONS:
            return None
        identity = {"player_id": known["player_id"] if known else pid,
                    "player_name": event.get("name") or (known or {}).get("player_name") or pid,
                    "team": team, "position": position, "sleeper_player_id": sid or None}
    elif known:
        identity = dict(known)
    else:
        return None
    sid = identity.get("sleeper_player_id")
    identity["key"] = (f"def:{identity['team']}" if identity["position"] == "DEF" else
                       f"sleeper:{sid}" if sid else f"player:{identity['player_id']}")
    return identity


def trusted_lineup_row(row: dict[str, Any], season: int, week: int,
                       *, snapshot: dict[str, Any] | None = None) -> dict[str, Any] | None:
    identity = lineup_player_identity(row, season, week, snapshot=snapshot)
    if identity is None:
        return None
    return {**row, "player_name": identity["player_name"], "position": identity["position"],
            "team": identity["team"], "nfl_team": identity["team"],
            "sleeper_player_id": identity["sleeper_player_id"],
            "_canonical_player_key": identity["key"]}
