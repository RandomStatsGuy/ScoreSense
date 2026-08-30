"""Starter-aware projected outcomes for snake / linear draft recaps.

Pick-draft recap contract (merged into ``build_draft_recap``):

{
  "draft_type": "snake" | "linear",
  "pick_draft": true,
  "pick_count": 192,
  "record_games": 14,
  "nfl_games": 17,
  "methodology": "...",
  "outcome_note": "...",
  "projected_standings": [
    {
      "team_id": "...",
      "team_name": "...",
      "rank": 1,
      "expected_wins": 9.1,
      "expected_losses": 4.9,
      "points_p10": 1320.4,
      "points_p50": 1488.2,
      "points_p90": 1660.1,
      "playoff_probability": 0.78,
      "projection_coverage": 0.94
    }
  ],
  "team_insights": [{"team_id": "...", "strengths": [...], "needs": [...], "awards": [...]}],
  "notable_picks": [...],
  "awards": [...]
}

Season ``points_p10`` / ``points_p50`` / ``points_p90`` are percentiles of
simulated starter-only fantasy points. They are not the sum of each player's
P10/P50/P90.

Expected wins come from a rotating head-to-head schedule over ``record_games``
weeks, using weekly samples scaled from season quantiles. This is not a
rank-bucket win percentage and does not treat bench players as starters.

Limitations (returned in ``methodology``): weeks are independent, byes and
injuries are not applied, and there is no real NFL opponent strength model.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from src.draft_hub.rules_engine import normalize_position, roster_limits
from src.draft_hub.schemas import LeagueRules

DEFAULT_RECORD_GAMES = 14
DEFAULT_NFL_GAMES = 17
DEFAULT_N_SIMS = 240
DEFAULT_PLAYOFF_TEAMS = 6
STARTER_FILL_ORDER = ("QB", "RB", "WR", "TE", "K", "DEF")
SKILL_POS = ("QB", "RB", "WR", "TE")

OUTCOME_NOTE = (
    "Floor / P10, Median / P50, and Ceiling / P90 are percentiles of simulated "
    "starter-only season points. They are not the sum of each player's P10/P50/P90."
)


def record_games_for_rules(rules: LeagueRules | None) -> int:
    raw = getattr(rules, "regular_season_games", None) if rules is not None else None
    if raw is None and isinstance(getattr(rules, "roster", None), dict):
        raw = None
    try:
        n = int(raw) if raw is not None else DEFAULT_RECORD_GAMES
    except (TypeError, ValueError):
        n = DEFAULT_RECORD_GAMES
    return max(1, min(n, 18))


def playoff_spots_for_league(team_count: int) -> int:
    n = max(2, int(team_count or 12))
    if n <= 8:
        return 4
    if n <= 10:
        return 4
    return min(DEFAULT_PLAYOFF_TEAMS, max(4, n // 2))


def _flex_rule(rules: LeagueRules) -> tuple[int, frozenset[str]]:
    raw = (rules.roster or {}).get("flex") or {}
    if not isinstance(raw, dict):
        return 0, frozenset({"RB", "WR", "TE"})
    starter = int(raw.get("starter") or 0)
    eligible = raw.get("eligible") or ["RB", "WR", "TE"]
    return starter, frozenset(normalize_position(p) for p in eligible)


def starter_slot_count(rules: LeagueRules) -> int:
    limits = roster_limits(rules)
    n = sum(int((lim or {}).get("starter") or 0) for lim in limits.values())
    flex_n, _ = _flex_rule(rules)
    return n + flex_n


def fill_starters(
    players: list[dict[str, Any]],
    rules: LeagueRules,
    *,
    score_key: str = "score",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Greedy starter fill from league roster slots + FLEX. Missing slots stay empty."""
    limits = roster_limits(rules)
    flex_count, flex_eligible = _flex_rule(rules)
    remaining = sorted(
        list(players or []),
        key=lambda p: (
            float(p.get(score_key) or 0),
            float(p.get("p90") or 0),
            str(p.get("player_id") or ""),
        ),
        reverse=True,
    )
    starters: list[dict[str, Any]] = []
    used: set[str] = set()

    def _take(position: str, n: int, slot_label: str) -> None:
        nonlocal remaining
        if n <= 0:
            return
        taken = 0
        keep: list[dict[str, Any]] = []
        for card in remaining:
            pid = str(card.get("player_id") or "")
            if pid in used:
                continue
            if normalize_position(card.get("position")) != position:
                keep.append(card)
                continue
            if taken >= n:
                keep.append(card)
                continue
            starter = dict(card)
            starter["slot"] = slot_label if n == 1 else f"{slot_label}{taken + 1}"
            starter["lineup_role"] = "starter"
            starters.append(starter)
            if pid:
                used.add(pid)
            taken += 1
        remaining = [c for c in keep if str(c.get("player_id") or "") not in used]

    for pos in STARTER_FILL_ORDER:
        need = int((limits.get(pos.lower()) or {}).get("starter") or 0)
        _take(pos, need, pos)

    if flex_count > 0:
        keep: list[dict[str, Any]] = []
        taken = 0
        for card in remaining:
            pid = str(card.get("player_id") or "")
            if pid in used:
                continue
            pos = normalize_position(card.get("position"))
            if taken < flex_count and pos in flex_eligible:
                starter = dict(card)
                starter["slot"] = "FLEX" if flex_count == 1 else f"FLEX{taken + 1}"
                starter["lineup_role"] = "starter"
                starters.append(starter)
                if pid:
                    used.add(pid)
                taken += 1
            else:
                keep.append(card)
        remaining = [c for c in keep if str(c.get("player_id") or "") not in used]

    bench: list[dict[str, Any]] = []
    for card in remaining:
        pid = str(card.get("player_id") or "")
        if pid in used:
            continue
        b = dict(card)
        b["slot"] = "BN"
        b["lineup_role"] = "bench"
        bench.append(b)
    return starters, bench


