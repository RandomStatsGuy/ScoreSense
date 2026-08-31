"""Fantasy lineup optimization from weekly quantile projections."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import Bounds, LinearConstraint, milp

from src.products.dfs_config import get_site_config
from src.projections.weekly_cache import load_weekly_prediction
from src.core.projection_context import resolve_projection_context

OBJECTIVE_COLUMNS = {
    "median": "Projected Points",
    "floor": "Low (P10)",
    "ceiling": "High (P90)",
    "value": "value",
}

SLOT_ORDER_SEASONAL = ("QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX")

MAX_LINEUP_COUNT = 150

# Player-level linear constraint expressed by player_id so it can be
# materialized in any solver's variable space (classic or captain mode):
# (coeffs: dict[player_id, coefficient], lb, ub)
PlayerConstraint = tuple[dict[str, float], float, float]


@dataclass
class LineupPlayer:
    player_id: str
    name: str
    team: str
    position: str
    proj: float
    floor: float
    ceiling: float
    injury_status: str = ""
    salary: int | None = None
    dfs_id: str = ""
    value: float | None = None
    on_bye: bool = False
    opponent: str = ""
    cpt_salary: int | None = None
    cpt_dfs_id: str = ""
    eligible_slots: tuple[str, ...] = field(default_factory=tuple)

    @property
    def unavailable(self) -> bool:
        if self.position == "DST":
            return False
        status = self.injury_status.lower()
        return any(k in status for k in ("out", "ir", "pup", "inactive", "suspended"))


def _normalize_pos(raw: str) -> str:
    pos = str(raw or "").upper()
    if pos in ("FB",):
        return "RB"
    if pos in ("REC",):
        return "WR"
    if pos in ("DEF", "D"):
        return "DST"
    return pos


def build_lineup_pool(
    season: int | None = None,
    week: int | None = None,
    apply_injury_adjustments: bool = True,
    data_dir=None,
    model_dir=None,
    top_per_position: int = 40,
    site: str = "seasonal",
) -> tuple[pd.DataFrame, dict]:
    """Merge QB/RB/WR weekly projections into one pool with fantasy positions."""
    from src.config import MODEL_DIR, PROCESSED_DATA_DIR

    data_dir = data_dir or PROCESSED_DATA_DIR
    model_dir = model_dir or MODEL_DIR
    site_cfg = get_site_config(site)

    path = data_dir / "qb_mlready.parquet"
    if not path.exists():
        path = data_dir / "qb_mlready.csv"
    df = pd.read_parquet(path) if path.suffix == ".parquet" else pd.read_csv(path)
    season, week = resolve_projection_context(df, season, week)

    frames: list[pd.DataFrame] = []
    for position in ("qb", "rb", "wr"):
        preds = load_weekly_prediction(
            position,
            season=season,
            week=week,
            apply_injury_adjustments=apply_injury_adjustments,
        )
        if position == "qb":
            preds["Position"] = "QB"
        elif "Position" not in preds.columns:
            preds["Position"] = position.upper()
        frames.append(preds)

    pool = pd.concat(frames, ignore_index=True)
    pool["Position"] = pool["Position"].map(_normalize_pos)
    allowed = ["QB", "RB", "WR", "TE"]
    if site_cfg["roster"].get("dst", 0) or "DST" in site_cfg["flex_positions"]:
        allowed.append("DST")
    pool = pool[pool["Position"].isin(allowed)].copy()

    for col in ("Projected Points", "Low (P10)", "High (P90)"):
        pool[col] = pd.to_numeric(pool[col], errors="coerce").fillna(0.0)

    pool = pool.sort_values("Projected Points", ascending=False)
    if top_per_position:
        pool = (
            pool.groupby("Position", group_keys=False)
            .head(top_per_position)
            .reset_index(drop=True)
        )

    from src.core.schedule_utils import attach_bye_flags

    pool = attach_bye_flags(pool, int(season), int(week))

    meta = {
        "season": int(season),
        "week": int(week),
        "count": len(pool),
        "site": site,
        "roster_format": site_cfg["roster"],
        "salary_cap": site_cfg["salary_cap"],
    }
    return pool, meta


def _players_from_pool(
    pool: pd.DataFrame,
    objective: str = "median",
    locked_player_ids: set[str] | None = None,
    excluded_player_ids: set[str] | None = None,
    candidate_player_ids: set[str] | None = None,
    require_salary: bool = False,
    block_bye_weeks: bool = True,
) -> list[LineupPlayer]:
    locked_player_ids = locked_player_ids or set()
    excluded_player_ids = excluded_player_ids or set()

    players: list[LineupPlayer] = []
    for row in pool.to_dict(orient="records"):
        pid = str(row.get("player_id") or "")
        if not pid:
            continue
        if candidate_player_ids is not None and pid not in candidate_player_ids:
            continue
        if pid in excluded_player_ids:
            continue
        pos = _normalize_pos(row.get("Position", ""))
        if pos not in ("QB", "RB", "WR", "TE", "DST"):
            continue

        salary_raw = row.get("salary")
        salary = int(salary_raw) if salary_raw is not None and pd.notna(salary_raw) else None
        if require_salary and salary is None and pid not in locked_player_ids:
            continue

        cpt_salary_raw = row.get("cpt_salary")
        cpt_salary = (
            int(cpt_salary_raw)
            if cpt_salary_raw is not None and pd.notna(cpt_salary_raw)
            else None
        )

        injury = str(row.get("Injury Status") or "")
        on_bye = bool(row.get("on_bye"))
        if on_bye and block_bye_weeks and pid not in locked_player_ids:
            continue
        if injury and LineupPlayer("", "", "", pos, 0, 0, 0, injury).unavailable:
            if pid not in locked_player_ids:
                continue

        value_raw = row.get("value")
        value = float(value_raw) if value_raw is not None and pd.notna(value_raw) else None
        if value is None and salary and salary > 0:
            value = float(row.get("Projected Points") or 0) / salary * 1000

        opponent_raw = row.get("Opponent")
        opponent = str(opponent_raw or "").upper() if pd.notna(opponent_raw) else ""
        if opponent == "BYE":
            opponent = ""

        players.append(
            LineupPlayer(
                player_id=pid,
                name=str(row.get("Player") or ""),
                team=str(row.get("Team") or ""),
                position=pos,
                proj=float(row.get("Projected Points") or 0),
                floor=float(row.get("Low (P10)") or 0),
                ceiling=float(row.get("High (P90)") or 0),
                injury_status=injury,
                salary=salary,
                dfs_id=str(row.get("dfs_id") or ""),
                value=value,
                on_bye=on_bye,
                opponent=opponent,
                cpt_salary=cpt_salary,
                cpt_dfs_id=str(row.get("cpt_dfs_id") or ""),
            )
        )
    return players


def _stack_constraints(players: list[LineupPlayer], n: int, stack_count: int) -> list[LinearConstraint]:
    """If a QB is used, require at least `stack_count` same-team WR/TE."""
    constraints: list[LinearConstraint] = []
    for i, qb in enumerate(players):
        if qb.position != "QB":
            continue
        team = qb.team.upper()
        row = np.zeros(n, dtype=float)
        row[i] = -float(stack_count)
        mates = 0
        for j, p in enumerate(players):
            if p.position in ("WR", "TE") and p.team.upper() == team:
                row[j] = 1.0
                mates += 1
        if mates:
            constraints.append(LinearConstraint(row.reshape(1, -1), lb=0, ub=np.inf))
    return constraints


def _bring_back_constraints(players: list[LineupPlayer], n: int) -> list[LinearConstraint]:
    """If a QB is used, require at least one opposing RB/WR/TE (game stack)."""
    constraints: list[LinearConstraint] = []
    for i, qb in enumerate(players):
        if qb.position != "QB":
            continue
        opponent = qb.opponent.upper()
        if not opponent:
            continue
        row = np.zeros(n, dtype=float)
        row[i] = -1.0
        rivals = 0
        for j, p in enumerate(players):
            if p.position in ("RB", "WR", "TE") and p.team.upper() == opponent:
                row[j] = 1.0
                rivals += 1
        if rivals:
            constraints.append(LinearConstraint(row.reshape(1, -1), lb=0, ub=np.inf))
    return constraints


def _team_limit_constraints(players: list[LineupPlayer], n: int, max_per_team: int) -> list[LinearConstraint]:
    constraints: list[LinearConstraint] = []
    teams = {p.team.upper() for p in players if p.team}
    for team in sorted(teams):
        row = np.array(
            [1.0 if p.team.upper() == team else 0.0 for p in players], dtype=float
        )
        if row.sum() > max_per_team:
            constraints.append(
                LinearConstraint(row.reshape(1, -1), lb=0, ub=float(max_per_team))
            )
    return constraints


def _objective_value(player: LineupPlayer, objective: str) -> float:
    if objective == "floor":
        return player.floor
    if objective == "ceiling":
        return player.ceiling
    if objective == "value":
        if player.value is not None:
            return player.value
        if player.salary and player.salary > 0:
            return player.proj / player.salary * 1000
        return 0.0
    return player.proj


def _materialize_player_constraints(
    players: list[LineupPlayer],
    constraints: list[PlayerConstraint] | None,
    n_vars: int,
    var_indexes: dict[str, list[int]],
) -> list[LinearConstraint]:
    """Expand player-id constraints into this solver's variable space."""
    out: list[LinearConstraint] = []
    for coeffs, lb, ub in constraints or []:
        row = np.zeros(n_vars, dtype=float)
        hit = False
        for pid, coeff in coeffs.items():
            for idx in var_indexes.get(pid, []):
                row[idx] = float(coeff)
                hit = True
        if hit:
            out.append(LinearConstraint(row.reshape(1, -1), lb=lb, ub=ub))
    return out


