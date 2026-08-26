"""Fun post-draft recap from auction win events."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage
from src.draft_hub.contracts import schedule_preview
from src.draft_hub.pick_draft import draft_type_of, is_pick_draft
from src.draft_hub.rules_engine import salary_roster_limits_relaxed
from src.draft_hub.schemas import LeagueRules

STEAL_GRADES = frozenset({"steal", "great_value"})
REACH_GRADES = frozenset({"reach", "major_reach", "slight_reach"})


def _opt_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _opt_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _pick_rows(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for ev in events:
        kind = ev.get("event_type")
        if kind not in ("win", "pick"):
            continue
        p = ev.get("payload") or {}
        amount = float(p.get("amount") or 0)
        if kind == "win" and amount <= 0:
            continue
        fair_raw = p.get("fair_value")
        fair = float(fair_raw) if fair_raw is not None else None
        ratio = (fair / amount) if fair is not None and amount > 0 else None
        season_proj = _opt_float(p.get("season_proj"))
        season_p10 = _opt_float(p.get("season_p10"))
        season_p50 = _opt_float(p.get("season_p50"))
        season_p90 = _opt_float(p.get("season_p90"))
        rows.append(
            {
                "team_id": str(p.get("team_id") or ""),
                "team_name": p.get("team_name") or "Team",
                "player_id": p.get("player_id"),
                "player_name": p.get("player_name") or "Player",
                "position": p.get("position") or "?",
                "amount": round(amount, 2),
                "fair_value": round(fair, 2) if fair is not None else None,
                "value_grade": p.get("value_grade") or "pick",
                "value_blurb": p.get("value_blurb"),
                "ratio": round(ratio, 3) if ratio is not None else None,
                "overall": _opt_int(p.get("overall")),
                "round": _opt_int(p.get("round")),
                "slot": _opt_int(p.get("slot")),
                "season_proj": round(season_proj, 1) if season_proj is not None else None,
                "season_p10": round(season_p10, 1) if season_p10 is not None else None,
                "season_p50": round(season_p50, 1) if season_p50 is not None else None,
                "season_p90": round(season_p90, 1) if season_p90 is not None else None,
            }
        )
    return rows


def _headline(picks: list[dict[str, Any]], *, test_mode: bool, pick_draft: bool = False, draft_type: str = "auction") -> str:
    if pick_draft:
        if draft_type == "linear":
            return "Linear draft in the books."
        return "Snake draft in the books."
    if not picks:
        return "Draft in the books."
    steals = sum(1 for p in picks if p["value_grade"] in STEAL_GRADES)
    reaches = sum(1 for p in picks if p["value_grade"] in REACH_GRADES)
    n = len(picks)
    steal_pct = steals / n
    reach_pct = reaches / n
    if test_mode and steals >= 2:
        return "Practice run complete — the bots donated some salary."
    if steal_pct >= 0.35:
        return "Managers hunted bargains all night."
    if reach_pct >= 0.35:
        return "Premium prices ruled the room."
    if steals == 0 and reaches == 0:
        return "A surprisingly disciplined auction."
    return "Another chaotic auction in the books."


def _subheadline(picks: list[dict[str, Any]], overview: dict[str, Any] | None, *, pick_draft: bool = False) -> str:
    parts = [f"{len(picks)} player{'s' if len(picks) != 1 else ''} drafted"]
    if not pick_draft:
        total = sum(p["amount"] for p in picks)
        parts.append(f"${total:.0f} spent league-wide")
        if overview:
            teams = overview.get("teams") or []
            if teams:
                left = sum(float(t.get("cap_remaining") or 0) for t in teams)
                parts.append(f"${left:.0f} left on the table")
    return " · ".join(parts)


def _award_steal(picks: list[dict[str, Any]]) -> dict[str, Any] | None:
    graded = [p for p in picks if p.get("ratio") is not None and p["value_grade"] in STEAL_GRADES]
    if not graded:
        graded = [p for p in picks if p.get("ratio") is not None]
    if not graded:
        return None
    best = max(graded, key=lambda p: p["ratio"] or 0)
    return {
        "id": "steal_of_draft",
        "title": "Steal of the draft",
        "emoji": "🎯",
        "team_name": best["team_name"],
        "player_name": best["player_name"],
        "detail": f"${best['amount']:.0f} · fair ${best['fair_value']:.0f}",
        "blurb": "The bid that aged like fine wine before the season even started.",
    }


def _award_reach(picks: list[dict[str, Any]]) -> dict[str, Any] | None:
    graded = [p for p in picks if p.get("ratio") is not None and p["value_grade"] in REACH_GRADES]
    if not graded:
        return None
    worst = min(graded, key=lambda p: p["ratio"] or 999)
    return {
        "id": "reach_of_draft",
        "title": "Reach for the stars",
        "emoji": "🚀",
        "team_name": worst["team_name"],
        "player_name": worst["player_name"],
        "detail": f"${worst['amount']:.0f} · fair ${worst['fair_value']:.0f}",
        "blurb": "Bold move — hope the projection catches the invoice.",
    }


def _award_splash(picks: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not picks:
        return None
    top = max(picks, key=lambda p: p["amount"])
    return {
        "id": "big_splash",
        "title": "Biggest splash",
        "emoji": "💸",
        "team_name": top["team_name"],
        "player_name": top["player_name"],
        "detail": f"${top['amount']:.0f} on {top['position']}",
        "blurb": "When you want the room to know you mean business.",
    }


def _award_coupon_clipper(picks: list[dict[str, Any]]) -> dict[str, Any] | None:
    by_team: dict[str, dict[str, Any]] = {}
    for p in picks:
        tid = p["team_id"]
        if not tid:
            continue
        bucket = by_team.setdefault(tid, {"team_name": p["team_name"], "steals": 0, "saved": 0.0})
        if p["value_grade"] in STEAL_GRADES and p.get("fair_value") is not None:
            bucket["steals"] += 1
            bucket["saved"] += max(0.0, p["fair_value"] - p["amount"])
    ranked = [b for b in by_team.values() if b["steals"] > 0]
    if not ranked:
        return None
    best = max(ranked, key=lambda b: (b["steals"], b["saved"]))
    return {
        "id": "coupon_clipper",
        "title": "Coupon clipper",
        "emoji": "✂️",
        "team_name": best["team_name"],
        "player_name": None,
        "detail": f"{best['steals']} value buys · ~${best['saved']:.0f} under fair",
        "blurb": "Someone read the price tags before the room did.",
    }


def _award_tightwad(overview: dict[str, Any] | None) -> dict[str, Any] | None:
    if not overview:
        return None
    teams = overview.get("teams") or []
    if not teams:
        return None
    best = max(teams, key=lambda t: float(t.get("cap_remaining") or 0))
    left = float(best.get("cap_remaining") or 0)
    if left < 5:
        return None
    team = best.get("team") or {}
    return {
        "id": "tightwad",
        "title": "Cap hoarder",
        "emoji": "🐷",
        "team_name": team.get("name") or "Team",
        "player_name": None,
        "detail": f"${left:.0f} unspent",
        "blurb": "Saving dry powder — or just couldn't pull the trigger?",
    }


def _award_spender(overview: dict[str, Any] | None) -> dict[str, Any] | None:
    if not overview:
        return None
    teams = overview.get("teams") or []
    if not teams:
        return None
    best = min(teams, key=lambda t: float(t.get("cap_remaining") or 0))
    left = float(best.get("cap_remaining") or 0)
    team = best.get("team") or {}
    spent = float(overview.get("salary_cap") or 200) - left
    return {
        "id": "empty_wallet",
        "title": "All-in builder",
        "emoji": "🔥",
        "team_name": team.get("name") or "Team",
        "player_name": None,
        "detail": f"${spent:.0f} committed · ${left:.0f} left",
        "blurb": "Roster construction via maximum velocity spending.",
    }


def _award_position_obsessed(picks: list[dict[str, Any]], overview: dict[str, Any] | None) -> dict[str, Any] | None:
    if not overview:
        return None
    cap = float(overview.get("salary_cap") or 200)
    best_team = None
    best_pos = None
    best_pct = 0.0
    for block in overview.get("teams") or []:
        team = block.get("team") or {}
        spend: dict[str, float] = {}
        for row in block.get("roster") or []:
            pos = str(row.get("position") or "").upper()
            spend[pos] = spend.get(pos, 0.0) + float(row.get("salary") or 0)
        for pos, val in spend.items():
            pct = val / cap if cap else 0
            if pct > best_pct and val >= 20:
                best_pct = pct
                best_team = team.get("name")
                best_pos = pos
    if not best_team or not best_pos or best_pct < 0.25:
        return None
    return {
        "id": "position_obsessed",
        "title": f"{best_pos} enthusiast",
        "emoji": "📣",
        "team_name": best_team,
        "player_name": None,
        "detail": f"{round(best_pct * 100)}% of cap on {best_pos}",
        "blurb": "They had a type and they stuck to it.",
    }


def _notable_picks(picks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    steals = sorted(
        [p for p in picks if p.get("ratio") is not None],
        key=lambda p: p["ratio"] or 0,
        reverse=True,
    )[:4]
    reaches = sorted(
        [p for p in picks if p.get("ratio") is not None and p["value_grade"] in REACH_GRADES],
        key=lambda p: p["ratio"] or 999,
    )[:3]
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in steals + reaches:
        key = f"{row['player_id']}:{row['team_id']}"
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    return out[:7]


def build_owner_draft_report(
    league_id: str,
    team_id: str,
    *,
    roster: list[dict[str, Any]] | None = None,
    budget_remaining: float | None = None,
) -> dict[str, Any] | None:
    """Per-owner post-draft breakdown: picks, grades, spend by position."""
    events = storage.list_draft_result_events(league_id)
    picks = [p for p in _pick_rows(events) if str(p.get("team_id")) == str(team_id)]
    if not picks:
        return None

    roster_by_id = {str(r.get("player_id")): r for r in (roster or []) if r.get("player_id")}
    rows: list[dict[str, Any]] = []
    for p in picks:
        slot = roster_by_id.get(str(p.get("player_id")) or "")
        contract = (slot or {}).get("contract") or {}
        ctype = str(contract.get("contract_type") or "")
        years = int(contract.get("years_remaining") or (slot or {}).get("contract_years") or 2)
        step = float(contract.get("step_up_per_year") or 0)
        rows.append(
            {
                **p,
                "contract_years": years,
                "contract_type": ctype or None,
                "step_up_per_year": step,
                "salary_schedule": schedule_preview(contract) if contract else [],
                "salary": float(slot.get("salary") if slot and slot.get("salary") is not None else p["amount"]),
            }
        )

    by_pos: dict[str, dict[str, Any]] = {}
    for r in rows:
        pos = str(r.get("position") or "?").upper()
        bucket = by_pos.setdefault(pos, {"position": pos, "count": 0, "spent": 0.0})
        bucket["count"] += 1
        bucket["spent"] = round(bucket["spent"] + float(r.get("amount") or 0), 2)

    total_spent = round(sum(float(r.get("amount") or 0) for r in rows), 2)
    steals = sum(1 for r in rows if r.get("value_grade") in STEAL_GRADES)
    reaches = sum(1 for r in rows if r.get("value_grade") in REACH_GRADES)
    league = storage.get_league(league_id) or {}
    try:
        rules = LeagueRules.model_validate(league.get("rules") or {})
    except Exception:
        rules = None
    pick_draft = bool(rules and is_pick_draft(rules))
    dtype = draft_type_of(rules) if rules else "auction"
    return {
        "team_id": str(team_id),
        "pick_count": len(rows),
        "total_spent": total_spent,
        "budget_remaining": budget_remaining,
        "steals": steals,
        "reaches": reaches,
        "by_position": sorted(by_pos.values(), key=lambda b: (-b["spent"], b["position"])),
        "picks": rows,
        "pick_draft": pick_draft,
        "draft_type": dtype,
    }


def build_draft_recap(
    league_id: str,
    *,
    overview: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    league = storage.get_league(league_id)
    if not league:
        return None
    session = storage.get_draft_session(league_id) or {}
    draft_completed = bool(league.get("draft_completed")) or session.get("status") == "completed"
    if not draft_completed:
        return None

    events = storage.list_draft_result_events(league_id)
    picks = _pick_rows(events)
    if not picks:
        return None

    test_mode = storage.league_test_mode(league_id)
    try:
        rules = LeagueRules.model_validate(league.get("rules") or {})
    except Exception:
        rules = None
    limits_relaxed = bool(rules and salary_roster_limits_relaxed(rules))
    pick_draft = bool(rules and is_pick_draft(rules))
    dtype = draft_type_of(rules) if rules else "auction"
    rostered = 0
    if overview:
        for block in overview.get("teams") or []:
            rostered += len(block.get("roster") or [])

    if pick_draft and rules is not None:
        from src.draft_hub.pick_draft_outcomes import build_pick_draft_recap

        extras = build_pick_draft_recap(
            league_id=league_id,
            picks=picks,
            overview=overview,
            rules=rules,
            draft_type=dtype,
            season=int(league.get("season") or 2026),
        )
        return {
            "headline": _headline(picks, test_mode=test_mode, pick_draft=True, draft_type=dtype),
            "subheadline": _subheadline(picks, overview, pick_draft=True),
            "draft_type": dtype,
            "pick_draft": True,
            "test_mode": test_mode,
            "pick_count": len(picks),
            "total_spent": 0,
            "awards": extras.get("awards") or [],
            "notable_picks": extras.get("notable_picks") or picks[:8],
            "projected_standings": extras.get("projected_standings") or [],
            "team_insights": extras.get("team_insights") or [],
            "record_games": extras.get("record_games"),
            "nfl_games": extras.get("nfl_games"),
            "methodology": extras.get("methodology"),
            "outcome_note": extras.get("outcome_note"),
            "approximation": True,
            "n_sims": extras.get("n_sims"),
            "playoff_spots": extras.get("playoff_spots"),
            "completed_at": session.get("completed_at"),
            "limits_relaxed": limits_relaxed,
            "scopes": {
                "this_mock": {
                    "label": "This mock",
                    "pick_count": len(picks),
                },
                "league_wide": {
                    "label": "League-wide",
                    "pick_count": len(picks),
                    "rostered_count": rostered,
                },
            },
        }

    cap_awards = () if limits_relaxed else (
        _award_tightwad(overview),
        _award_spender(overview),
        _award_position_obsessed(picks, overview),
    )
    awards = [
        a
        for a in (
            _award_steal(picks),
            _award_reach(picks),
            _award_splash(picks),
            _award_coupon_clipper(picks),
            *cap_awards,
        )
        if a
    ]

    return {
        "headline": _headline(picks, test_mode=test_mode, pick_draft=False, draft_type=dtype),
        "subheadline": _subheadline(picks, overview, pick_draft=False),
        "draft_type": dtype,
        "pick_draft": False,
        "test_mode": test_mode,
        "pick_count": len(picks),
        "total_spent": round(sum(p["amount"] for p in picks), 2),
        "awards": awards,
        "notable_picks": _notable_picks(picks),
        "completed_at": session.get("completed_at"),
        "limits_relaxed": limits_relaxed,
        "scopes": {
            "this_mock": {
                "label": "This mock",
                "auction_wins": len(picks),
                "total_spent": round(sum(p["amount"] for p in picks), 2),
            },
            "full_keeper_roster": {
                "label": "Full keeper roster",
                "note": (
                    "Hypothetical full-roster exposure — salary limits are off"
                    if limits_relaxed
                    else "Keepers, dead cap, and auction wins"
                ),
            },
            "league_wide": {
                "label": "League-wide",
                "auction_wins": len(picks),
                "rostered_count": rostered,
            },
        },
    }