def _positive_proj(*values: Any) -> float | None:
    for value in values:
        if value is None:
            continue
        try:
            num = float(value)
        except (TypeError, ValueError):
            continue
        if num > 0:
            return num
    return None


def starter_points(starters: list[dict[str, Any]], key: str) -> float:
    total = 0.0
    for row in starters or []:
        try:
            val = float(row.get(key) or 0)
        except (TypeError, ValueError):
            val = 0.0
        if val > 0:
            total += val
    return round(total, 2)


def inverse_quantile_sample(p10: float, p50: float, p90: float, u: float) -> float:
    """Piecewise-linear inverse CDF through P10/P50/P90.

    u is Uniform(0, 1). Tails extrapolate with the adjacent slope and clip at 0.
    """
    lo, mid, hi = sorted((float(p10), float(p50), float(p90)))
    u = min(1.0, max(0.0, float(u)))
    if u <= 0.1:
        slope = (mid - lo) / 0.4 if mid != lo else 0.0
        return max(0.0, lo - slope * (0.1 - u))
    if u <= 0.5:
        t = (u - 0.1) / 0.4
        return lo + t * (mid - lo)
    if u <= 0.9:
        t = (u - 0.5) / 0.4
        return mid + t * (hi - mid)
    slope = (hi - mid) / 0.4 if hi != mid else 0.0
    return max(0.0, hi + slope * (u - 0.9))


def _weekly_bands(player: dict[str, Any], nfl_games: int) -> tuple[float, float, float, bool]:
    p50 = player.get("p50")
    p10 = player.get("p10")
    p90 = player.get("p90")
    covered = p50 is not None and float(p50) > 0
    if p50 is None:
        p50 = 0.0
    p50 = float(p50)
    if p10 is None:
        p10 = p50 * 0.82
    if p90 is None:
        p90 = p50 * 1.18
    p10, p50, p90 = sorted((float(p10), float(p50), float(p90)))
    games = max(1, int(nfl_games or DEFAULT_NFL_GAMES))
    return p10 / games, p50 / games, p90 / games, covered


def rotating_opponent(team_index: int, week: int, n_teams: int) -> int | None:
    """Rotating opponent. Returns None only if the offset lands on self."""
    n = int(n_teams)
    if n < 2:
        return None
    offset = 1 + (int(week) % max(1, n - 1))
    opp = (int(team_index) + offset) % n
    if opp == int(team_index):
        return None
    return opp


def _percentile(values: np.ndarray, q: float) -> float:
    if values.size == 0:
        return 0.0
    return float(np.percentile(values, q))