def optimize_lineup(
    players: list[LineupPlayer],
    objective: str = "median",
    locked_player_ids: set[str] | None = None,
    roster: dict[str, int] | None = None,
    salary_cap: int | None = None,
    flex_positions: tuple[str, ...] = ("RB", "WR", "TE"),
    require_qb_stack: bool = False,
    qb_stack_count: int | None = None,
    stack_bring_back: bool = False,
    max_per_team: int | None = None,
    min_salary: int | None = None,
    objective_noise: dict[str, float] | None = None,
    captain_multiplier: float = 1.5,
    captain_salary_multiplier: float = 1.5,
    captain_label: str = "CPT",
    extra_constraints: list[PlayerConstraint] | None = None,
) -> dict:
    """Maximize projected points (or value) under roster and optional salary-cap constraints."""
    locked_player_ids = locked_player_ids or set()
    roster = roster or get_site_config("seasonal")["roster"]
    stack_count = int(qb_stack_count) if qb_stack_count is not None else (1 if require_qb_stack else 0)

    if roster.get("cpt"):
        return _optimize_captain_lineup(
            players,
            objective=objective,
            locked_player_ids=locked_player_ids,
            roster=roster,
            salary_cap=salary_cap,
            max_per_team=max_per_team,
            min_salary=min_salary,
            objective_noise=objective_noise,
            captain_multiplier=captain_multiplier,
            captain_salary_multiplier=captain_salary_multiplier,
            captain_label=captain_label,
            extra_constraints=extra_constraints,
        )

    n = len(players)
    if n == 0:
        return {"ok": False, "error": "No eligible players in the pool.", "lineup": []}

    qb_need = roster.get("qb", 1)
    rb_need = roster.get("rb", 2)
    wr_need = roster.get("wr", 2)
    te_need = roster.get("te", 1)
    flex_need = roster.get("flex", 1)
    dst_need = roster.get("dst", 0)
    total = qb_need + rb_need + wr_need + te_need + flex_need + dst_need

    idx = {p.player_id: i for i, p in enumerate(players)}
    for pid in locked_player_ids:
        if pid not in idx:
            return {"ok": False, "error": f"Locked player {pid} not found in pool.", "lineup": []}
        if salary_cap is not None and players[idx[pid]].salary is None:
            return {
                "ok": False,
                "error": f"Locked player {pid} has no salary for this DFS slate.",
                "lineup": [],
            }

    locked_salary = sum(players[idx[pid]].salary or 0 for pid in locked_player_ids)
    if salary_cap is not None and locked_salary > salary_cap:
        return {
            "ok": False,
            "error": f"Locked players cost ${locked_salary:,}, above the ${salary_cap:,} cap.",
            "lineup": [],
        }

    noise = objective_noise or {}
    c = np.array(
        [-_objective_value(p, objective) * noise.get(p.player_id, 1.0) for p in players],
        dtype=float,
    )
    integrality = np.ones(n, dtype=int)
    bounds = Bounds(lb=np.zeros(n), ub=np.ones(n))

    constraints: list[LinearConstraint] = []
    constraints.append(LinearConstraint(np.ones((1, n)), lb=total, ub=total))

    def _mask(positions: tuple[str, ...]) -> np.ndarray:
        return np.array([1.0 if p.position in positions else 0.0 for p in players]).reshape(1, -1)

    constraints.append(LinearConstraint(_mask(("QB",)), lb=qb_need, ub=qb_need))
    skill_need = rb_need + wr_need + te_need + flex_need
    constraints.append(
        LinearConstraint(_mask(("RB", "WR", "TE")), lb=skill_need, ub=skill_need)
    )
    constraints.append(LinearConstraint(_mask(("RB",)), lb=rb_need, ub=rb_need + flex_need))
    constraints.append(LinearConstraint(_mask(("WR",)), lb=wr_need, ub=wr_need + flex_need))
    constraints.append(LinearConstraint(_mask(("TE",)), lb=te_need, ub=te_need + flex_need))
    if dst_need:
        constraints.append(LinearConstraint(_mask(("DST",)), lb=dst_need, ub=dst_need))

    if salary_cap is not None:
        salaries = np.array([float(p.salary or 0) for p in players], dtype=float)
        floor_spend = float(min_salary) if min_salary else 0.0
        constraints.append(
            LinearConstraint(salaries.reshape(1, -1), lb=floor_spend, ub=float(salary_cap))
        )

    for pid in locked_player_ids:
        row = np.zeros((1, n))
        row[0, idx[pid]] = 1.0
        constraints.append(LinearConstraint(row, lb=1, ub=1))

    if stack_count > 0:
        constraints.extend(_stack_constraints(players, n, stack_count))
    if stack_bring_back:
        constraints.extend(_bring_back_constraints(players, n))
    if max_per_team is not None and max_per_team > 0:
        constraints.extend(_team_limit_constraints(players, n, int(max_per_team)))
    constraints.extend(
        _materialize_player_constraints(
            players, extra_constraints, n, {p.player_id: [i] for i, p in enumerate(players)}
        )
    )

    result = milp(c, integrality=integrality, bounds=bounds, constraints=constraints)
    if not result.success:
        msg = "Could not find a valid lineup with the current pool and locks."
        if salary_cap is not None:
            msg += " Try raising the cap, importing salaries, or relaxing locks."
        if stack_count or stack_bring_back or max_per_team or min_salary:
            msg += " Stacking and team-limit rules also narrow the pool."
        return {"ok": False, "error": msg, "lineup": []}

    chosen = [players[i] for i, val in enumerate(result.x) if val > 0.5]
    if len(chosen) != total:
        return {
            "ok": False,
            "error": "Optimizer returned an incomplete lineup.",
            "lineup": [],
        }

    slots = _assign_slots(chosen, roster)
    total_points = sum(_objective_value(p, objective) for p in chosen)
    total_salary = sum(p.salary or 0 for p in chosen)
    remaining = (salary_cap - total_salary) if salary_cap is not None else None

    note_parts = [
        "Optimizer uses ScoreSense weekly projections.",
    ]
    if stack_count == 1:
        note_parts.append("QB stack rule: each QB paired with a same-team WR or TE.")
    elif stack_count > 1:
        note_parts.append(f"QB stack rule: each QB paired with {stack_count} same-team pass catchers.")
    if stack_bring_back:
        note_parts.append("Bring-back: at least one opposing RB/WR/TE joins each QB's game.")
    if max_per_team:
        note_parts.append(f"No more than {max_per_team} players from one NFL team.")
    if salary_cap is not None:
        note_parts.append(f"Salary cap: ${salary_cap:,} · used ${total_salary:,}.")
    if min_salary:
        note_parts.append(f"Minimum spend: ${int(min_salary):,}.")
    if objective == "value":
        note_parts.append("Value objective maximizes projected points per $1,000 salary.")

    return {
        "ok": True,
        "objective": objective,
        "total_points": round(total_points, 2),
        "total_salary": total_salary if salary_cap is not None else None,
        "salary_remaining": remaining,
        "lineup": slots,
        "note": " ".join(note_parts),
    }


