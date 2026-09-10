/** User-facing copy and demo slate for Fantasy → Vibes. */

import { WEEK_BOARD_COPY } from "./weekBoard.js";
import { formatAura, formatPts, formatPtsDelta, readAura, vibeScore } from "./vibeAura.js";

export const VIBE_COPY = Object.freeze({
  eyebrow: "Vibes",
  heading: "How do you feel about your players this week?",
  support: "Rate each player higher or lower once a day to adjust your Vibes score. Ratings do not save your lineup.",
  chip: "Your read",
  chipDemo: "Demo slate",
  sit: "Lower",
  start: "Higher",
  undo: "Undo",
  undoDisabled: "Nothing to undo yet.",
  rateGroup: "Rate this player",
  resetDeck: "Reshuffle",
  clearAura: "Clear Vibes ratings",
  deckProgress: (index, total) => `${Math.min(index + 1, total)} of ${total}`,
  deckDoneHeading: "Your ratings are saved.",
  deckDoneSupport: "Review your adjusted projections below. Use Save lineup to apply the suggested lineup when available.",
  emptyHeading: "Add players to start rating.",
  emptySupport: "Add players to your team or sync your league to see your roster here.",
  loading: "Loading this week's roster…",
  error: "Could not load the week. Try again from This Week.",
  keyboardHint: "← lower · → higher · Backspace undo",
  swipeHint: "Swipe left to rate lower or right to rate higher. Open player details for updates.",
  desktopHint: "Rate higher or lower. Open player details for updates.",
  profileAbout: "About",
  profileLatest: "Latest",
  profileEmptyNews: "No player updates available for this week.",
  openMore: "Open player details",
  closeMore: "Close player details",
  moreLabel: "Player details",
  matchupSite: "Game location",
  matchupWeather: "Venue / weather",
  matchupLine: "Line",
  railTitle: "Vibe ranking",
  railSubtitle: (weekLabel) => weekLabel || "This week",
  cardsLeft: "Cards left",
  rated: "Today",
  hottest: "Highest-rated player",
  nextAction: "Review on This Week",
  nextActionDisabled: "Rate a player to review your choices on This Week.",
  setSlate: "Save lineup",
  setSlateBusy: "Saving lineup…",
  setSlateError: "Could not save the lineup. Review it on This Week or try again.",
  slateTitle: "Vibes-adjusted projections",
  slateHint: "These projections include your Vibes ratings. This Week shows the original model projections.",
  vsModel: "Where Vibes changes the suggested lineup",
  vsModelEmpty: "No lineup differences yet.",
  vsModelSource: "Compares the suggested lineups using Vibes-adjusted and model projections.",
  vsModelSourcePrior: "Based on your earlier ratings. You have not rated players today.",
  vsYours: "Your vibe",
  vsBoard: "Model",
  vsDelta: "Δ",
  openMoreNamed: (name) => (name ? `Open player details for ${name}` : "Open player details"),
  emptySlot: "Empty",
  auraLabel: "Vibes score",
  auraScale: "0–99",
  auraMeter: "Vibes score, 0 to 99",
  weekProj: "Model projection",
  vibeProj: "Adjusted projection",
  weekCompare: "Model and Vibes-adjusted projections",
  opponent: "Opp",
  onBye: "Bye",
  injured: "Out",
  demoNote: "",
  stampStart: "Higher",
  stampSit: "Lower",
  resultsCta: "Review on This Week",
  resultsAgain: "Rate again",
  lockedToday: "You have rated your players today. Come back tomorrow to update your ratings.",
  todayReadsTitle: "Today's ratings",
});

export function todayReadRows(players, votes) {
  const rated = votes && typeof votes === "object" ? votes : {};
  return (players || []).flatMap((player) => {
    const id = String(player?.player_id || "");
    if (!id || !Object.prototype.hasOwnProperty.call(rated, id)) return [];
    return [{
      id,
      name: player.player_name || "—",
      vibe: rated[id] === "sit" ? VIBE_COPY.stampSit : VIBE_COPY.stampStart,
    }];
  });
}