def simulate_pick_draft_outcomes(
    teams: list[dict[str, Any]],
    rules: LeagueRules,
    *,
    n_sims: int = DEFAULT_N_SIMS,
    record_games: int | None = None,
    nfl_games: int = DEFAULT_NFL_GAMES,
    playoff_spots: int | None = None,
    rng: np.random.Generator | None = None,
) -> dict[str, Any]:
    """Monte Carlo starter-aware points + schedule expected wins.

    ``teams`` items: team_id, team_name, players[{player_id, position, p10, p50, p90, ...}].
    """
    games = record_games if record_games is not None else record_games_for_rules(rules)
    games = max(1, int(games))
    nfl = max(1, int(nfl_games or DEFAULT_NFL_GAMES))
    rng = rng or np.random.default_rng(42)
    n_sims = max(32, int(n_sims))
    rostered = [t for t in teams if t.get("team_id")]
    n_teams = len(rostered)
    spots = playoff_spots if playoff_spots is not None else playoff_spots_for_league(n_teams)
    slots = max(1, starter_slot_count(rules))

    season_samples = {str(t["team_id"]): np.zeros(n_sims, dtype=float) for t in rostered}
    win_samples = {str(t["team_id"]): np.zeros(n_sims, dtype=float) for t in rostered}
    playoff_hits = {str(t["team_id"]): 0 for t in rostered}

    weekly_players: list[list[tuple[str, str, float, float, float]]] = []
    coverage_n: dict[str, list[int]] = {str(t["team_id"]): [] for t in rostered}
    for t in rostered:
        prepared: list[tuple[str, str, float, float, float]] = []
        covered = 0
        for p in t.get("players") or []:
            w10, w50, w90, ok = _weekly_bands(p, nfl)
            pid = str(p.get("player_id") or "")
            pos = normalize_position(p.get("position"))
            prepared.append((pid, pos, w10, w50, w90))
            if ok:
                covered += 1
        weekly_players.append(prepared)
        coverage_n[str(t["team_id"])] = [covered, len(t.get("players") or [])]

    team_ids = [str(t["team_id"]) for t in rostered]

    for sim in range(n_sims):
        season_pts = {tid: 0.0 for tid in team_ids}
        wins = {tid: 0.0 for tid in team_ids}
        for week in range(games):
            week_scores: dict[str, float] = {}
            for idx, tid in enumerate(team_ids):
                sampled: list[dict[str, Any]] = []
                for pid, pos, w10, w50, w90 in weekly_players[idx]:
                    draw = inverse_quantile_sample(w10, w50, w90, float(rng.random()))
                    sampled.append({"player_id": pid, "position": pos, "score": draw})
                starters, _ = fill_starters(sampled, rules, score_key="score")
                week_scores[tid] = starter_points(starters, "score")
                season_pts[tid] += week_scores[tid]
            for idx, tid in enumerate(team_ids):
                opp_idx = rotating_opponent(idx, week, n_teams)
                if opp_idx is None:
                    continue
                opp = team_ids[opp_idx]
                mine = week_scores[tid]
                theirs = week_scores[opp]
                if mine > theirs:
                    wins[tid] += 1
                elif mine == theirs:
                    wins[tid] += 0.5
        ranked = sorted(team_ids, key=lambda tid: (-season_pts[tid], tid))
        for seed, tid in enumerate(ranked):
            if seed < spots:
                playoff_hits[tid] += 1
        for tid in team_ids:
            season_samples[tid][sim] = season_pts[tid]
            win_samples[tid][sim] = wins[tid]

    rows: list[dict[str, Any]] = []
    for t in rostered:
        tid = str(t["team_id"])
        pts = season_samples[tid]
        p10 = round(_percentile(pts, 10), 1)
        p50 = round(_percentile(pts, 50), 1)
        p90 = round(_percentile(pts, 90), 1)
        if p10 > p50:
            p10 = p50
        if p90 < p50:
            p90 = p50
        ew = float(np.mean(win_samples[tid]))
        covered, roster_n = coverage_n[tid]
        coverage = (covered / roster_n) if roster_n else 0.0
        rows.append(
            {
                "team_id": tid,
                "team_name": t.get("team_name") or "Team",
                "expected_wins": round(ew, 2),
                "expected_losses": round(max(0.0, games - ew), 2),
                "points_p10": p10,
                "points_p50": p50,
                "points_p90": p90,
                "playoff_probability": round(playoff_hits[tid] / n_sims, 3),
                "projection_coverage": round(coverage, 3),
            }
        )
    rows.sort(key=lambda r: (-r["expected_wins"], -r["points_p50"], r["team_name"]))
    for i, row in enumerate(rows, start=1):
        row["rank"] = i
    return {
        "projected_standings": rows,
        "record_games": games,
        "nfl_games": nfl,
        "n_sims": n_sims,
        "playoff_spots": spots,
        "starter_slots": slots,
        "methodology": (
            f"Each of {n_sims} simulations samples weekly points from player season "
            f"P10/P50/P90 scaled by {nfl} NFL games, then starts a lineup from league "
            f"roster slots (including FLEX). Bench does not score. Expected wins use a "
            f"rotating {games}-game schedule. {OUTCOME_NOTE} "
            "Byes, injuries, and real NFL opponent strength are not modeled."
        ),
        "outcome_note": OUTCOME_NOTE,
        "approximation": True,
    }