def _captain_salary(player: LineupPlayer, salary_multiplier: float) -> int:
    if player.cpt_salary is not None:
        return int(player.cpt_salary)
    return int(round((player.salary or 0) * salary_multiplier))


def _optimize_captain_lineup(
    players: list[LineupPlayer],
    objective: str = "median",
    locked_player_ids: set[str] | None = None,
    roster: dict[str, int] | None = None,
    salary_cap: int | None = None,
    max_per_team: int | None = None,
    min_salary: int | None = None,
    objective_noise: dict[str, float] | None = None,
    captain_multiplier: float = 1.5,
    captain_salary_multiplier: float = 1.5,
    captain_label: str = "CPT",
    extra_constraints: list[PlayerConstraint] | None = None,
) -> dict:
    """Single-game captain-mode MILP: one CPT/MVP slot at boosted points/salary + FLEX."""
    locked_player_ids = locked_player_ids or set()
    roster = roster or {"cpt": 1, "flex": 5}
    cpt_need = int(roster.get("cpt", 1))
    flex_need = int(roster.get("flex", 5))
    total = cpt_need + flex_need

    n = len(players)
    if n == 0:
        return {"ok": False, "error": "No eligible players in the pool.", "lineup": []}

    idx = {p.player_id: i for i, p in enumerate(players)}
    for pid in locked_player_ids:
        if pid not in idx:
            return {"ok": False, "error": f"Locked player {pid} not found in pool.", "lineup": []}
        if salary_cap is not None and players[idx[pid]].salary is None:
            return {
                "ok": False,
                "error": f"Locked player {pid} has no salary for this DFS slate.",
                "lineup": [],
            }

    # Variables: x[0..n) = player as FLEX, x[n..2n) = player as captain.
    noise = objective_noise or {}
    n_vars = 2 * n
    c = np.zeros(n_vars, dtype=float)
    flex_salaries = np.zeros(n_vars, dtype=float)
    for i, p in enumerate(players):
        jitter = noise.get(p.player_id, 1.0)
        base_obj = _objective_value(p, objective)
        cpt_salary = _captain_salary(p, captain_salary_multiplier)
        if objective == "value":
            cpt_obj = (p.proj * captain_multiplier) / cpt_salary * 1000 if cpt_salary > 0 else 0.0
        else:
            cpt_obj = base_obj * captain_multiplier
        c[i] = -base_obj * jitter
        c[n + i] = -cpt_obj * jitter
        flex_salaries[i] = float(p.salary or 0)
        flex_salaries[n + i] = float(cpt_salary)

    integrality = np.ones(n_vars, dtype=int)
    bounds = Bounds(lb=np.zeros(n_vars), ub=np.ones(n_vars))
    constraints: list[LinearConstraint] = []

    flex_row = np.concatenate([np.ones(n), np.zeros(n)])
    cpt_row = np.concatenate([np.zeros(n), np.ones(n)])
    constraints.append(LinearConstraint(flex_row.reshape(1, -1), lb=flex_need, ub=flex_need))
    constraints.append(LinearConstraint(cpt_row.reshape(1, -1), lb=cpt_need, ub=cpt_need))

    for i, _ in enumerate(players):
        row = np.zeros(n_vars)
        row[i] = 1.0
        row[n + i] = 1.0
        lock = players[i].player_id in locked_player_ids
        constraints.append(LinearConstraint(row.reshape(1, -1), lb=1 if lock else 0, ub=1))

    if salary_cap is not None:
        floor_spend = float(min_salary) if min_salary else 0.0
        constraints.append(
            LinearConstraint(flex_salaries.reshape(1, -1), lb=floor_spend, ub=float(salary_cap))
        )

    teams = sorted({p.team.upper() for p in players if p.team})
    if len(teams) == 2:
        # Site rule on single-game slates: at least one player from each team.
        for team in teams:
            row = np.zeros(n_vars)
            for i, p in enumerate(players):
                if p.team.upper() == team:
                    row[i] = 1.0
                    row[n + i] = 1.0
            constraints.append(LinearConstraint(row.reshape(1, -1), lb=1, ub=np.inf))
    if max_per_team is not None and max_per_team > 0:
        for team in teams:
            row = np.zeros(n_vars)
            for i, p in enumerate(players):
                if p.team.upper() == team:
                    row[i] = 1.0
                    row[n + i] = 1.0
            if row.sum() > max_per_team:
                constraints.append(
                    LinearConstraint(row.reshape(1, -1), lb=0, ub=float(max_per_team))
                )

    var_indexes = {p.player_id: [i, n + i] for i, p in enumerate(players)}
    constraints.extend(
        _materialize_player_constraints(players, extra_constraints, n_vars, var_indexes)
    )

    result = milp(c, integrality=integrality, bounds=bounds, constraints=constraints)
    if not result.success:
        return {
            "ok": False,
            "error": (
                "Could not build a valid single-game lineup. "
                "Load a single-game slate (two teams) and check locks against the cap."
            ),
            "lineup": [],
        }

    flex_chosen = [players[i] for i in range(n) if result.x[i] > 0.5]
    cpt_chosen = [players[i] for i in range(n) if result.x[n + i] > 0.5]
    if len(flex_chosen) + len(cpt_chosen) != total:
        return {"ok": False, "error": "Optimizer returned an incomplete lineup.", "lineup": []}

    slots: list[dict] = []
    total_points = 0.0
    total_salary = 0
    for p in cpt_chosen:
        cpt_salary = _captain_salary(p, captain_salary_multiplier)
        row = _slot_row(captain_label, p)
        row.update(
            {
                "proj": round(p.proj * captain_multiplier, 2),
                "floor": round(p.floor * captain_multiplier, 2),
                "ceiling": round(p.ceiling * captain_multiplier, 2),
                "salary": cpt_salary if salary_cap is not None else None,
                "value": (
                    round(p.proj * captain_multiplier / cpt_salary * 1000, 2)
                    if cpt_salary > 0
                    else None
                ),
                "dfs_id": p.cpt_dfs_id or p.dfs_id or None,
                "multiplier": captain_multiplier,
            }
        )
        slots.append(row)
        total_points += (
            (p.proj * captain_multiplier) / cpt_salary * 1000
            if objective == "value" and cpt_salary > 0
            else _objective_value(p, objective) * captain_multiplier
        )
        total_salary += cpt_salary

    for i, p in enumerate(sorted(flex_chosen, key=lambda x: -x.proj)):
        slots.append(_slot_row(f"FLEX{i + 1}", p))
        total_points += _objective_value(p, objective)
        total_salary += p.salary or 0

    remaining = (salary_cap - total_salary) if salary_cap is not None else None
    note_parts = [
        "Optimizer uses ScoreSense weekly projections.",
        f"{captain_label} scores {captain_multiplier}× points at {captain_salary_multiplier}× salary.",
    ]
    if len(teams) == 2:
        note_parts.append("At least one player from each team, per site rules.")
    if salary_cap is not None:
        note_parts.append(f"Salary cap: ${salary_cap:,} · used ${total_salary:,}.")
    if min_salary:
        note_parts.append(f"Minimum spend: ${int(min_salary):,}.")

    return {
        "ok": True,
        "objective": objective,
        "total_points": round(total_points, 2),
        "total_salary": total_salary if salary_cap is not None else None,
        "salary_remaining": remaining,
        "lineup": slots,
        "note": " ".join(note_parts),
    }


