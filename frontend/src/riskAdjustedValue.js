/** SCORE-3: Risk-Adjusted Auction Value helpers (mirrors auction_values.py). */

/** Must match `src.draft_hub.auction_values.RISK_WEIGHT`. */
export const RISK_WEIGHT = 0.12;

export const RISK_TOLERANCE_OPTIONS = [
  {
    id: "conservative",
    label: "Conservative",
    value: -1,
    hint: "Pay up for floor; discount boom/bust",
  },
  {
    id: "balanced",
    label: "Balanced",
    value: 0,
    hint: "Neutral — median Season Proj pricing",
  },
  {
    id: "aggressive",
    label: "Aggressive",
    value: 1,
    hint: "Premium for ceiling / high variance",
  },
];

const RISK_EPS = 1e-9;

export function normalizeRiskTolerance(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= -0.5) return -1;
  if (n >= 0.5) return 1;
  return 0;
}

export function riskToleranceLabel(value) {
  const tol = normalizeRiskTolerance(value);
  return RISK_TOLERANCE_OPTIONS.find((o) => o.value === tol)?.label || "Balanced";
}

export function isRiskToleranceActive(value) {
  return Math.abs(normalizeRiskTolerance(value)) >= RISK_EPS
    || (Number.isFinite(Number(value)) && Math.abs(Number(value)) >= RISK_EPS);
}

/**
 * Client-side RAAV preview (no position-group renormalization).
 * Backend `risk_adjusted_value` remains source of truth after save.
 */
export function computeRiskAdjustedValue(
  fairValue,
  riskScore,
  riskTolerance,
  { minBid = 1, salaryCap = 200, riskWeight = RISK_WEIGHT } = {},
) {
  const fair = Number(fairValue);
  const tol = Number(riskTolerance);
  if (!Number.isFinite(fair)) return null;
  if (!Number.isFinite(tol) || Math.abs(tol) < RISK_EPS) return null;
  const z = Number(riskScore);
  const riskZ = Number.isFinite(z) ? z : 0;
  const raw = fair * (1 + tol * Number(riskWeight) * riskZ);
  const lo = Number(minBid);
  const hi = Number(salaryCap) * 0.25;
  const floor = Number.isFinite(lo) ? lo : 1;
  const ceil = Number.isFinite(hi) ? hi : fair;
  return Math.round(Math.max(floor, Math.min(ceil, raw)));
}

/** Prefer backend RAAV; fall back to client preview when tolerance is non-zero. */
export function resolveRiskAdjustedValue(row, riskTolerance, rules) {
  const backend = row?.risk_adjusted_value;
  if (backend != null && Number.isFinite(Number(backend))) {
    return Number(backend);
  }
  const tol = riskTolerance ?? rules?.risk_tolerance ?? 0;
  if (!isRiskToleranceActive(tol)) return null;
  const fair = row?.fair_value ?? row?.model_bid_hint;
  return computeRiskAdjustedValue(fair, row?.risk_score, tol, {
    minBid: rules?.auction?.min_bid ?? 1,
    salaryCap: rules?.salary_cap ?? 200,
  });
}

/** Primary auction bid recommendation for display / nomination defaults. */
export function effectiveAuctionBid(row, riskTolerance, rules) {
  const raav = resolveRiskAdjustedValue(row, riskTolerance, rules);
  if (raav != null) return raav;
  const fair = row?.fair_value ?? row?.model_bid_hint;
  return fair != null && Number.isFinite(Number(fair)) ? Number(fair) : null;
}

export function raavDelta(row, riskTolerance, rules) {
  const fair = row?.fair_value ?? row?.model_bid_hint;
  const raav = resolveRiskAdjustedValue(row, riskTolerance, rules);
  if (fair == null || raav == null) return null;
  const fairN = Number(fair);
  if (!Number.isFinite(fairN)) return null;
  return raav - fairN;
}

export function formatRaavDelta(delta) {
  const n = Number(delta);
  if (!Number.isFinite(n) || Math.abs(n) < 0.5) return null;
  const rounded = Math.round(n);
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}$${Math.abs(rounded)}`;
}

export function formatRiskScore(score, digits = 2) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}`;
}

/** Education copy — same voice as seasonRangeTooltip(). */
export function raavDeltaTooltip({ delta, riskTolerance, riskScore } = {}) {
  const stance = riskToleranceLabel(riskTolerance);
  const deltaLabel = formatRaavDelta(delta);
  const z = Number(riskScore);
  const zPart = Number.isFinite(z)
    ? ` Risk score ${formatRiskScore(z)} (position-normalized variance).`
    : "";
  if (!deltaLabel) {
    return `${stance} bidding stance — risk-adjusted $ matches fair value.${zPart}`;
  }
  if (delta > 0) {
    return (
      `${deltaLabel} vs fair — ${stance} stance pays a premium for this player's `
      + `variance profile.${zPart}`
    );
  }
  return (
    `${deltaLabel} vs fair — ${stance} stance discounts this player's `
    + `variance profile.${zPart}`
  );
}

export function riskScoreTooltip() {
  return (
    "Position-normalized risk (z-score of season P10–P90 width). "
    + "Higher = more boom/bust vs peers at the same position."
  );
}
