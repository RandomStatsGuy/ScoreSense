"""Schedule-aware correlated Monte Carlo season quantile aggregation.

SCORE-2: replaces the naive ``weekly P10/P90 x GAMES_PER_SEASON`` scaling in
``draft_projections.predict_draft_season``. Stacking weekly quantiles is
mathematically invalid — ``Q_tau(sum X_w) != sum Q_tau(X_w)`` — and overstates
season interval width under independence while ignoring byes, game-count
uncertainty, and week-to-week / teammate correlation.

Generative model (one player-week at a time, summed via simulation):

1. **Weekly law** — fit an asymmetric two-piece-normal to each player's
   ``(q10, q50, q90)`` from ``predict_quantiles`` (see ``fit_two_piece_normal``).
2. **Schedule layer** — only scheduled (non-bye) weeks contribute; schedule
   comes from ``src.core.schedule_utils``.
3. **Availability** — games played are drawn from the *same*
   ``expected_preseason_games`` anchor used for ``Season Proj``, via a
   major/minor-injury mixture (season-ending absences + independent
   week-to-week misses), so Proj and the season tails share one games RV
   instead of Proj using E[games] while tails always assume 17.
4. **Dependence** — a low-rank shock structure: a team-week "script" factor
   shared by teammates (``rho_team``) plus AR(1) week-to-week persistence for
   the player's idiosyncratic component (``week_persistence``).
5. **Season quantiles** — empirical P10/P50/P90 of ``sum_w X_w`` across
   simulated paths.

``season_quantile_method`` values:
  - ``"mc_schedule_v1"`` (default) — this module, see ``aggregate_season_quantiles_mc``.
  - ``"independent_scale"`` — legacy ``weekly_q * games_per_season`` behind a
    flag for A/B comparison, see ``legacy_scale_season_quantiles``.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Iterable

import numpy as np
import pandas as pd

from src.core.schedule_utils import regular_season_weeks, teams_on_bye
from src.core.team_codes import normalize_team_to_mlready, normalize_team_to_schedule

# Standard normal 90th percentile (= -10th percentile magnitude); used to moment-match
# the two-piece-normal weekly law to (q10, q50, q90).
Z90 = 1.2815515655446004

METHOD_MC_SCHEDULE_V1 = "mc_schedule_v1"
METHOD_INDEPENDENT_SCALE = "independent_scale"

# Simulation defaults — tuned for stable empirical P10/P90 (~1-2% std error) at
# reasonable runtime over a full position pool (a few hundred players).
DEFAULT_N_SIMS = 1000
DEFAULT_RHO_TEAM = 0.18
DEFAULT_WEEK_PERSISTENCE = 0.25
# Rough per-season base rate of a season-ending injury for a skill-position starter;
# combined with a calibrated minor-miss rate to hit each player's expected games.
DEFAULT_P_MAJOR_INJURY = 0.08
DEFAULT_SEED = 20260101
MIN_MINOR_MISS = 0.0
# Wide enough to reach low games_expected targets (deep backups / committee
# roles) purely via the iid weekly-miss channel without distorting the
# season-ending major-injury rate used for full-time starters.
MAX_MINOR_MISS = 0.92


def _stable_seed(*parts: object) -> int:
    """Deterministic (non-hash-randomized) seed derived from arbitrary parts."""
    key = "|".join(str(p) for p in parts).encode("utf-8")
    return int(hashlib.sha256(key).hexdigest()[:8], 16)


@dataclass(frozen=True)
class SeasonQuantileParams:
    n_sims: int = DEFAULT_N_SIMS
    rho_team: float = DEFAULT_RHO_TEAM
    week_persistence: float = DEFAULT_WEEK_PERSISTENCE
    p_major_injury: float = DEFAULT_P_MAJOR_INJURY
    seed: int = DEFAULT_SEED

    def as_meta(self) -> dict:
        return {
            "n_sims": self.n_sims,
            "rho_team": self.rho_team,
            "week_persistence": self.week_persistence,
            "p_major_injury": self.p_major_injury,
            "seed": self.seed,
        }


@dataclass
class SeasonQuantileResult:
    season_p10: np.ndarray
    season_p50: np.ndarray
    season_p90: np.ndarray
    games_expected: np.ndarray
    method: str
    meta: dict = field(default_factory=dict)

    @property
    def season_spread(self) -> np.ndarray:
        return self.season_p90 - self.season_p10


def fit_two_piece_normal(
    q10: Iterable[float], q50: Iterable[float], q90: Iterable[float]
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Moment-match an asymmetric two-piece-normal weekly law to (q10, q50, q90).

    Returns (mu, sigma_lo, sigma_hi) such that for standard normal z:
        X = mu + sigma_lo * z  if z < 0
        X = mu + sigma_hi * z  if z >= 0
    reproduces q10/q50/q90 exactly (P50 == mu, fixed as in `repair_quantile_order`).
    """
    q10_a = np.asarray(q10, dtype=float)
    q50_a = np.asarray(q50, dtype=float)
    q90_a = np.asarray(q90, dtype=float)
    sigma_lo = np.clip((q50_a - q10_a) / Z90, 1e-3, None)
    sigma_hi = np.clip((q90_a - q50_a) / Z90, 1e-3, None)
    return q50_a, sigma_lo, sigma_hi


