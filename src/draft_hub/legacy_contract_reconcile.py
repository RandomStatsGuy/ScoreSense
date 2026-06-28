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

    for key, curr in curr_by_player.items():
        if key in prev_by_player:
            continue
        acq = curr.get("acquisition_type") or "unknown"
        etype = "waiver" if acq == "waiver" or curr.get("cap_hit") == 1 else "acquired"
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


def fetch_sleeper_transactions(sleeper_league_id: str, *, max_rounds: int = 25) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for rnd in range(1, max_rounds + 1):
        try:
            resp = requests.get(
                f"{SLEEPER_API}/league/{sleeper_league_id}/transactions/{rnd}",
                timeout=25,
            )
            if resp.status_code == 404:
                break
            resp.raise_for_status()
            batch = resp.json() or []
            if not batch:
                break
            out.extend(batch)
        except Exception:
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
    """Upgrade ambiguous import_diff events when Sleeper has a matching trade or waiver."""
    events = storage.list_league_movements(league_id, season_year=season_year)
    if not events:
        events = infer_movements_from_snapshots(league_id, season_year=season_year)
        storage.replace_league_movements(league_id, season_year, events)

    txs = fetch_sleeper_transactions(sleeper_league_id)
    raw_players = load_sleeper_players()
    trade_keys: set[str] = set()
    waiver_keys: set[str] = set()

    for tx in txs:
        tx_type = str(tx.get("type") or "").lower()
        adds = tx.get("adds") or {}
        drops = tx.get("drops") or {}
        txid = str(tx.get("transaction_id") or "")
        for sid in list(adds.keys()) + list(drops.keys()):
            pname = _player_name_from_sleeper_id(str(sid), raw_players)
            key = _name_key(pname)
            if tx_type == "trade":
                trade_keys.add(key)
            elif tx_type in ("waiver", "free_agent"):
                waiver_keys.add(key)

    upgraded = 0
    row_flags: list[tuple[int, str]] = []
    for ev in events:
        if ev.get("confidence") != "ambiguous":
            continue
        key = _name_key(ev.get("player_name") or "")
        if key in trade_keys:
            ev["confidence"] = "sleeper_trade"
            ev["source"] = "sleeper"
            upgraded += 1
        elif key in waiver_keys:
            ev["confidence"] = "sleeper_waiver"
            ev["source"] = "sleeper"
            ev["event_type"] = "waiver"
            upgraded += 1

    if upgraded:
        storage.replace_league_movements(league_id, season_year, events)

    ambiguous_rows = storage.list_league_contract_rows(league_id, season_year=season_year)
    for row in ambiguous_rows:
        key = _name_key(row["player_name"])
        if key in trade_keys:
            storage.update_league_contract_row(
                int(row["id"]),
                {
                    "acquisition_type": "trade",
                    "confidence": "sleeper_confirmed",
                    "needs_review": False,
                    "sleeper_verified": True,
                },
                edited_by_sub="system:sleeper",
                note="Sleeper transaction matched",
            )
            upgraded += 1
        elif key in waiver_keys and row.get("cap_hit") == 1:
            storage.update_league_contract_row(
                int(row["id"]),
                {
                    "acquisition_type": "waiver",
                    "confidence": "sleeper_confirmed",
                    "sleeper_verified": True,
                },
                edited_by_sub="system:sleeper",
                note="Sleeper waiver matched",
            )
            upgraded += 1

    return {
        "season_year": season_year,
        "transactions_scanned": len(txs),
        "events_upgraded": upgraded,
        "movement_count": len(events),
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