def _pos_group_points(players: list[dict[str, Any]], positions: set[str], key: str = "p50") -> float:
    total = 0.0
    for p in players:
        if normalize_position(p.get("position")) in positions:
            try:
                total += float(p.get(key) or 0)
            except (TypeError, ValueError):
                pass
    return total


def pick_draft_awards(
    teams: list[dict[str, Any]],
    rules: LeagueRules,
    standings: list[dict[str, Any]],
    *,
    draft_type: str = "snake",
) -> list[dict[str, Any]]:
    """Pick-draft awards. Never uses cap / bid / salary language."""
    _ = draft_type
    if not teams:
        return []
    scored: list[dict[str, Any]] = []
    for t in teams:
        players = [dict(p) for p in (t.get("players") or [])]
        for p in players:
            p["score"] = float(p.get("p50") or 0)
        starters, bench = fill_starters(players, rules, score_key="score")
        unfilled = max(0, starter_slot_count(rules) - len(starters))
        scored.append(
            {
                "team_id": t.get("team_id"),
                "team_name": t.get("team_name") or "Team",
                "starter_p50": starter_points(starters, "p50"),
                "starter_p10": starter_points(starters, "p10"),
                "starter_p90": starter_points(starters, "p90"),
                "bench_p50": starter_points(bench, "p50"),
                "rb_p50": _pos_group_points(players, {"RB"}),
                "rec_p50": _pos_group_points(players, {"WR", "TE"}),
                "unfilled": unfilled,
                "late_value": _best_late_round_value(players),
                "capital_pos": _concentrated_position(players),
                "players": players,
                "starters": starters,
            }
        )

    awards: list[dict[str, Any]] = []

    def _add(award_id: str, title: str, emoji: str, row: dict[str, Any], detail: str, blurb: str) -> None:
        awards.append(
            {
                "id": award_id,
                "title": title,
                "emoji": emoji,
                "team_id": row.get("team_id"),
                "team_name": row.get("team_name"),
                "player_name": None,
                "detail": detail,
                "blurb": blurb,
            }
        )

    best_lineup = max(scored, key=lambda r: (r["starter_p50"], r["starter_p90"]))
    _add(
        "best_lineup",
        "Best projected starting lineup",
        "⭐",
        best_lineup,
        f"{best_lineup['starter_p50']:.0f} starter pts (median)",
        "Highest projected starters after filling league roster slots.",
    )
    deepest = max(scored, key=lambda r: (r["bench_p50"], r["starter_p50"]))
    if deepest["bench_p50"] > 0:
        _add(
            "deepest_roster",
            "Deepest roster",
            "🧱",
            deepest,
            f"{deepest['bench_p50']:.0f} bench pts (median)",
            "Strongest reserves once the starting lineup is set.",
        )
    upside = max(scored, key=lambda r: (r["starter_p90"], r["starter_p50"]))
    _add(
        "highest_upside",
        "Highest-upside team",
        "🚀",
        upside,
        f"{upside['starter_p90']:.0f} starter pts (ceiling)",
        "The starting lineup with the highest P90 outcome.",
    )
    floor = max(scored, key=lambda r: (r["starter_p10"], r["starter_p50"]))
    _add(
        "safest_floor",
        "Safest floor",
        "🛡️",
        floor,
        f"{floor['starter_p10']:.0f} starter pts (floor)",
        "The starting lineup with the highest P10 outcome.",
    )
    rb_king = max(scored, key=lambda r: (r["rb_p50"], r["starter_p50"]))
    if rb_king["rb_p50"] > 0:
        _add(
            "rb_room",
            "Strongest RB room",
            "💪",
            rb_king,
            f"{rb_king['rb_p50']:.0f} RB pts (median)",
            "Most projected running-back production on the roster.",
        )
    rec_king = max(scored, key=lambda r: (r["rec_p50"], r["starter_p50"]))
    if rec_king["rec_p50"] > 0:
        _add(
            "receiving_room",
            "Strongest receiving room",
            "🎯",
            rec_king,
            f"{rec_king['rec_p50']:.0f} WR/TE pts (median)",
            "Most projected wide receiver and tight end production.",
        )
    late_rows = [r for r in scored if r["late_value"]]
    if late_rows:
        late = max(late_rows, key=lambda r: (r["late_value"]["edge"], r["starter_p50"]))
        pick = late["late_value"]
        awards.append(
            {
                "id": "late_round_value",
                "title": "Best late-round value",
                "emoji": "💎",
                "team_id": late.get("team_id"),
                "team_name": late.get("team_name"),
                "player_name": pick.get("player_name"),
                "detail": f"{pick['player_name']} · pick {pick['overall']} · {pick['p50']:.0f} pts",
                "blurb": "Highest projected production relative to selection point.",
            }
        )
    concentrated = [r for r in scored if r["capital_pos"]]
    if concentrated:
        cap = max(concentrated, key=lambda r: (r["capital_pos"]["count"], r["starter_p50"]))
        info = cap["capital_pos"]
        _add(
            "capital_concentrate",
            "Most draft capital at one position",
            "📍",
            cap,
            f"{info['count']} early {info['position']}s",
            "Stacked one position with early-round picks.",
        )
    # Follow the projected-standings table when it exists. Empty K/DEF slots
    # used to win this award even when they contributed 0 points and the table
    # had a different last-place team.
    standing_need = _standings_need_row(standings, best_lineup.get("team_id"))
    if standing_need:
        scored_need = next((r for r in scored if str(r.get("team_id")) == str(standing_need.get("team_id"))), None)
        holes = _unfilled_labels(scored_need["starters"], rules) if scored_need else []
        wins = standing_need.get("expected_wins")
        median = standing_need.get("points_p50")
        bits = []
        if wins is not None:
            bits.append(f"{float(wins):.1f} expected wins")
        if median is not None:
            bits.append(f"{float(median):.0f} median pts")
        if holes:
            bits.append("needs " + ", ".join(holes))
        _add(
            "biggest_need",
            "Biggest roster need",
            "🚧",
            scored_need or {
                "team_id": standing_need.get("team_id"),
                "team_name": standing_need.get("team_name"),
            },
            " · ".join(bits) or "Weakest projected finish",
            "The weakest projected finish in the standings.",
        )
    else:
        neediest = max(scored, key=lambda r: (r["unfilled"], -r["starter_p50"]))
        if neediest["unfilled"] > 0:
            _add(
                "biggest_need",
                "Biggest roster need",
                "🚧",
                neediest,
                f"{neediest['unfilled']} starter slot{'' if neediest['unfilled'] == 1 else 's'} empty",
                "Ended the draft with unfilled starting spots.",
            )
        else:
            weakest = min(scored, key=lambda r: (r["starter_p50"], r["starter_p10"]))
            if weakest["team_id"] != best_lineup["team_id"]:
                _add(
                    "biggest_need",
                    "Biggest roster need",
                    "🚧",
                    weakest,
                    f"{weakest['starter_p50']:.0f} starter pts (median)",
                    "The thinnest projected starting lineup in the league.",
                )

    balance = _best_balance(scored)
    if balance:
        _add(
            "positional_balance",
            "Best positional balance",
            "⚖️",
            balance,
            "Starters filled across positions",
            "Fewest holes and the most even positional production.",
        )

    # Deduplicate by id while keeping first occurrence.
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for award in awards:
        if award["id"] in seen:
            continue
        seen.add(award["id"])
        out.append(award)
    return out[:10]