def _assign_slots(chosen: list[LineupPlayer], roster: dict[str, int]) -> list[dict]:
    """Greedy slot assignment after MILP selection."""
    rb_need = roster.get("rb", 2)
    wr_need = roster.get("wr", 2)
    te_need = roster.get("te", 1)
    flex_need = roster.get("flex", 1)
    dst_need = roster.get("dst", 0)

    by_pos: dict[str, list[LineupPlayer]] = {"QB": [], "RB": [], "WR": [], "TE": [], "DST": []}
    for p in sorted(chosen, key=lambda x: -x.proj):
        by_pos.setdefault(p.position, []).append(p)

    lineup: list[dict] = []
    qbs = by_pos.get("QB", [])
    if qbs:
        lineup.append(_slot_row("QB", qbs[0]))

    rbs = list(by_pos.get("RB", []))
    wrs = list(by_pos.get("WR", []))
    tes = list(by_pos.get("TE", []))
    dsts = list(by_pos.get("DST", []))

    for i in range(rb_need):
        if rbs:
            lineup.append(_slot_row(f"RB{i + 1}", rbs.pop(0)))

    for i in range(wr_need):
        if wrs:
            lineup.append(_slot_row(f"WR{i + 1}", wrs.pop(0)))

    for i in range(te_need):
        if tes:
            lineup.append(_slot_row("TE" if te_need == 1 else f"TE{i + 1}", tes.pop(0)))

    flex_candidates = rbs + wrs + tes
    flex_candidates.sort(key=lambda p: -p.proj)
    for i in range(flex_need):
        if flex_candidates:
            lineup.append(_slot_row("FLEX" if flex_need == 1 else f"FLEX{i + 1}", flex_candidates.pop(0)))

    for i in range(dst_need):
        if dsts:
            lineup.append(_slot_row("DST" if dst_need == 1 else f"DST{i + 1}", dsts.pop(0)))

    return lineup