export const DEMO_VIBE_SLATE = Object.freeze([
  {
    player_id: "demo-allen",
    player_name: "Josh Allen",
    position: "QB",
    team: "BUF",
    opponent: "MIA",
    p10: 16.4,
    p50: 23.1,
    p90: 31.8,
    espn_id: 3918298,
    lineup_role: "starter",
    slot: "QB",
  },
  {
    player_id: "demo-bijan",
    player_name: "Bijan Robinson",
    position: "RB",
    team: "ATL",
    opponent: "TB",
    p10: 11.2,
    p50: 17.6,
    p90: 26.4,
    espn_id: 4430807,
    lineup_role: "starter",
    slot: "RB1",
  },
  {
    player_id: "demo-gibbs",
    player_name: "Jahmyr Gibbs",
    position: "RB",
    team: "DET",
    opponent: "GB",
    p10: 9.8,
    p50: 16.4,
    p90: 25.1,
    espn_id: 4429795,
    lineup_role: "starter",
    slot: "RB2",
  },
  {
    player_id: "demo-jefferson",
    player_name: "Justin Jefferson",
    position: "WR",
    team: "MIN",
    opponent: "CHI",
    p10: 10.1,
    p50: 16.9,
    p90: 25.8,
    espn_id: 4262921,
    lineup_role: "starter",
    slot: "WR1",
  },
  {
    player_id: "demo-puka",
    player_name: "Puka Nacua",
    position: "WR",
    team: "LAR",
    opponent: "SEA",
    p10: 9.4,
    p50: 15.8,
    p90: 24.6,
    espn_id: 4688813,
    lineup_role: "starter",
    slot: "WR2",
  },
  {
    player_id: "demo-cd",
    player_name: "CeeDee Lamb",
    position: "WR",
    team: "DAL",
    opponent: "NYG",
    p10: 8.6,
    p50: 14.2,
    p90: 22.4,
    espn_id: 4241389,
    lineup_role: "bench",
    slot: null,
  },
  {
    player_id: "demo-bowers",
    player_name: "Brock Bowers",
    position: "TE",
    team: "LV",
    opponent: "DEN",
    p10: 7.2,
    p50: 12.4,
    p90: 19.1,
    espn_id: 4431458,
    lineup_role: "starter",
    slot: "TE",
  },
  {
    player_id: "demo-kittle",
    player_name: "George Kittle",
    position: "TE",
    team: "SF",
    opponent: "ARI",
    p10: 6.4,
    p50: 11.1,
    p90: 17.8,
    espn_id: 3040151,
    lineup_role: "bench",
    slot: null,
  },
  {
    player_id: "demo-saquon",
    player_name: "Saquon Barkley",
    position: "RB",
    team: "PHI",
    opponent: "WAS",
    p10: 8.8,
    p50: 15.1,
    p90: 23.6,
    espn_id: 3929630,
    lineup_role: "bench",
    slot: null,
  },
  {
    player_id: "demo-sun-god",
    player_name: "Amon-Ra St. Brown",
    position: "WR",
    team: "DET",
    opponent: "GB",
    p10: 8.9,
    p50: 14.8,
    p90: 22.9,
    espn_id: 4374302,
    lineup_role: "starter",
    slot: "FLEX",
  },
  {
    player_id: "demo-bates",
    player_name: "Jake Bates",
    position: "K",
    team: "DET",
    opponent: "GB",
    p10: 6.8,
    p50: 8.4,
    p90: 10.6,
    espn_id: 4875680,
    lineup_role: "starter",
    slot: "K",
  },
  {
    player_id: "demo-lions-def",
    player_name: "Lions",
    position: "DEF",
    team: "DET",
    opponent: "GB",
    p10: 5.1,
    p50: 7.6,
    p90: 11.8,
    espn_id: null,
    lineup_role: "starter",
    slot: "DEF",
  },
]);

export function espnHeadshotUrl(espnId) {
  const id = Number(espnId);
  if (!Number.isFinite(id) || id <= 0) return null;
  return `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`;
}