def _standings_need_row(
    standings: list[dict[str, Any]],
    best_lineup_team_id: Any,
) -> dict[str, Any] | None:
    rows = [r for r in (standings or []) if r.get("team_id")]
    if len({str(r.get("team_id")) for r in rows}) < 2:
        return None

    def _key(row: dict[str, Any]) -> tuple:
        try:
            wins = float(row.get("expected_wins") or 0)
        except (TypeError, ValueError):
            wins = 0.0
        try:
            pts = float(row.get("points_p50") or 0)
        except (TypeError, ValueError):
            pts = 0.0
        try:
            rank = -int(row.get("rank") or 0)
        except (TypeError, ValueError):
            rank = 0
        return (wins, pts, rank, str(row.get("team_name") or ""))

    last = min(rows, key=_key)
    if str(last.get("team_id")) == str(best_lineup_team_id or ""):
        return None
    return last


def _unfilled_labels(starters: list[dict[str, Any]] | None, rules: LeagueRules) -> list[str]:
    filled: dict[str, int] = {}
    for row in starters or []:
        pos = normalize_position(row.get("position"))
        if pos:
            filled[pos] = filled.get(pos, 0) + 1
    limits = roster_limits(rules)
    holes: list[str] = []
    for pos in STARTER_FILL_ORDER:
        need = int((limits.get(pos.lower()) or {}).get("starter") or 0)
        have = int(filled.get(pos, 0))
        missing = max(0, need - have)
        if missing == 1:
            holes.append(pos)
        elif missing > 1:
            holes.append(f"{pos}×{missing}")
    flex_n, flex_eligible = _flex_rule(rules)
    if flex_n > 0:
        extras = 0
        for pos in flex_eligible:
            need = int((limits.get(pos.lower()) or {}).get("starter") or 0)
            extras += max(0, int(filled.get(pos, 0)) - need)
        if extras < flex_n:
            holes.append("FLEX")
    return holes


