/** User-facing copy for Free agents walk-away bid ceiling. */

import { fmtSal } from "./rosterFormat.js";

export const FA_BID_COPY = {
  walkAway: "Walk-away",
  walkAwayPrompt: "Walk away above",
  firstCeiling: "Set your walk-away before this bid posts.",
  placeBid: "Place bid",
  bidding: "Bidding…",
  bidAtCeiling: "Bid at ceiling",
  raiseCeiling: "Raise ceiling",
  pass: "Pass",
  title: "Place FA bid",
  amountLabel: "Bid",
  ceilingLabel: "Walk-away",
};

export function faBidSupport(playerName, amount) {
  const name = playerName || "this player";
  return `Bid ${fmtSal(amount)} on ${name}? The highest bid wins when this window processes — same as post-draft FA.`;
}

export function faWalkawayAbove(ceiling) {
  return `Above your walk-away (${fmtSal(ceiling)})`;
}

export function faWalkawayChip(ceiling) {
  if (ceiling == null) return FA_BID_COPY.walkAway;
  return fmtSal(ceiling);
}
