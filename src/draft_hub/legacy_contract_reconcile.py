"""Infer cuts/trades from year-over-year sheets and cross-check Sleeper transactions."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

import requests

from src.draft_hub import storage
from src.draft_hub.legacy_contract_import import _norm_name
from src.integrations.sleeper import load_sleeper_players

SLEEPER_API = "https://api.sleeper.app/v1"


def _name_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", _norm_name(name).lower())


def infer_movements_from_snapshots(
    league_id: str,
    *,
    season_year: int,
) -> list[dict[str, Any]]:
    """Diff consecutive seasons to infer cuts, acquisitions, and ambiguous moves."""
    prev_rows = storage.list_league_contract_rows(league_id, season_year=season_year - 1)
    curr_rows = storage.list_league_contract_rows(league_id, season_year=season_year)
    if not prev_rows or not curr_rows:
        return []

    prev_by_player: dict[str, dict[str, Any]] = {}
    for r in prev_rows:
        if r.get("roster_status") == "active":
            prev_by_player[_name_key(r["player_name"])] = r

    curr_by_player: dict[str, dict[str, Any]] = {}
    for r in curr_rows:
        if r.get("roster_status") == "active":
            curr_by_player[_name_key(r["player_name"])] = r

    events: list[dict[str, Any]] = []

    for key, prev in prev_by_player.items():
        curr_owner_row = curr_by_player.get(key)
        prev_owner = prev["owner_label"]
        if not curr_owner_row:
            events.append(
                {
                    "season_year": season_year,
                    "player_name": prev["player_name"],
                    "event_type": "cut",
                    "from_owner": prev_owner,
                    "salary": prev.get("cap_hit"),
                    "source": "import_diff",
                    "confidence": "inferred",
                }
            )
            continue
        curr_owner = curr_owner_row["owner_label"]
        if curr_owner != prev_owner:
            acq = str(curr_owner_row.get("acquisition_type") or "")
            if acq == "draft":
                events.append(
                    {
                        "season_year": season_year,
                        "player_name": prev["player_name"],
                        "event_type": "cut",
                        "from_owner": prev_owner,
                        "to_owner": None,
                        "salary": prev.get("cap_hit"),
                        "source": "import_diff",
                        "confidence": "inferred",
                    }
                )
                events.append(
                    {
                        "season_year": season_year,
                        "player_name": curr_owner_row["player_name"],
                        "event_type": "draft",
                        "from_owner": prev_owner,
                        "to_owner": curr_owner,
                        "salary": curr_owner_row.get("cap_hit"),
                        "source": "import_diff",
                        "confidence": "inferred",
                    }
                )
            else:
                events.append(
                    {
                        "season_year": season_year,
                        "player_name": prev["player_name"],
                        "event_type": "trade_out",
                        "from_owner": prev_owner,
                        "to_owner": curr_owner,
                        "salary": prev.get("cap_hit"),
                        "source": "import_diff",
                        "confidence": "ambiguous",
                    }
                )
                events.append(
                    {
                        "season_year": season_year,
                        "player_name": curr_owner_row["player_name"],
                        "event_type": "trade_in",
                        "from_owner": prev_owner,
                        "to_owner": curr_owner,
                        "salary": curr_owner_row.get("cap_hit"),
                        "source": "import_diff",
                        "confidence": "ambiguous",
                    }
                )
            continue

    for key, curr in curr_by_player.items():
        if key in prev_by_player:
            continue
        acq = curr.get("acquisition_type") or "unknown"
        if acq == "draft":
            etype = "draft"
        elif acq == "waiver" or curr.get("cap_hit") == 1:
            etype = "waiver"
        elif acq == "post_draft_fa":
            etype = "post_draft_fa"
        else:
            etype = "acquired"
        events.append(
            {
                "season_year": season_year,
                "player_name": curr["player_name"],
                "event_type": etype,
                "to_owner": curr["owner_label"],
                "salary": curr.get("cap_hit"),
                "source": "import_diff",
                "confidence": "inferred",
            }
        )

    for r in curr_rows:
        if r.get("roster_status") == "cut":
            events.append(
                {
                    "season_year": season_year,
                    "player_name": r["player_name"],
                    "event_type": "cut",
                    "from_owner": r["owner_label"],
                    "dead_cap": r.get("cap_hit"),
                    "salary": r.get("prior_salary"),
                    "source": "import_diff",
                    "confidence": "imported",
                }
            )

    return events


def fetch_sleeper_transactions(
    sleeper_league_id: str,
    *,
    max_rounds: int = 25,
    include_round_zero: bool = True,
) -> list[dict[str, Any]]:
    """Fetch Sleeper transactions. Round 0 = preseason/offseason (pre–week 1)."""
    out: list[dict[str, Any]] = []
    start = 0 if include_round_zero else 1
    for rnd in range(start, max_rounds + 1):
        try:
            resp = requests.get(
                f"{SLEEPER_API}/league/{sleeper_league_id}/transactions/{rnd}",
                timeout=25,
            )
            if resp.status_code == 404:
                if rnd == 0:
                    continue
                break
            resp.raise_for_status()
            batch = resp.json() or []
            if not batch:
                if rnd == 0:
                    continue
                break
            out.extend(batch)
        except Exception:
            if rnd == 0:
                continue
            break
    return out


def _player_name_from_sleeper_id(sid: str, raw: dict[str, Any]) -> str:
    info = raw.get(str(sid)) or {}
    return str(info.get("full_name") or f"Sleeper {sid}")


def reconcile_movements_with_sleeper(
    league_id: str,
    sleeper_league_id: str,
    *,
    season_year: int,
) -> dict[str, Any]:
    """Upgrade ambiguous import_diff events using structured Sleeper transaction data."""
    from src.draft_hub.sleeper_acquisition_hints import (
        apply_sleeper_acquisition_tags,
        sleeper_league_id_for_season,
    )

    events = storage.list_league_movements(league_id, season_year=season_year)
    if not events:
        events = infer_movements_from_snapshots(league_id, season_year=season_year)
        storage.replace_league_movements(league_id, season_year, events)

    lid = sleeper_league_id_for_season(sleeper_league_id, season_year) or sleeper_league_id
    stats = apply_sleeper_acquisition_tags(
        league_id,
        sleeper_league_id,
        season_year=season_year,
    )
    return {
        "season_year": season_year,
        "sleeper_league_id": lid,
        "transactions_scanned": stats.get("acquisitions_found", 0),
        "events_upgraded": stats.get("rows_tagged", 0) + stats.get("movements_resolved", 0),
        "rows_tagged": stats.get("rows_tagged", 0),
        "movements_resolved": stats.get("movements_resolved", 0),
        "movement_count": len(storage.list_league_movements(league_id, season_year=season_year)),
    }


def infer_all_season_movements(league_id: str) -> int:
    seasons = sorted(storage.list_league_contract_seasons(league_id))
    total = 0
    for yr in seasons:
        if yr <= min(seasons):
            continue
        events = infer_movements_from_snapshots(league_id, season_year=yr)
        total += storage.replace_league_movements(league_id, yr, events)
    return total
