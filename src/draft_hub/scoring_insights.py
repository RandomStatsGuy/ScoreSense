"""Fun scoring superlatives from Sleeper weekly matchups."""

from __future__ import annotations

import statistics
from collections import defaultdict
from typing import Any


def _award(
    award_id: str,
    *,
    title: str,
    headline: str,
    roast: str | None = None,
    team_name: str | None = None,
    owner_id: str | None = None,
    amount: float | None = None,
    detail: str | None = None,
    tone: str = "neutral",
    owner_map: dict[str, str] | None = None,
    sleeper_owner_map: dict[str, str] | None = None,
    year_specific: bool = False,
) -> dict[str, Any]:
    from src.draft_hub.owner_display import enrich_award_display, lookup_owner_label

    owner_label = lookup_owner_label(
        team_name,
        owner_map,
        sleeper_user_id=owner_id,
        sleeper_owner_map=sleeper_owner_map,
    )
    base = {
        "id": award_id,
        "title": title,
        "headline": headline,
        "roast": roast,
        "amount": round(amount, 2) if amount is not None else None,
        "detail": detail,
        "tone": tone,
    }
    return enrich_award_display(
        base,
        team_name=team_name,
        owner_label=owner_label,
        owner_map=owner_map,
        sleeper_owner_map=sleeper_owner_map,
        sleeper_user_id=owner_id,
        year_specific=year_specific,
    )


def _scoring_display_season(scoring: dict[str, Any]) -> str:
    """Prefer the season the user requested over Sleeper league metadata."""
    return str(scoring.get("requested_season") or scoring.get("season") or "")


