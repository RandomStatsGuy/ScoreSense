/** Season P10/P50/P90 helpers for Draft Hub + preseason tables (SCORE-2). */

export const METHOD_MC_SCHEDULE_V1 = "mc_schedule_v1";
export const METHOD_INDEPENDENT_SCALE = "independent_scale";

const SCHEDULE_AWARE_TIP =
  "Schedule-aware 80% season range (bye & games adjusted).";
const PRELIMINARY_TIP =
  "Preseason estimate; calibrated as games are played.";

export function isScheduleAwareMethod(method) {
  return String(method || "") === METHOD_MC_SCHEDULE_V1;
}

export function seasonMethodShortLabel(method) {
  if (isScheduleAwareMethod(method)) return "schedule-aware P10–P90";
  if (String(method || "") === METHOD_INDEPENDENT_SCALE) return "preseason estimate";
  return null;
}

export function seasonRangeTooltip(method, { preliminary = false } = {}) {
  if (preliminary || !isScheduleAwareMethod(method)) return PRELIMINARY_TIP;
  return SCHEDULE_AWARE_TIP;
}

/** Upside skew: (P90−P50) / (P50−P10). >1 favors ceiling; <1 favors floor. */
export function upsideSkew(p10, p50, p90) {
  const lo = Number(p10);
  const mid = Number(p50);
  const hi = Number(p90);
  if (![lo, mid, hi].every(Number.isFinite)) return null;
  const downside = mid - lo;
  if (downside <= 0) return null;
  return (hi - mid) / downside;
}

function pickNum(...candidates) {
  for (const value of candidates) {
    if (value == null || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Resolve a season uncertainty band from hub rows or draft/ROS API rows.
 * Falls back to Floor/Ceiling or naive per-game×17 when calibrated fields are cold.
 */
export function resolveSeasonBand(row, { method: methodOverride, gamesPerSeason = 17 } = {}) {
  if (!row) {
    return {
      p10: null,
      p50: null,
      p90: null,
      spread: null,
      method: methodOverride || null,
      preliminary: true,
      skew: null,
    };
  }

  const method = methodOverride ?? row.season_quantile_method ?? row.seasonQuantileMethod ?? null;
  const p50 = pickNum(
    row.season_p50,
    row.season_proj,
    row["Season P50"],
    row["Season Proj"],
  );
  let p10 = pickNum(
    row.season_p10,
    row["Season P10"],
    row["Season Floor"],
    row["Season Low"],
  );
  let p90 = pickNum(
    row.season_p90,
    row["Season P90"],
    row["Season Ceiling"],
    row["Season High"],
  );

  const hasCalibrated = p10 != null && p90 != null;
  let preliminary = !isScheduleAwareMethod(method) || !hasCalibrated;

  if (!hasCalibrated) {
    const pg10 = pickNum(row.per_game_floor, row["Per-Game Floor"], row["Low (P10)"]);
    const pg90 = pickNum(row.per_game_ceiling, row["Per-Game Ceiling"], row["High (P90)"]);
    const games = pickNum(row.games_expected, gamesPerSeason) ?? gamesPerSeason;
    if (pg10 != null) p10 = Math.round(pg10 * games * 10) / 10;
    if (pg90 != null) p90 = Math.round(pg90 * games * 10) / 10;
    preliminary = true;
  }

  const spread = pickNum(row.season_spread, row["Season Spread"])
    ?? (p10 != null && p90 != null ? Math.round((p90 - p10) * 10) / 10 : null);

  return {
    p10,
    p50,
    p90,
    spread,
    method,
    preliminary,
    skew: upsideSkew(p10, p50, p90),
  };
}

export function formatSeasonPts(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function matchesRiskProfile(band, profile) {
  if (!profile || profile === "ALL") return true;
  const skew = band?.skew;
  if (skew == null) return profile === "ALL";
  if (profile === "UPSIDE") return skew >= 1.15;
  if (profile === "FLOOR") return skew <= 0.85;
  return true;
}
