"""League lifecycle rules, independent of Home aggregation and predictions."""
from __future__ import annotations

from typing import Any

PHASE_PRE_DRAFT = "pre_draft"
PHASE_LIVE_DRAFT = "live_draft"
PHASE_IN_SEASON = "in_season"
PHASE_OFFSEASON = "offseason"

_PHASE_LABELS = {
    PHASE_PRE_DRAFT: "Pre-draft",
    PHASE_LIVE_DRAFT: "Live draft",
    PHASE_IN_SEASON: "In season",
    PHASE_OFFSEASON: "Offseason",
}
_PRIMARY_CTA = {
    PHASE_PRE_DRAFT: {"view": "value", "label": "Draft plan"},
    PHASE_LIVE_DRAFT: {"view": "room", "label": "Live draft"},
    PHASE_IN_SEASON: {"view": "week", "label": "Your Week"},
    PHASE_OFFSEASON: {"view": "roster", "label": "Roster & cap"},
}


def resolve_league_phase(
    *,
    draft_completed: bool,
    league_status: str | None,
    draft_session_status: str | None,
    nfl_season_type: str | None = None,
) -> dict[str, Any]:
    """Resolve already-read lifecycle inputs without accessing external data."""
    session = str(draft_session_status or "").lower()
    league = str(league_status or "").lower()
    nfl = str(nfl_season_type or "off").lower()
    if draft_completed:
        # Completion wins over a leftover live session/status.
        phase_id = PHASE_IN_SEASON if nfl == "regular" else PHASE_OFFSEASON
    elif session in {"nominating", "bidding", "picking"} or league == "live":
        phase_id = PHASE_LIVE_DRAFT
    else:
        phase_id = PHASE_PRE_DRAFT
    return {
        "id": phase_id,
        "label": _PHASE_LABELS[phase_id],
        "nfl_season_type": nfl,
        "league_status": league or None,
        "draft_session_status": session or None,
        "draft_completed": bool(draft_completed),
        "primary_cta": dict(_PRIMARY_CTA[phase_id]),
    }