def _slot_row(slot: str, player: LineupPlayer) -> dict:
    value = player.value
    if value is None and player.salary and player.salary > 0:
        value = round(player.proj / player.salary * 1000, 2)
    return {
        "slot": slot,
        "player_id": player.player_id,
        "player": player.name,
        "team": player.team,
        "position": player.position,
        "proj": round(player.proj, 2),
        "floor": round(player.floor, 2),
        "ceiling": round(player.ceiling, 2),
        "salary": player.salary,
        "value": round(value, 2) if value is not None else None,
        "dfs_id": player.dfs_id or None,
        "injury_status": player.injury_status or None,
        "on_bye": player.on_bye,
    }


def optimize_multiple_lineups(
    players: list[LineupPlayer],
    count: int = 3,
    max_overlap: int = 4,
    max_exposure: float | None = None,
    randomness: float = 0.0,
    seed: int | None = None,
    **kwargs,
) -> dict:
    """Generate diverse lineups with overlap caps, exposure caps, and optional jitter."""
    count = max(1, min(int(count), MAX_LINEUP_COUNT))
    roster = kwargs.get("roster") or get_site_config("seasonal")["roster"]
    roster_size = sum(int(v) for v in roster.values())
    # Never allow an exact duplicate of an earlier lineup.
    max_overlap = max(0, min(int(max_overlap), roster_size - 1))
    randomness = max(0.0, min(float(randomness or 0.0), 1.0))
    exposure_cap = None
    if max_exposure is not None and 0 < float(max_exposure) < 1:
        exposure_cap = max(1, math.ceil(float(max_exposure) * count))

    locked = set(kwargs.get("locked_player_ids") or [])
    rng = np.random.default_rng(seed)
    by_id = {p.player_id: p for p in players}

    lineups: list[dict] = []
    extra: list[PlayerConstraint] = []
    usage: dict[str, int] = {}
    excluded_by_exposure: set[str] = set()

    for _ in range(count):
        noise = None
        if randomness > 0:
            noise = {
                p.player_id: float(np.clip(rng.normal(1.0, randomness), 0.05, None))
                for p in players
            }
        result = optimize_lineup(
            players, extra_constraints=extra, objective_noise=noise, **kwargs
        )
        if not result.get("ok"):
            if lineups:
                return _multi_result(
                    lineups,
                    usage,
                    by_id,
                    note=result.get("error", "Stopped early — could not diversify further."),
                    max_overlap=max_overlap,
                    exposure_cap=exposure_cap,
                    requested=count,
                    randomness=randomness,
                )
            return result

        lineups.append(result)
        chosen_ids = [row["player_id"] for row in result["lineup"]]
        extra.append(({pid: 1.0 for pid in chosen_ids}, 0, float(max_overlap)))
        for pid in chosen_ids:
            usage[pid] = usage.get(pid, 0) + 1
            if (
                exposure_cap is not None
                and pid not in locked
                and pid not in excluded_by_exposure
                and usage[pid] >= exposure_cap
            ):
                excluded_by_exposure.add(pid)
                extra.append(({pid: 1.0}, 0, 0))

    return _multi_result(
        lineups,
        usage,
        by_id,
        note=None,
        max_overlap=max_overlap,
        exposure_cap=exposure_cap,
        requested=count,
        randomness=randomness,
    )


