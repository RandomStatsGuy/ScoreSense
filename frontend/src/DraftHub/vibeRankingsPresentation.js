/** User-facing copy and demo slate for Fantasy → Vibes. */

export const VIBE_COPY = Object.freeze({
  eyebrow: "Vibes",
  heading: "Start or sit each name once today.",
  support: "Start raises a name's aura; sit lowers it. Skip a card and its rank stays the site board.",
  chip: "Your read",
  chipDemo: "Demo slate",
  sit: "Sit",
  start: "Start",
  undo: "Undo",
  resetDeck: "Reshuffle",
  clearAura: "Clear aura",
  deckProgress: (index, total) => `${Math.min(index + 1, total)} of ${total}`,
  deckDoneHeading: "Today's reads are in.",
  deckDoneSupport: "Aura already moved the week numbers. Come back tomorrow or set the lineup on This Week.",
  emptyHeading: "Need a roster to read.",
  emptySupport: "Add contracts or sync the league. Without a roster there is no start/sit to lock.",
  loading: "Loading this week's roster…",
  error: "Could not load the week. Try again from This Week.",
  keyboardHint: "← sit · → start · Backspace undo",
  swipeHint: "Swipe to rate. The arrow opens the profile.",
  profileAbout: "About",
  profileLatest: "Latest",
  profileEmptyNews: "No new note this week.",
  openMore: "Open bio and latest note",
  closeMore: "Close profile",
  matchupSite: "Site",
  matchupWeather: "Weather",
  matchupLine: "Line",
  railTitle: "Vibe ranking",
  railSubtitle: (weekLabel) => weekLabel || "This week",
  cardsLeft: "Cards left",
  rated: "Today",
  hottest: "Hottest",
  nextAction: "Review on This Week",
  nextActionDisabled: "Rate someone today to lock VA-projections.",
  slateTitle: "VA-projections",
  slateHint: "Vibe-adjusted week. Aura scales the number. Bye and injured stay out.",
  vsModel: "Vibe vs the board",
  vsModelEmpty: "Your vibes have not moved a start yet.",
  vsYours: "Your vibe",
  vsBoard: "The board",
  vsModelLine: (start, sit) => `Your vibe starts ${start}. The board starts ${sit}.`,
  openMoreNamed: (name) => (name ? `Open bio for ${name}` : "Open bio and latest note"),
  emptyK: "No kicker rostered",
  emptyDef: "No defense rostered",
  auraLabel: "Aura",
  weekProj: "Week",
  vibeProj: "Vibe week",
  opponent: "Opp",
  onBye: "Bye",
  injured: "Out",
  demoNote: "",
  stampStart: "Start",
  stampSit: "Sit",
  resultsCta: "Review on This Week",
  resultsAgain: "Swipe again",
  lockedToday: "You've read this roster today. Come back tomorrow to nudge again.",
});

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
      chip: VIBE_COPY.chip,
      chipTone: "readonly",
    };
  }
  if (done) {
    return {
      heading: VIBE_COPY.deckDoneHeading,
      support: VIBE_COPY.deckDoneSupport,
      chip: demo ? VIBE_COPY.chipDemo : VIBE_COPY.chip,
      chipTone: "active",
    };
  }
  return {
    heading: VIBE_COPY.heading,
    support: VIBE_COPY.support,
    chip: demo ? VIBE_COPY.chipDemo : VIBE_COPY.chip,
    chipTone: demo ? "readonly" : "active",
  };
}

/** Starter plan for the demo slate — includes K/DEF so VA-projections is a full week. */
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

export function emptySlotName(position) {
  const pos = String(position || "").toUpperCase();
  if (pos === "K") return VIBE_COPY.emptyK;
  if (pos === "DEF") return VIBE_COPY.emptyDef;
  return "—";
}

export function opponentLabel(player) {
  const opp = String(player?.opponent || "").replace(/^@/, "").trim();
  if (!opp) return "—";
  const home = !String(player?.opponent || "").startsWith("@");
  return home ? `vs ${opp}` : `@ ${opp}`;
}
