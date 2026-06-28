"""Fantasy lineup optimization from weekly quantile projections."""

from __future__ import annotations

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
    if site_cfg["roster"].get("dst", 0):
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
            )
        )
    return players


def _stack_constraints(players: list[LineupPlayer], n: int) -> list[LinearConstraint]:
    """If a QB is used, require at least one WR/TE from the same team."""
    constraints: list[LinearConstraint] = []
    for i, qb in enumerate(players):
        if qb.position != "QB":
            continue
        team = qb.team.upper()
        row = np.zeros(n, dtype=float)
        row[i] = -1.0
        for j, p in enumerate(players):
            if p.position in ("WR", "TE") and p.team.upper() == team:
                row[j] = 1.0
        if row.sum() > -1:
            constraints.append(LinearConstraint(row.reshape(1, -1), lb=0, ub=np.inf))
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


def optimize_lineup(
    players: list[LineupPlayer],
    objective: str = "median",
    locked_player_ids: set[str] | None = None,
    roster: dict[str, int] | None = None,
    salary_cap: int | None = None,
    flex_positions: tuple[str, ...] = ("RB", "WR", "TE"),
    require_qb_stack: bool = False,
    extra_constraints: list[LinearConstraint] | None = None,
) -> dict:
    """Maximize projected points (or value) under roster and optional salary-cap constraints."""
    locked_player_ids = locked_player_ids or set()
    roster = roster or get_site_config("seasonal")["roster"]
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

    c = np.array([-_objective_value(p, objective) for p in players], dtype=float)
    integrality = np.ones(n, dtype=int)
    bounds = Bounds(lb=np.zeros(n), ub=np.ones(n))

    constraints: list[LinearConstraint] = []
    constraints.append(LinearConstraint(np.ones((1, n)), lb=total, ub=total))

    def _mask(positions: tuple[str, ...]) -> np.ndarray:
        return np.array([1.0 if p.position in positions else 0.0 for p in players]).reshape(1, -1)

    constraints.append(LinearConstraint(_mask(("QB",)), lb=qb_need, ub=qb_need))
    flex_eligible = tuple(flex_positions)
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
        constraints.append(LinearConstraint(salaries.reshape(1, -1), lb=0, ub=float(salary_cap)))

    for pid in locked_player_ids:
        row = np.zeros((1, n))
        row[0, idx[pid]] = 1.0
        constraints.append(LinearConstraint(row, lb=1, ub=1))

    if require_qb_stack:
        constraints.extend(_stack_constraints(players, n))
    if extra_constraints:
        constraints.extend(extra_constraints)

    result = milp(c, integrality=integrality, bounds=bounds, constraints=constraints)
    if not result.success:
        msg = "Could not find a valid lineup with the current pool and locks."
        if salary_cap is not None:
            msg += " Try raising the cap, importing salaries, or relaxing locks."
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
    if require_qb_stack:
        note_parts.append("QB stack rule: each QB paired with a same-team WR or TE.")
    if salary_cap is not None:
        note_parts.append(f"Salary cap: ${salary_cap:,} · used ${total_salary:,}.")
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
    **kwargs,
) -> dict:
    """Generate diverse lineups by limiting overlap with prior solutions."""
    count = max(1, min(int(count), 20))
    max_overlap = max(0, int(max_overlap))
    lineups: list[dict] = []
    extra: list[LinearConstraint] = []
    n = len(players)
    id_to_idx = {p.player_id: i for i, p in enumerate(players)}

    for _ in range(count):
        result = optimize_lineup(players, extra_constraints=extra, **kwargs)
        if not result.get("ok"):
            if lineups:
                return {
                    "ok": True,
                    "lineups": lineups,
                    "count": len(lineups),
                    "note": result.get("error", "Stopped early — could not diversify further."),
                }
            return result

        lineups.append(result)
        chosen_ids = [row["player_id"] for row in result["lineup"]]
        overlap_row = np.zeros(n, dtype=float)
        for pid in chosen_ids:
            if pid in id_to_idx:
                overlap_row[id_to_idx[pid]] = 1.0
        extra.append(LinearConstraint(overlap_row.reshape(1, -1), lb=0, ub=max_overlap))

    return {
        "ok": True,
        "lineups": lineups,
        "count": len(lineups),
        "note": f"Generated {len(lineups)} lineups with max {max_overlap} overlapping players.",
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
    lineup_count: int = 1,
    max_overlap: int = 4,
) -> dict:
    site_cfg = get_site_config(site)
    cap = salary_cap if salary_cap is not None else site_cfg["salary_cap"]
    require_salary = cap is not None

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
    }
    if lineup_count > 1:
        return optimize_multiple_lineups(
            players,
            count=lineup_count,
            max_overlap=max_overlap,
            **opt_kwargs,
        )
    return optimize_lineup(players, **opt_kwargs)