export function deckPlayers(weekPayload) {
  const starters = weekPayload?.roster?.starters || [];
  const bench = weekPayload?.roster?.bench || [];
  const merged = [...starters, ...bench].filter((row) => row?.player_id && row?.player_name);
  return merged;
}

export function heroCopy({ demo = false, empty = false, done = false } = {}) {
  if (empty) {
    return {
      heading: VIBE_COPY.emptyHeading,
      support: VIBE_COPY.emptySupport,
      chip: "",
      chipTone: "readonly",
    };
  }
  if (done) {
    return {
      heading: VIBE_COPY.deckDoneHeading,
      support: VIBE_COPY.deckDoneSupport,
      chip: demo ? VIBE_COPY.chipDemo : "",
      chipTone: "readonly",
    };
  }
  return {
    heading: VIBE_COPY.heading,
    support: VIBE_COPY.support,
    chip: demo ? VIBE_COPY.chipDemo : "",
    chipTone: "readonly",
  };
}

/** Starter plan for the demo slate — includes K/DEF so Vibes-adjusted projections is a full week. */
export const DEMO_VIBE_RULES = Object.freeze({
  roster: {
    qb: { starter: 1 },
    rb: { starter: 2 },
    wr: { starter: 2 },
    te: { starter: 1 },
    flex: { starter: 1 },
    k: { starter: 1 },
    def: { starter: 1 },
  },
});

export function emptySlotName() {
  return VIBE_COPY.emptySlot;
}

export function emptySlotCta(position) {
  const pos = String(position || "").replace(/\d+$/, "").toUpperCase();
  return WEEK_BOARD_COPY.emptySlot(pos || "player");
}

export function rateHint({ coarse = false } = {}) {
  return coarse
    ? VIBE_COPY.swipeHint
    : `${VIBE_COPY.desktopHint} ${VIBE_COPY.keyboardHint}`;
}

export function hottestLabel(leaders) {
  const list = Array.isArray(leaders) ? leaders : (leaders ? [leaders] : []);
  const top = list[0];
  if (!top?.player) return "—";
  const week = formatPts(top.player.p50);
  const tied = list[1] && Number(list[1].aura) === Number(top.aura);
  const base = `${top.player.player_name} · ${formatAura(top.aura)} · ${week} projected pts`;
  return tied ? `${base} (model projection tiebreak)` : base;
}

export function vsSplitRows(pairs, auraById) {
  return (pairs || []).map((pair) => {
    const yours = vibeScore(pair.start, readAura(auraById, pair.start?.player_id));
    const board = Number(pair.sit?.p50);
    const boardPts = Number.isFinite(board) ? board : 0;
    return {
      key: `${pair.start?.player_id || ""}-${pair.sit?.player_id || ""}`,
      yoursName: pair.start?.player_name || "—",
      yoursPts: yours,
      boardName: pair.sit?.player_name || "—",
      boardPts,
      delta: yours - boardPts,
    };
  });
}

export function vsModelNote({ ratedToday = 0, pairCount = 0, hasStoredAura = false } = {}) {
  if (!pairCount) return VIBE_COPY.vsModelEmpty;
  if (ratedToday === 0 && hasStoredAura) return VIBE_COPY.vsModelSourcePrior;
  if (ratedToday === 0) return VIBE_COPY.vsModelEmpty;
  return VIBE_COPY.vsModelSource;
}

export { formatPtsDelta };

export function opponentLabel(player) {
  const opp = String(player?.opponent || "").replace(/^@/, "").trim();
  if (!opp) return "—";
  const home = !String(player?.opponent || "").startsWith("@");
  return home ? `vs ${opp}` : `@ ${opp}`;
}

export function vibeNextActions({ canReview = false, canEdit = false } = {}) {
  if (!canReview) return { primary: null, review: false, apply: false };
  if (canEdit) return { primary: "apply", review: true, apply: true };
  return { primary: "review", review: true, apply: false };
}
