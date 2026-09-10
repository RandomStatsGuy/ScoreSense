import { scoringLabel } from "./strategyRank.js";
import { riskToleranceLabel } from "../riskAdjustedValue.js";

/** Suggested bid sub-label bound to Rules scoring + risk posture. */
export function suggestedBidSubLabel({
  scoringProfile,
  riskTolerance,
} = {}) {
  const scoring = scoringLabel(scoringProfile);
  const posture = riskToleranceLabel(riskTolerance);
  return `${scoring} · ${posture} pricing`;
}