def _multi_result(
    lineups: list[dict],
    usage: dict[str, int],
    by_id: dict[str, LineupPlayer],
    note: str | None,
    max_overlap: int,
    exposure_cap: int | None,
    requested: int,
    randomness: float,
) -> dict:
    built = len(lineups)
    exposure = []
    for pid, used in sorted(usage.items(), key=lambda kv: (-kv[1], kv[0])):
        p = by_id.get(pid)
        exposure.append(
            {
                "player_id": pid,
                "player": p.name if p else pid,
                "team": p.team if p else "",
                "position": p.position if p else "",
                "count": used,
                "pct": round(used / built * 100, 1) if built else 0.0,
            }
        )

    if note is None:
        parts = [f"Generated {built} lineups with max {max_overlap} overlapping players."]
        if exposure_cap is not None:
            parts.append(f"Exposure cap: at most {exposure_cap} of {requested} lineups per player (locks exempt).")
        if randomness > 0:
            parts.append(f"Randomness {round(randomness * 100)}% jitters projections between builds.")
        note = " ".join(parts)

    return {
        "ok": True,
        "lineups": lineups,
        "count": built,
        "note": note,
        "exposure": exposure,
    }


def optimize_from_pool_dataframe(
    pool: pd.DataFrame,
    objective: str = "median",
    locked_player_ids: list[str] | None = None,
    excluded_player_ids: list[str] | None = None,
    candidate_player_ids: list[str] | None = None,
    site: str = "seasonal",
    salary_cap: int | None = None,
    block_bye_weeks: bool = True,
    require_qb_stack: bool = False,
    qb_stack_count: int | None = None,
    stack_bring_back: bool = False,
    max_per_team: int | None = None,
    min_salary: int | None = None,
    lineup_count: int = 1,
    max_overlap: int = 4,
    max_exposure: float | None = None,
    randomness: float = 0.0,
    seed: int | None = None,
) -> dict:
    site_cfg = get_site_config(site)
    cap = salary_cap if salary_cap is not None else site_cfg["salary_cap"]
    require_salary = cap is not None
    if max_per_team is None:
        max_per_team = site_cfg.get("max_per_team_default")

    players = _players_from_pool(
        pool,
        objective=objective,
        locked_player_ids=set(locked_player_ids or []),
        excluded_player_ids=set(excluded_player_ids or []),
        candidate_player_ids=set(candidate_player_ids) if candidate_player_ids else None,
        require_salary=require_salary,
        block_bye_weeks=block_bye_weeks,
    )
    opt_kwargs = {
        "objective": objective,
        "locked_player_ids": set(locked_player_ids or []),
        "roster": site_cfg["roster"],
        "salary_cap": cap,
        "flex_positions": site_cfg["flex_positions"],
        "require_qb_stack": require_qb_stack,
        "qb_stack_count": qb_stack_count,
        "stack_bring_back": stack_bring_back,
        "max_per_team": max_per_team,
        "min_salary": min_salary,
        "captain_multiplier": site_cfg.get("captain_multiplier", 1.5),
        "captain_salary_multiplier": site_cfg.get("captain_salary_multiplier", 1.5),
        "captain_label": site_cfg.get("captain_label", "CPT"),
    }
    if lineup_count > 1:
        return optimize_multiple_lineups(
            players,
            count=lineup_count,
            max_overlap=max_overlap,
            max_exposure=max_exposure,
            randomness=randomness,
            seed=seed,
            **opt_kwargs,
        )
    if randomness > 0:
        rng = np.random.default_rng(seed)
        opt_kwargs["objective_noise"] = {
            p.player_id: float(np.clip(rng.normal(1.0, min(randomness, 1.0)), 0.05, None))
            for p in players
        }
    return optimize_lineup(players, **opt_kwargs)
