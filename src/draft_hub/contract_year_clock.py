"""Persist contract year tick when a league marks the draft completed.

SCORE-45: delegates to ``contract_service`` so expired deals are archived
(status + as_of + snapshot) instead of deleted, and all tick/reset writes
share one contract write path.
"""

from __future__ import annotations

from src.draft_hub.contract_service import (  # noqa: F401
    rewind_contracts_on_draft_reset,
    tick_contracts_on_draft_complete,
)

__all__ = [
    "tick_contracts_on_draft_complete",
    "rewind_contracts_on_draft_reset",
]