def _best_late_round_value(players: list[dict[str, Any]]) -> dict[str, Any] | None:
    ranked = []
    for p in players:
        overall = p.get("overall")
        p50 = p.get("p50")
        if overall is None or p50 is None:
            continue
        try:
            overall_n = int(overall)
            pts = float(p50)
        except (TypeError, ValueError):
            continue
        if overall_n < 48 or pts <= 0:
            continue
        # Later pick + higher projection = better value vs selection point.
        edge = pts - (180.0 - min(180.0, overall_n) * 0.6)
        ranked.append(
            {
                "player_name": p.get("player_name") or p.get("player") or "Player",
                "overall": overall_n,
                "p50": pts,
                "edge": edge,
            }
        )
    if not ranked:
        return None
    return max(ranked, key=lambda r: r["edge"])


def _concentrated_position(players: list[dict[str, Any]]) -> dict[str, Any] | None:
    counts: dict[str, int] = {}
    for p in players:
        overall = p.get("overall")
        try:
            overall_n = int(overall) if overall is not None else 99
        except (TypeError, ValueError):
            overall_n = 99
        if overall_n > 36:
            continue
        pos = normalize_position(p.get("position"))
        if pos not in SKILL_POS:
            continue
        counts[pos] = counts.get(pos, 0) + 1
    if not counts:
        return None
    pos, n = max(counts.items(), key=lambda kv: kv[1])
    if n < 3:
        return None
    return {"position": pos, "count": n}