def _scheduled_weeks_by_team(season: int, teams: Iterable[str]) -> dict[str, np.ndarray]:
    """Map raw team code -> sorted array of scheduled (non-bye) week numbers."""
    weeks = regular_season_weeks(season)
    bye_keys_by_week: dict[int, set[str]] = {}
    for w in weeks:
        bye = teams_on_bye(season, w)
        keys: set[str] = set()
        for b in bye:
            keys.add(str(b).upper())
            keys.add(normalize_team_to_mlready(b))
            keys.add(normalize_team_to_schedule(b))
        bye_keys_by_week[w] = keys

    schedule: dict[str, np.ndarray] = {}
    for team in sorted({str(t or "").upper() for t in teams}):
        if not team:
            schedule[team] = np.array(weeks, dtype=int)
            continue
        team_ml = normalize_team_to_mlready(team)
        sched_key = normalize_team_to_schedule(team_ml)
        keys = {team, team_ml, sched_key}
        played = [w for w in weeks if not (keys & bye_keys_by_week[w])]
        schedule[team] = np.array(played if played else weeks, dtype=int)
    return schedule


def _calibrate_availability_params(
    n_scheduled: np.ndarray, target_games: np.ndarray, p_major_default: float
) -> tuple[np.ndarray, np.ndarray]:
    """
    Solve per-player (p_minor, p_major) so the major/minor injury mixture
    reproduces `target_games` in expectation, matching the *same*
    `expected_preseason_games` anchor used for `Season Proj`.

    Two regimes so highly durable players (target close to n_scheduled) don't
    get a systematic games-played undershoot from the fixed base major-injury
    rate alone:

    Regime A (typical): hold p_major = p_major_default, solve p_minor from
        E[games] = (1 - p_minor) * [p_major * (n-1)/2 + (1 - p_major) * n]
    Regime B (target too high for regime A, i.e. target > denom at p_minor=0):
        p_minor = 0, solve a reduced p_major from
        E[games] = n - p_major * (n + 1) / 2
    """
    n = np.asarray(n_scheduled, dtype=float)
    target = np.asarray(target_games, dtype=float)
    p_major_default = float(np.clip(p_major_default, 0.0, 1.0))

    denom0 = p_major_default * np.clip(n - 1, 0, None) / 2.0 + (1.0 - p_major_default) * n
    denom0_safe = np.where(denom0 <= 0, np.nan, denom0)
    p_minor_a = np.nan_to_num(1.0 - (target / denom0_safe), nan=0.0)
    p_minor_a = np.clip(p_minor_a, MIN_MINOR_MISS, MAX_MINOR_MISS)

    half_np1 = np.clip((n + 1.0) / 2.0, 1e-6, None)
    p_major_b = np.clip((n - target) / half_np1, 0.0, p_major_default)

    use_b = target > denom0
    p_minor = np.where(use_b, 0.0, p_minor_a)
    p_major = np.where(use_b, p_major_b, p_major_default)
    return p_minor, p_major


def legacy_scale_season_quantiles(
    q10: Iterable[float], q50: Iterable[float], q90: Iterable[float], games_per_season: int
) -> SeasonQuantileResult:
    """Legacy behavior kept for A/B comparison: weekly quantile x games_per_season."""
    q10_a = np.asarray(q10, dtype=float)
    q50_a = np.asarray(q50, dtype=float)
    q90_a = np.asarray(q90, dtype=float)
    games = np.full(q10_a.shape, float(games_per_season))
    return SeasonQuantileResult(
        season_p10=q10_a * games,
        season_p50=q50_a * games,
        season_p90=q90_a * games,
        games_expected=games,
        method=METHOD_INDEPENDENT_SCALE,
        meta={"games_per_season": int(games_per_season)},
    )


