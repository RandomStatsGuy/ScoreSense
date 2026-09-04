/** User-facing copy for Fantasy → Strategy (face-off + site vs mine). */

import { scoringLabel } from "./strategyRank.js";

export const STRATEGY_RANK_COPY = Object.freeze({
  eyebrow: "Strategy",
  heading: "Take the name you want first.",
  support: "Same position only. The loser waits. Your order can fill the draft queue so you do not nominate the other guy.",
  rankingsHeading: "Which board nominates first?",
  rankingsSupport: "Mine writes the first 40 into the draft queue. Site keeps the model order. The wrong board wastes a nomination.",
  viewRankings: "View my rankings",
  backToCalls: "Back to close calls",
  useMine: "Use my board in Draft",
  useSite: "Use site board",
  take: "Take",
  takeName: (name) => (name ? `Take ${name}` : "Take"),
  skip: "Skip",
  tooClose: "Too close",
  undo: "Undo",
  site: "Site",
  mine: "Mine",
  closeCall: "Close call",
  vs: "OR",
  emptyPair: "No close calls left in this filter. Open All or reset seen pairs.",
  resetSeen: "Reset close calls",
  emptyBoard: "Need available players to rank. Keepers and rostered names stay off this board.",
  loading: "Loading the site board…",
  scoringFallback: "Ranks use Hub PPR until Rules names another scoring profile.",
  feedSaved: "Draft will nominate from your board first.",
  feedSite: "Draft stays on the site order.",
  feedLocal: "Board is ready for Draft on this device.",
  feedError: "Could not write the draft queue.",
  keyboardHint: "← / → to take · Esc skip · Backspace undo",
  bid: "Suggested bid",
  p50: "P50",
  floor: "Floor",
  ceiling: "Ceiling",
  compared: (n) => `${n} compared`,
  moved: (n) => (n === 1 ? "1 name moved" : `${n} names moved`),
  siteRank: (n) => (n ? `site ${n}` : "site"),
  rankingsMineHint: (n) => {
    if (!n) return "Same as site until you take a side.";
    return n === 1 ? "After 1 close call." : `After ${n} close calls.`;
  },
  rankingsSiteHint: (line) => line || "Suggested bid · this league",
  filterAll: "All",
  filterFlex: "FLEX",
});

export function contextLine(ctx = {}) {
  const scoring = scoringLabel(ctx.scoringProfile);
  const draft = ctx.draftType === "snake" || ctx.draftType === "linear"
    ? ctx.draftType
    : "auction";
  const teams = Number(ctx.teamCount) || 12;
  return `${scoring} · ${draft} · ${teams}`;
}

export function takeLabel(row) {
  return STRATEGY_RANK_COPY.takeName(
    String(row?.player || row?.player_name || "").trim().split(/\s+/).filter(Boolean).pop() || "",
  );
}
