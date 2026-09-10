/** User-facing copy for Fantasy → Strategy (face-off + site vs mine). */

import { scoringLabel } from "./strategyRank.js";

export const STRATEGY_RANK_COPY = Object.freeze({
  eyebrow: "Strategy",
  heading: "Choose the player you would draft first to adjust your rankings.",
  support: "Compare players at the same position to build your draft rankings.",
  rankingsHeading: "Choose your draft queue order",
  rankingsSupport: "Using your rankings replaces your draft queue with your top 40 players and keeps it updated as you rank. Using ScoreSense rankings clears your custom queue.",
  viewRankings: "View my rankings",
  backToCalls: "Back to close calls",
  useMine: "Use my rankings",
  useSite: "Use ScoreSense rankings",
  take: "Rank higher",
  takeName: (name) => (name ? `Rank ${name} higher` : "Rank higher"),
  skip: "Skip",
  tooClose: "No preference",
  undo: "Undo",
  site: "ScoreSense rankings",
  mine: "My rankings",
  closeCall: "Who would you draft first?",
  vs: "OR",
  emptyPair: "No close calls left in this filter. Open All or reset seen pairs.",
  emptyPairAll: "No close calls left. Reset seen pairs or open your rankings.",
  resetSeen: "Reset close calls",
  emptyBoard: "No available players to rank. Keepers and rostered players are excluded.",
  loading: "Loading ScoreSense rankings…",
  scoringFallback: "Rankings use PPR scoring by default.",
  feedSaved: "Your rankings are saved to the draft queue.",
  feedSite: "The draft queue uses ScoreSense rankings.",
  feedLocal: "Your rankings are ready for Draft on this device.",
  feedError: "Could not save the draft queue.",
  keyboardHint: "← / → to rank higher · Esc skip · Backspace undo",
  bid: "Suggested bid",
  p50: "Projected pts",
  floor: "Low estimate",
  ceiling: "High estimate",
  compared: (n) => `${n} compared`,
  moved: (n) => (n === 1 ? "1 player reordered" : n === 0 ? "No ranking changes yet" : `${n} players reordered`),
  siteRank: (n) => (n ? `ScoreSense rank: ${n}` : "ScoreSense rank"),
  rankingsMineHint: (n) => {
    if (!n) return "Your rankings match ScoreSense until you make a choice.";
    return n === 1 ? "After 1 close call." : `After ${n} close calls.`;
  },
  rankingsSiteHint: (line) => line || "Suggested bid · this league",
  filterAll: "All",
  filterFlex: "FLEX",
});

export function contextLine(ctx = {}) {
  const scoring = scoringLabel(ctx.scoringProfile);
  const name = String(ctx.leagueName || "").trim();
  if (name) return `${name} · ${scoring}`;
  return scoring;
}

export function takeLabel(row) {
  return STRATEGY_RANK_COPY.takeName(
    String(row?.player || row?.player_name || "").trim().split(/\s+/).filter(Boolean).pop() || "",
  );
}
