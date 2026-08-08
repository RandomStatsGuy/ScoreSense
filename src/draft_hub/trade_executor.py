"""Execute cross-team trades in a shared league workspace."""

from __future__ import annotations

from typing import Any

# Multi-party propose/accept lives in trade_proposals; keep this module as the
# stable import path for the classic 2-team execute API.
from src.draft_hub.trade_proposals import (  # noqa: F401
    execute_league_trade,
    execute_multiparty_trade,
    validate_trade_package,
)


def execute_league_trade_legacy_soft(
    league_id: str,
    *,
    team_a_id: str,
    team_b_id: str,
    send_a: list[str],
    send_b: list[str],
) -> dict[str, Any]:
    """Deprecated alias — hard validation is now the default."""
    return execute_league_trade(
        league_id,
        team_a_id=team_a_id,
        team_b_id=team_b_id,
        send_a=send_a,
        send_b=send_b,
    )