def aggregate_season_quantiles_mc(
    q10: pd.Series | Iterable[float],
    q50: pd.Series | Iterable[float],
    q90: pd.Series | Iterable[float],
    teams: pd.Series | Iterable[str],
    games_expected: pd.Series | Iterable[float],
    season: int,
    *,
    params: SeasonQuantileParams | None = None,
) -> SeasonQuantileResult:
    """
    Schedule-aware correlated Monte Carlo season P10/P50/P90.

    `games_expected` must be the *same* per-player expectation used for
    `Season Proj` (`expected_preseason_games`) — this is what fixes the
    Proj-vs-tails inconsistency the naive x17 scale had.
    """
    params = params or SeasonQuantileParams()
    q10_a = np.asarray(q10, dtype=float)
    q50_a = np.asarray(q50, dtype=float)
    q90_a = np.asarray(q90, dtype=float)
    games_target = np.clip(np.asarray(games_expected, dtype=float), 0.0, None)
    n = len(q10_a)
    if n == 0:
        empty = np.array([], dtype=float)
        return SeasonQuantileResult(
            season_p10=empty,
            season_p50=empty,
            season_p90=empty,
            games_expected=empty,
            method=METHOD_MC_SCHEDULE_V1,
            meta={**params.as_meta(), "n_players": 0},
        )

    teams_arr = np.array([str(t or "").upper() for t in teams])
    weeks = regular_season_weeks(season)
    n_weeks = len(weeks)
    week_pos = {w: i for i, w in enumerate(weeks)}

    mu, sigma_lo, sigma_hi = fit_two_piece_normal(q10_a, q50_a, q90_a)

    schedule_by_team = _scheduled_weeks_by_team(season, teams_arr)
    unique_teams = sorted(schedule_by_team.keys())
    team_to_idx = {t: i for i, t in enumerate(unique_teams)}
    team_idx = np.array([team_to_idx.get(t, 0) for t in teams_arr])

    n_sims = int(params.n_sims)

    # Team-week shared "script" shock — deterministic per (season, team, seed) so
    # players on the same team (even across separate qb/rb/wr calls) draw the same
    # game-script factor, giving real cross-position teammate correlation without
    # joint multi-player sampling.
    team_shock = np.empty((len(unique_teams), n_sims, n_weeks), dtype=np.float32)
    for team, idx in team_to_idx.items():
        rng = np.random.default_rng(_stable_seed(season, "team_shock", team, params.seed))
        team_shock[idx] = rng.standard_normal((n_sims, n_weeks)).astype(np.float32)
    team_shock_full = team_shock[team_idx]  # (n, sims, weeks)

    # Player idiosyncratic AR(1) shock — week-to-week persistence (hot/cold streaks).
    player_rng = np.random.default_rng(_stable_seed(season, "player_shock", params.seed, n, n_sims, n_weeks))
    eps = player_rng.standard_normal((n, n_sims, n_weeks)).astype(np.float32)
    phi = float(np.clip(params.week_persistence, 0.0, 0.95))
    u = np.empty_like(eps)
    u[:, :, 0] = eps[:, :, 0]
    carry = np.sqrt(max(1.0 - phi * phi, 0.0))
    for w in range(1, n_weeks):
        u[:, :, w] = phi * u[:, :, w - 1] + carry * eps[:, :, w]

    rho_team = float(np.clip(params.rho_team, 0.0, 1.0))
    shock = np.sqrt(rho_team) * team_shock_full + np.sqrt(max(1.0 - rho_team, 0.0)) * u
    weekly_value = mu[:, None, None] + np.where(
        shock < 0, sigma_lo[:, None, None] * shock, sigma_hi[:, None, None] * shock
    )
    weekly_value = np.clip(weekly_value, 0.0, None)

    # Availability: which scheduled weeks are actually played, per (player, sim).
    played_mask = np.zeros((n, n_sims, n_weeks), dtype=bool)
    p_major = float(np.clip(params.p_major_injury, 0.0, 1.0))
    availability_rng = np.random.default_rng(_stable_seed(season, "availability", params.seed, n, n_sims))
    for team, idx in team_to_idx.items():
        member_mask = team_idx == idx
        if not member_mask.any():
            continue
        sched_weeks = schedule_by_team[team]
        n_sched = len(sched_weeks)
        sched_pos = np.array([week_pos[w] for w in sched_weeks])
        members = np.nonzero(member_mask)[0]
        n_minor_prob, n_major_prob = _calibrate_availability_params(
            np.full(len(members), float(n_sched)), games_target[members], p_major
        )

        major_flag = availability_rng.random((len(members), n_sims)) < n_major_prob[:, None]
        injury_pos = availability_rng.integers(0, max(n_sched, 1), size=(len(members), n_sims))
        minor_miss = availability_rng.random((len(members), n_sims, n_sched)) < n_minor_prob[:, None, None]

        week_range = np.arange(n_sched)[None, None, :]
        eligible = (~major_flag[:, :, None]) | (week_range < injury_pos[:, :, None])
        played_sched = eligible & (~minor_miss)

        played_mask[np.ix_(members, np.arange(n_sims), sched_pos)] = played_sched

    season_sum = (weekly_value * played_mask).sum(axis=2)
    season_p10 = np.percentile(season_sum, 10, axis=1)
    season_p50 = np.percentile(season_sum, 50, axis=1)
    season_p90 = np.percentile(season_sum, 90, axis=1)
    realized_games = played_mask.sum(axis=2).mean(axis=1)

    meta = {
        **params.as_meta(),
        "n_players": int(n),
        "n_weeks": int(n_weeks),
        "season": int(season),
        "avg_realized_games": round(float(realized_games.mean()), 2) if n else None,
        "avg_target_games": round(float(games_target.mean()), 2) if n else None,
    }

    return SeasonQuantileResult(
        season_p10=season_p10,
        season_p50=season_p50,
        season_p90=season_p90,
        games_expected=games_target,
        method=METHOD_MC_SCHEDULE_V1,
        meta=meta,
    )
