/**
 * SCORE-26 — Opportunity adjustment (formerly "Injury Boost").
 *
 * Prediction rows may expose the canonical column, snake_case API keys,
 * and/or the temporary "Injury Boost" alias during rollout.
 */

export const OPPORTUNITY_ADJUSTMENT_COL = "Opportunity Adjustment";
export const OPPORTUNITY_ADJUSTMENT_LEGACY_COL = "Injury Boost";

/** Prefer canonical keys, then legacy alias (matches backend pick_opportunity_adjustment). */
export const OPPORTUNITY_ADJUSTMENT_KEYS = [
  OPPORTUNITY_ADJUSTMENT_COL,
  "opportunity_adjustment",
  OPPORTUNITY_ADJUSTMENT_LEGACY_COL,
  "injury_boost",
];

/**
 * Read the fractional opportunity adjustment from a projection row.
 * Skips nested player-context objects (those use `.points`).
 * @returns {number|null}
 */
export function pickOpportunityAdjustment(row) {
  if (!row || typeof row !== "object") return null;
  for (const key of OPPORTUNITY_ADJUSTMENT_KEYS) {
    const raw = row[key];
    if (raw == null || raw === "") continue;
    if (typeof raw === "object") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** True when the slate has any non-zero opportunity adjustment. */
export function slateHasOpportunityAdjustment(rows) {
  return (rows || []).some((row) => {
    const n = pickOpportunityAdjustment(row);
    return n != null && n !== 0;
  });
}

/**
 * Format fraction as a signed percent label, e.g. "+15%".
 * @returns {string|null}
 */
export function formatOpportunityAdjustmentPct(rowOrValue) {
  const n =
    typeof rowOrValue === "number" || rowOrValue == null
      ? Number(rowOrValue)
      : pickOpportunityAdjustment(rowOrValue);
  if (!Number.isFinite(n) || n === 0) return null;
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(0)}%`;
}

/** CSS tone class for table cells (keeps existing injury-* tokens). */
export function opportunityAdjustmentClass(boost) {
  const n = Number(boost);
  if (!Number.isFinite(n) || n === 0) return "injury-neutral";
  return n > 0 ? "injury-pos" : "injury-neg";
}
