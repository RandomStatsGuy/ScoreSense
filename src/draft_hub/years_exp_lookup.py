"""Look up NFL years_exp for hub roster rows (Sleeper cache)."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from src.integrations.sleeper import load_sleeper_players, players_dataframe


@lru_cache(maxsize=1)
def _exp_indexes() -> tuple[dict[str, int], dict[str, int]]:
    """Return (by_sleeper_id, by_gsis_id) years_exp maps."""
    by_sleeper: dict[str, int] = {}
    by_gsis: dict[str, int] = {}
    raw = load_sleeper_players()
    for sid, info in (raw or {}).items():
        if not info:
            continue
        try:
            exp = int(info.get("years_exp"))
        except (TypeError, ValueError):
            continue
        if exp < 0:
            continue
        by_sleeper[str(sid)] = exp
        gsis = str(info.get("gsis_id") or "").strip()
        if gsis.startswith("00-"):
            by_gsis[gsis] = exp
    return by_sleeper, by_gsis


def clear_years_exp_cache() -> None:
    _exp_indexes.cache_clear()


def years_exp_for_player(
    *,
    sleeper_player_id: str | None = None,
    player_id: str | None = None,
    row: dict[str, Any] | None = None,
) -> int | None:
    """Best-effort NFL experience for a hub player."""
    if row:
        sleeper_player_id = sleeper_player_id or row.get("sleeper_player_id")
        player_id = player_id or row.get("player_id")
        contract = row.get("contract") or {}
        if contract.get("years_exp") is not None:
            try:
                return max(0, int(contract["years_exp"]))
            except (TypeError, ValueError):
                pass
        if row.get("years_exp") is not None:
            try:
                return max(0, int(row["years_exp"]))
            except (TypeError, ValueError):
                pass

    by_sleeper, by_gsis = _exp_indexes()
    if sleeper_player_id and str(sleeper_player_id) in by_sleeper:
        return by_sleeper[str(sleeper_player_id)]
    pid = str(player_id or "")
    if pid.startswith("00-") and pid in by_gsis:
        return by_gsis[pid]
    if pid.startswith("sleeper-"):
        sid = pid.removeprefix("sleeper-")
        if sid in by_sleeper:
            return by_sleeper[sid]
    return None


def years_exp_from_players_df_row(row: Any) -> int | None:
    try:
        if row is None:
            return None
        val = row.get("years_exp") if hasattr(row, "get") else None
        if val is None:
            return None
        return max(0, int(val))
    except (TypeError, ValueError):
        return None
