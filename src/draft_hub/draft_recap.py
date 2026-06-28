"""Fun post-draft recap from auction win events."""

from __future__ import annotations

from typing import Any

from src.draft_hub import storage

STEAL_GRADES = frozenset({"steal", "great_value"})
REACH_GRADES = frozenset({"reach", "major_reach", "slight_reach"})


def _pick_rows(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for ev in events:
        if ev.get("event_type") != "win":
            continue
        p = ev.get("payload") or {}
        amount = float(p.get("amount") or 0)
        if amount <= 0:
            continue
        fair_raw = p.get("fair_value")
        fair = float(fair_raw) if fair_raw is not None else None
        ratio = (fair / amount) if fair is not None and amount > 0 else None
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
            }
        )
    return rows


def _headline(picks: list[dict[str, Any]], *, test_mode: bool) -> str:
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


def _subheadline(picks: list[dict[str, Any]], overview: dict[str, Any] | None) -> str:
    total = sum(p["amount"] for p in picks)
    parts = [f"{len(picks)} player{'s' if len(picks) != 1 else ''} drafted", f"${total:.0f} spent league-wide"]
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

    events = storage.list_draft_events(league_id, limit=500)
    picks = _pick_rows(events)
    if not picks:
        return None

    test_mode = storage.league_test_mode(league_id)
    awards = [
        a
        for a in (
            _award_steal(picks),
            _award_reach(picks),
            _award_splash(picks),
            _award_coupon_clipper(picks),
            _award_tightwad(overview),
            _award_spender(overview),
            _award_position_obsessed(picks, overview),
        )
        if a
    ]

    return {
        "headline": _headline(picks, test_mode=test_mode),
        "subheadline": _subheadline(picks, overview),
        "test_mode": test_mode,
        "pick_count": len(picks),
        "total_spent": round(sum(p["amount"] for p in picks), 2),
        "awards": awards,
        "notable_picks": _notable_picks(picks),
        "completed_at": session.get("completed_at"),
    }