def _best_balance(scored: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not scored:
        return None

    def _key(row: dict[str, Any]) -> tuple:
        groups = [row["rb_p50"], row["rec_p50"], _pos_group_points(row["players"], {"QB"})]
        filled = [g for g in groups if g > 0]
        if len(filled) < 2:
            return (99, 0.0, row["starter_p50"])
        arr = np.array(filled, dtype=float)
        cv = float(np.std(arr) / max(1.0, np.mean(arr)))
        return (row["unfilled"], cv, -row["starter_p50"])

    return min(scored, key=_key)


def team_insights(
    teams: list[dict[str, Any]],
    rules: LeagueRules,
    standings: list[dict[str, Any]],
    awards: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_id = {str(t.get("team_id")): t for t in teams}
    awards_by_team: dict[str, list[str]] = {}
    for award in awards:
        tid = str(award.get("team_id") or "")
        if tid:
            awards_by_team.setdefault(tid, []).append(award.get("title") or award.get("id") or "")
    out: list[dict[str, Any]] = []
    for row in standings:
        tid = str(row.get("team_id") or "")
        team = by_id.get(tid) or {}
        players = [dict(p) for p in (team.get("players") or [])]
        for p in players:
            p["score"] = float(p.get("p50") or 0)
        starters, bench = fill_starters(players, rules, score_key="score")
        strengths: list[str] = []
        needs: list[str] = []
        rb = _pos_group_points(players, {"RB"})
        rec = _pos_group_points(players, {"WR", "TE"})
        qb = _pos_group_points(players, {"QB"})
        te = _pos_group_points(players, {"TE"})
        if qb >= 18:
            strengths.append("Quarterback")
        if rb >= 24:
            strengths.append("Running backs")
        if rec >= 30:
            strengths.append("Receiving corps")
        if te >= 10:
            strengths.append("Tight end")
        if starter_points(bench, "p50") >= 40:
            strengths.append("Bench depth")
        filled_pos = {normalize_position(s.get("position")) for s in starters}
        limits = roster_limits(rules)
        for pos in STARTER_FILL_ORDER:
            need = int((limits.get(pos.lower()) or {}).get("starter") or 0)
            if need and pos not in filled_pos:
                needs.append(pos)
        if not needs:
            # Weakest projected starter group vs typical.
            groups = [("QB", qb), ("RB", rb), ("WR/TE", rec)]
            groups.sort(key=lambda g: g[1])
            if groups[0][1] < groups[-1][1] * 0.55:
                needs.append(groups[0][0])
        grade = _letter_grade(row.get("rank"), len(standings))
        summary = _team_summary(row, strengths, needs, grade)
        out.append(
            {
                "team_id": tid,
                "team_name": row.get("team_name"),
                "grade": grade,
                "summary": summary,
                "strengths": strengths[:4],
                "needs": needs[:4],
                "awards": awards_by_team.get(tid, []),
                "starter_points_p50": round(starter_points(starters, "p50"), 1),
            }
        )
    return out


def _letter_grade(rank: Any, n_teams: int) -> str:
    try:
        r = int(rank)
    except (TypeError, ValueError):
        return "C"
    n = max(2, int(n_teams or 12))
    pct = (r - 1) / (n - 1)
    if pct <= 0.08:
        return "A+"
    if pct <= 0.2:
        return "A"
    if pct <= 0.35:
        return "B+"
    if pct <= 0.5:
        return "B"
    if pct <= 0.7:
        return "C+"
    if pct <= 0.85:
        return "C"
    return "D"


def _team_summary(row: dict[str, Any], strengths: list[str], needs: list[str], grade: str) -> str:
    name = row.get("team_name") or "This team"
    rank = row.get("rank")
    ew = row.get("expected_wins")
    bits = [f"{name} grades {grade}"]
    if rank:
        bits.append(f"projected {_ordinal(rank)}")
    if ew is not None:
        bits.append(f"{ew:.1f} expected wins")
    if strengths:
        bits.append("strong " + " / ".join(s.lower() for s in strengths[:2]))
    if needs:
        bits.append("needs " + " / ".join(str(n) for n in needs[:2]))
    return " · ".join(bits) + "."


def _ordinal(n: Any) -> str:
    try:
        v = int(n)
    except (TypeError, ValueError):
        return str(n)
    if 10 <= v % 100 <= 20:
        suf = "th"
    else:
        suf = {1: "st", 2: "nd", 3: "rd"}.get(v % 10, "th")
    return f"{v}{suf}"


def notable_pick_rows(players: list[dict[str, Any]], *, limit: int = 8) -> list[dict[str, Any]]:
    """Highlight boom / value picks without auction language."""
    valued = []
    for p in players:
        p50 = p.get("p50") or p.get("season_proj")
        overall = p.get("overall")
        if p50 is None:
            continue
        try:
            pts = float(p50)
            overall_n = int(overall) if overall is not None else 0
        except (TypeError, ValueError):
            continue
        valued.append({**p, "p50": pts, "overall": overall_n, "edge": pts - overall_n * 0.8})
    if not valued:
        return []
    top = sorted(valued, key=lambda p: (-p["p50"], p["overall"]))[:4]
    late = sorted(
        [p for p in valued if p["overall"] >= 48],
        key=lambda p: (-p["edge"], -p["p50"]),
    )[:4]
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in top + late:
        key = f"{row.get('player_id')}:{row.get('team_id')}"
        if key in seen:
            continue
        seen.add(key)
        out.append({
            **row,
            "season_proj": row.get("p50"),
            "value_grade": "pick",
        })
        if len(out) >= limit:
            break
    return out


def projection_index_from_pool(season: int) -> tuple[dict[str, dict[str, Any]], int]:
    """Read materialized draft-pool quantiles. Never live-infers."""
    from src.draft_hub.draft_pool_cache import load_draft_pool, load_pool_meta

    index: dict[str, dict[str, Any]] = {}
    meta = load_pool_meta(season)
    nfl_games = int(meta.get("games_per_season") or DEFAULT_NFL_GAMES)
    try:
        pool = load_draft_pool(int(season), allow_compute=False)
    except Exception:
        return index, nfl_games
    if pool is None or getattr(pool, "empty", True):
        return index, nfl_games
    for _, p in pool.iterrows():
        pid = str(p.get("player_id") or p.get("Player") or "")
        if not pid:
            continue
        def _num(*keys: str) -> float | None:
            for key in keys:
                if key not in p:
                    continue
                val = p.get(key)
                try:
                    if val is None or (isinstance(val, float) and np.isnan(val)):
                        continue
                    return float(val)
                except (TypeError, ValueError):
                    continue
            return None

        p50 = _num("Season P50", "Season Proj")
        p10 = _num("Season P10", "Season Floor")
        p90 = _num("Season P90", "Season Ceiling")
        index[pid] = {
            "p10": p10,
            "p50": p50,
            "p90": p90,
            "season_proj": _num("Season Proj"),
            "position": normalize_position(p.get("Position")),
            "player_name": str(p.get("Player") or ""),
            "team": str(p.get("Team") or ""),
        }
    try:
        from src.draft_hub.k_def_pool_cache import k_def_projection_index

        for pid, row in k_def_projection_index(allow_fetch=False).items():
            if pid not in index:
                index[pid] = row
    except Exception:
        pass
    return index, nfl_games


def players_for_team(
    team_id: str,
    team_name: str,
    picks: list[dict[str, Any]],
    roster: list[dict[str, Any]] | None,
    proj_index: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Merge pick-event quantiles with pool projections. Prefer pick events."""
    by_id: dict[str, dict[str, Any]] = {}
    for p in picks:
        if str(p.get("team_id") or "") != str(team_id):
            continue
        pid = str(p.get("player_id") or "")
        if not pid:
            continue
        pool = proj_index.get(pid) or {}
        p50 = _positive_proj(p.get("season_p50"), p.get("season_proj"), pool.get("p50"), pool.get("season_proj"))
        p10 = _positive_proj(p.get("season_p10"), pool.get("p10"))
        p90 = _positive_proj(p.get("season_p90"), pool.get("p90"))
        by_id[pid] = {
            "player_id": pid,
            "player_name": p.get("player_name") or pool.get("player_name") or "Player",
            "position": normalize_position(p.get("position") or pool.get("position")),
            "team": p.get("nfl_team") or pool.get("team") or "",
            "p10": p10,
            "p50": p50,
            "p90": p90,
            "overall": p.get("overall"),
            "round": p.get("round"),
            "slot": p.get("slot"),
            "team_id": str(team_id),
            "team_name": team_name,
        }
    for row in roster or []:
        pid = str(row.get("player_id") or "")
        if not pid or pid in by_id:
            continue
        pool = proj_index.get(pid) or {}
        by_id[pid] = {
            "player_id": pid,
            "player_name": row.get("player_name") or pool.get("player_name") or "Player",
            "position": normalize_position(row.get("position") or pool.get("position")),
            "team": row.get("team") or pool.get("team") or "",
            "p10": pool.get("p10"),
            "p50": pool.get("p50"),
            "p90": pool.get("p90"),
            "overall": None,
            "round": None,
            "slot": None,
            "team_id": str(team_id),
            "team_name": team_name,
            "keeper": True,
        }
    return list(by_id.values())


def build_pick_draft_recap(
    *,
    league_id: str,
    picks: list[dict[str, Any]],
    overview: dict[str, Any] | None,
    rules: LeagueRules,
    draft_type: str,
    season: int,
    n_sims: int = DEFAULT_N_SIMS,
) -> dict[str, Any]:
    proj_index, nfl_games = projection_index_from_pool(season)
    teams_out: list[dict[str, Any]] = []
    roster_blocks = (overview or {}).get("teams") or []
    if roster_blocks:
        for block in roster_blocks:
            team = block.get("team") or {}
            tid = str(team.get("id") or block.get("team_id") or "")
            name = team.get("name") or block.get("team_name") or "Team"
            if not tid:
                continue
            teams_out.append(
                {
                    "team_id": tid,
                    "team_name": name,
                    "players": players_for_team(tid, name, picks, block.get("roster") or [], proj_index),
                }
            )
    else:
        by_team: dict[str, dict[str, Any]] = {}
        for p in picks:
            tid = str(p.get("team_id") or "")
            if not tid:
                continue
            bucket = by_team.setdefault(tid, {"team_id": tid, "team_name": p.get("team_name") or "Team", "picks": []})
            bucket["picks"].append(p)
        for tid, bucket in by_team.items():
            teams_out.append(
                {
                    "team_id": tid,
                    "team_name": bucket["team_name"],
                    "players": players_for_team(tid, bucket["team_name"], bucket["picks"], [], proj_index),
                }
            )

    sim = simulate_pick_draft_outcomes(
        teams_out,
        rules,
        n_sims=n_sims,
        record_games=record_games_for_rules(rules),
        nfl_games=nfl_games,
    )
    awards = pick_draft_awards(teams_out, rules, sim["projected_standings"], draft_type=draft_type)
    insights = team_insights(teams_out, rules, sim["projected_standings"], awards)
    all_players = [p for t in teams_out for p in t.get("players") or []]
    return {
        "projected_standings": sim["projected_standings"],
        "record_games": sim["record_games"],
        "nfl_games": sim["nfl_games"],
        "methodology": sim["methodology"],
        "outcome_note": sim["outcome_note"],
        "approximation": True,
        "n_sims": sim["n_sims"],
        "playoff_spots": sim["playoff_spots"],
        "awards": awards,
        "team_insights": insights,
        "notable_picks": notable_pick_rows(all_players),
        "projection_index_size": len(proj_index),
        "league_id": league_id,
        "draft_type": draft_type,
        "pick_draft": True,
    }
