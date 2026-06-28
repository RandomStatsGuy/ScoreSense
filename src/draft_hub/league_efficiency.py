"""Salary vs fantasy output — points per committed cap dollar."""

from __future__ import annotations

from typing import Any


def _hub_team_names(overview: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for block in overview.get("teams") or []:
        name = str((block.get("team") or {}).get("name") or "").strip()
        if name:
            names.append(name)
    return names


def resolve_hub_team_name(contract_name: str, hub_names: list[str]) -> str:
    """Map commissioner-sheet labels onto linked hub / Sleeper team names."""
    name = str(contract_name or "").strip()
    if not name or not hub_names:
        return name
    if name in hub_names:
        return name
    lower = name.lower()
    for hub in hub_names:
        if hub.lower() == lower:
            return hub
    for hub in hub_names:
        hub_lower = hub.lower()
        if lower in hub_lower or hub_lower in lower:
            return hub
    return name


def align_contract_analytics_to_hub_teams(
    analytics: dict[str, Any],
    overview: dict[str, Any],
) -> dict[str, Any]:
    """Rename contract-sheet teams to hub team names for Sleeper joins."""
    hub_names = _hub_team_names(overview)
    teams: list[dict[str, Any]] = []
    for team in analytics.get("teams") or []:
        resolved = resolve_hub_team_name(str(team.get("team_name") or ""), hub_names)
        teams.append({**team, "team_name": resolved, "team_id": team.get("team_id") or resolved})
    return {**analytics, "teams": teams}


def _match_standing(team_name: str, standings: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if team_name in standings:
        return standings[team_name]
    lower = team_name.lower()
    for key, row in standings.items():
        if key.lower() == lower:
            return row
    for key, row in standings.items():
        key_lower = key.lower()
        if lower in key_lower or key_lower in lower:
            return row
    return {}


def build_cap_efficiency(
    analytics: dict[str, Any],
    scoring: dict[str, Any],
    *,
    owner_map: dict[str, str] | None = None,
    year_specific: bool = False,
) -> dict[str, Any]:
    """Rank teams by Sleeper fantasy points per committed salary cap dollar."""
    from src.draft_hub.owner_display import enrich_team_row

    if not scoring.get("available"):
        return {
            "available": False,
            "reason": scoring.get("reason") or "no_scoring",
            "hint": scoring.get("hint") or "Link Sleeper and refresh scoring to see cap efficiency.",
            "teams": [],
        }

    standings = {
        str(s.get("team_name") or ""): s for s in (scoring.get("standings") or [])
    }
    teams_out: list[dict[str, Any]] = []

    for t in analytics.get("teams") or []:
        name = str(t.get("team_name") or "")
        st = _match_standing(name, standings)
        committed = float(t.get("committed") or 0)
        dead = float(t.get("dead_cap") or 0)
        total_pts = float(st.get("total_points") or 0)
        avg_pts = float(st.get("avg_points") or 0)
        weeks = int(st.get("weeks_scored") or 0)

        ppd = round(total_pts / committed, 3) if committed > 0 else None
        spend = t.get("spend_by_position") or {}
        pos_spend = {k: float(v or 0) for k, v in spend.items()}
        top_pos = max(pos_spend, key=pos_spend.get) if pos_spend else None
        top_spend = pos_spend.get(top_pos or "", 0) if top_pos else 0
        pos_ppd = round(total_pts / top_spend, 3) if top_spend > 0 and total_pts > 0 else None

        teams_out.append(
            enrich_team_row(
                {
                    "team_id": t.get("team_id"),
                    "team_name": name,
                    "committed": round(committed, 2),
                    "dead_cap": round(dead, 2),
                    "total_points": round(total_pts, 2),
                    "avg_points": round(avg_pts, 2),
                    "weeks_scored": weeks,
                    "points_per_dollar": ppd,
                    "top_spend_position": top_pos,
                    "top_position_spend": round(top_spend, 2),
                    "top_position_pts_per_dollar": pos_ppd,
                },
                owner_map,
                year_specific=year_specific,
            )
        )

    ranked = sorted(
        teams_out,
        key=lambda r: (-(r["points_per_dollar"] or 0), -(r["total_points"] or 0)),
    )
    ppd_vals = [r["points_per_dollar"] for r in ranked if r["points_per_dollar"] is not None]
    league_avg = round(sum(ppd_vals) / len(ppd_vals), 3) if ppd_vals else None

    for idx, row in enumerate(ranked):
        row["efficiency_rank"] = idx + 1
        if league_avg and row["points_per_dollar"] is not None:
            row["vs_league_avg_pct"] = round(
                ((row["points_per_dollar"] / league_avg) - 1.0) * 100,
                1,
            )

    return {
        "available": True,
        "season": (
            scoring.get("requested_season")
            or scoring.get("season")
        ),
        "league_avg_points_per_dollar": league_avg,
        "teams": ranked,
    }