def build_scoring_awards(
    scoring: dict[str, Any],
    *,
    efficiency: dict[str, Any] | None = None,
    owner_map: dict[str, str] | None = None,
    sleeper_owner_map: dict[str, str] | None = None,
    planning_season: str | None = None,
) -> list[dict[str, Any]]:
    """Team-level scoring awards for the Insights scoring tab."""
    if not scoring.get("available") or scoring.get("preseason"):
        return []

    standings = scoring.get("standings") or []
    weeks = [wk for wk in (scoring.get("weeks") or []) if not wk.get("is_playoff")]
    if not standings:
        return []

    from src.draft_hub.owner_display import scoring_year_specific

    season = _scoring_display_season(scoring)
    year_specific = scoring_year_specific(season, str(planning_season or ""))
    awards: list[dict[str, Any]] = []

    league_avg = 0.0
    if standings:
        league_avg = sum(float(t.get("avg_points") or 0) for t in standings) / len(standings)

    leader = standings[0]
    awards.append(
        _award(
            "points_king",
            title="Point Hoarder",
            headline=f"{leader['total_points']} pts — league-high output",
            roast="The rest of the league is filing a complaint.",
            team_name=leader["team_name"],
            owner_id=leader.get("owner_id"),
            amount=leader["total_points"],
            detail=f"{season} · {leader.get('avg_points', 0)} avg · {leader.get('weeks_scored', 0)} weeks",
            tone="gold",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
        )
    )

    if len(standings) > 1:
        basement = standings[-1]
        gap = round(float(leader["total_points"]) - float(basement["total_points"]), 1)
        awards.append(
            _award(
                "basement",
                title="Tank Commander",
                headline=f"{gap} pts behind 1st place",
                roast="The rebuild is going great. Trust the process.",
                team_name=basement["team_name"],
                owner_id=basement.get("owner_id"),
                amount=basement["total_points"],
                detail=f"{basement['total_points']} total pts · dead last",
                tone="bad",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
            )
        )

    week_scores: list[tuple[float, str, int, str]] = []
    weekly_gaps: list[tuple[float, int, str, str, str, str]] = []
    weekly_second: list[tuple[str, int]] = []
    team_to_owner_id: dict[str, str] = {}
    for wk in weeks:
        for row in wk.get("teams") or []:
            tname = str(row.get("team_name") or "")
            oid = str(row.get("owner_id") or "")
            if tname and oid:
                team_to_owner_id[tname] = oid

    for wk in weeks:
        teams = wk.get("teams") or []
        scored = sorted(
            (
                (
                    float(t.get("points") or 0),
                    t["team_name"],
                    str(t.get("owner_id") or team_to_owner_id.get(t["team_name"], "")),
                )
                for t in teams
                if float(t.get("points") or 0) > 0
            ),
            key=lambda x: x[0],
            reverse=True,
        )
        for pts, team_name, owner_id in scored:
            week_scores.append((pts, team_name, int(wk["week"]), owner_id))
        if len(scored) >= 2:
            top_pts, top_team, top_oid = scored[0]
            second_pts, second_team, second_oid = scored[1]
            gap = top_pts - second_pts
            if gap > 0.05:
                weekly_gaps.append((gap, int(wk["week"]), top_team, second_team, top_oid, second_oid))
                weekly_second.append((second_team, int(wk["week"])))

    if week_scores:
        boom_pts, boom_team, boom_week, boom_oid = max(week_scores, key=lambda x: x[0])
        awards.append(
            _award(
                "weekly_nuke",
                title="Nuclear Week",
                headline=f"{boom_pts} pts in week {boom_week}",
                roast="That wasn't a lineup. That was a war crime.",
                team_name=boom_team,
                owner_id=boom_oid or None,
                amount=boom_pts,
                detail="Highest single-week score in the league",
                tone="gold",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
            )
        )
        bust_pts, bust_team, bust_week, bust_oid = min(week_scores, key=lambda x: x[0])
        awards.append(
            _award(
                "weekly_disaster",
                title="Postmortem Week",
                headline=f"{bust_pts} pts in week {bust_week}",
                roast="Commissioner should've sent a wellness check.",
                team_name=bust_team,
                owner_id=bust_oid or None,
                amount=bust_pts,
                detail="Lowest single-week score in the league",
                tone="bad",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
            )
        )

    if weekly_gaps:
        margin, week_num, winner, _runner_up, winner_oid, _ = max(weekly_gaps, key=lambda x: x[0])
        awards.append(
            _award(
                "margin_massacre",
                title="Public Humiliation",
                headline=f"+{margin:.1f} pts in week {week_num}",
                roast="Second place wasn't close. It was theoretical.",
                team_name=winner,
                owner_id=winner_oid or None,
                amount=margin,
                detail="Biggest weekly gap over the runner-up",
                tone="gold",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
            )
        )
        nail, nail_week, nail_winner, _, nail_oid, _ = min(weekly_gaps, key=lambda x: x[0])
        awards.append(
            _award(
                "nail_biter",
                title="Photo Finish",
                headline=f"Won week {nail_week} by {nail:.1f} pts",
                roast="One bad snap away from group chat chaos.",
                team_name=nail_winner,
                owner_id=nail_oid or None,
                amount=nail,
                detail="Closest weekly margin at the top",
                tone="good",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
            )
        )

    bridesmaid_counts: dict[str, int] = defaultdict(int)
    for team_name, _wk in weekly_second:
        bridesmaid_counts[team_name] += 1
    if bridesmaid_counts:
        bridesmaid_team, bridesmaid_count = max(bridesmaid_counts.items(), key=lambda x: x[1])
        if bridesmaid_count >= 2:
            awards.append(
                _award(
                    "always_runner_up",
                    title="Permanent Bridesmaid",
                    headline=f"{bridesmaid_count} weeks in 2nd",
                    roast="Always bridesmaid, never the weekly bully.",
                    team_name=bridesmaid_team,
                    owner_id=team_to_owner_id.get(bridesmaid_team) or None,
                    amount=float(bridesmaid_count),
                    detail="Most runner-up weekly finishes",
                    tone="bad",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
                )
            )

    team_series: dict[str, list[float]] = defaultdict(list)
    for wk in weeks:
        for row in wk.get("teams") or []:
            pts = float(row.get("points") or 0)
            if pts > 0:
                team_series[row["team_name"]].append(pts)

    consistency: list[tuple[float, str, float]] = []
    for name, pts in team_series.items():
        if len(pts) >= 3:
            consistency.append((statistics.pstdev(pts), name, sum(pts) / len(pts)))
    if consistency:
        stdev, name, avg = min(consistency, key=lambda x: x[0])
        awards.append(
            _award(
                "steady_eddie",
                title="Robot Manager",
                headline=f"{avg:.1f} avg · σ {stdev:.1f}",
                roast="No spikes. No soul. Just points.",
                team_name=name,
                owner_id=team_to_owner_id.get(name) or None,
                amount=avg,
                detail="Most consistent weekly scoring",
                tone="good",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
            )
        )
        stdev, name, avg = max(consistency, key=lambda x: x[0])
        awards.append(
            _award(
                "rollercoaster",
                title="Chaos Merchant",
                headline=f"{avg:.1f} avg · σ {stdev:.1f}",
                roast="Your league chat never knows which version shows up.",
                team_name=name,
                owner_id=team_to_owner_id.get(name) or None,
                amount=stdev,
                detail="Wildest week-to-week swings",
                tone="bad",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
            )
        )

    swing_gaps: list[tuple[float, str, float, float]] = []
    for name, pts in team_series.items():
        if len(pts) >= 2:
            swing_gaps.append((max(pts) - min(pts), name, max(pts), min(pts)))
    if swing_gaps:
        swing, name, peak, floor = max(swing_gaps, key=lambda x: x[0])
        awards.append(
            _award(
                "floor_collapse",
                title="Jekyll & Hyde",
                headline=f"{swing:.1f} pt spread · {peak:.0f} peak / {floor:.0f} floor",
                roast="Same manager. Completely different team.",
                team_name=name,
                owner_id=team_to_owner_id.get(name) or None,
                amount=swing,
                detail="Biggest gap between best and worst week",
                tone="bad",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
            )
        )

    if league_avg > 0:
        mid_team = min(
            standings,
            key=lambda t: abs(float(t.get("avg_points") or 0) - league_avg),
        )
        awards.append(
            _award(
                "participation_trophy",
                title="Statistically Mid",
                headline=f"{mid_team.get('avg_points', 0)} avg · league avg {league_avg:.1f}",
                roast="Not bad. Not good. Just… there.",
                team_name=mid_team["team_name"],
                owner_id=mid_team.get("owner_id"),
                amount=float(mid_team.get("avg_points") or 0),
                detail="Closest to the league scoring average",
                tone="neutral",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
            )
        )

    week_wins: dict[str, int] = defaultdict(int)
    week_win_owner: dict[str, str] = {}
    for wk in weeks:
        teams = wk.get("teams") or []
        scored = [t for t in teams if float(t.get("points") or 0) > 0]
        if not scored:
            continue
        top = max(scored, key=lambda t: float(t.get("points") or 0))
        tname = top["team_name"]
        week_wins[tname] += 1
        oid = str(top.get("owner_id") or "")
        if oid:
            week_win_owner[tname] = oid
    if week_wins:
        wire_team, wire_count = max(week_wins.items(), key=lambda x: x[1])
        awards.append(
            _award(
                "wire_to_wire",
                title="Weekly Dictator",
                headline=f"{wire_count} week{'s' if wire_count != 1 else ''} on top",
                roast="Owned the scoreboard like it owed them money.",
                team_name=wire_team,
                owner_id=week_win_owner.get(wire_team) or team_to_owner_id.get(wire_team) or None,
                amount=float(wire_count),
                detail="Most weeks with the league-high score",
                tone="good",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
            )
        )

    if efficiency and efficiency.get("available"):
        teams = efficiency.get("teams") or []
        if teams:
            best = teams[0]
            worst = teams[-1]
            if best.get("points_per_dollar"):
                awards.append(
                    _award(
                        "cap_efficiency_goat",
                        title="Cap Criminal (Legal)",
                        headline=f"{best['points_per_dollar']} pts/$",
                        roast="Paid like a genius. Scored like one too.",
                        team_name=best["team_name"],
                        amount=best.get("points_per_dollar"),
                        detail=f"{best.get('total_points', 0)} pts on {best.get('committed', 0)} committed",
                        tone="good",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
                    )
                )
            if worst.get("points_per_dollar") is not None and len(teams) > 1:
                awards.append(
                    _award(
                        "cap_efficiency_fraud",
                        title="Cap Malpractice",
                        headline=f"{worst['points_per_dollar']} pts/$",
                        roast="All that salary cap. For THIS output?",
                        team_name=worst["team_name"],
                        amount=worst.get("points_per_dollar"),
                        detail="Lowest points per committed dollar",
                        tone="bad",
                owner_map=owner_map,
                sleeper_owner_map=sleeper_owner_map,
                year_specific=year_specific,
                    )
                )

    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for award in awards:
        if award["id"] in seen:
            continue
        seen.add(award["id"])
        out.append(award)
    return out
