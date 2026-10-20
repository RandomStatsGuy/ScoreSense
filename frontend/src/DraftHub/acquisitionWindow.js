/** Players-tab add vs bid vs lock copy. */

export const CLAIM_QUEUE_COPY = {
  title: "My waiver claims",
  support: "Claims run in this order. A successful claim moves your team to the end of priority.",
  empty: "No claims yet. Choose Claim beside a free agent.",
  dropLabel: "Drop if successful",
  noDrop: "No conditional drop",
  moveUp: "Move up",
  moveDown: "Move down",
  cancel: "Cancel claim",
  claimed: "Claimed",
  claiming: "Claiming…",
  protected: "On waiver protection until the next window",
  loadError: "Could not load waiver claims",
  loading: "Loading waiver claims…",
  saveError: "Could not save waiver claims",
  confirmTitle: "Confirm initial waiver priority",
  confirmSupport: "Put first priority at the top. Processing stays blocked until you confirm every team.",
  confirmAction: "Confirm waiver order",
  confirming: "Confirming…",
  confirmError: "Could not confirm waiver priority",
  prioritySet: (priority) => `Priority ${priority ?? "set"}`,
  needsConfirm: "Order needs commissioner confirmation",
};

export const PLAYERS_TAB_COPY = {
  title: "Free agents",
  playerDetails: "Player outlook",
  close: "Close player details",
  floor: "Floor",
  ceiling: "Ceiling",
  seasonShort: "Full-season pts",
  perGame: "proj / game",
  projectedPerGame: "Projected points / game",
  range: "range",
  seasonOutlook: "Full-season outlook",
  rangeGuide: "Full-season points: dot = median; bar = 10th–90th percentile range. Per-game pace uses the same season outlook.",
  rangeGuideTitle: "How to read the outlook",
  suggested: (value) => `$${Math.round(value)} suggested`,
  yourBid: "Your bid",
  ceilingHint: "Walk-away is your personal bid limit, saved on this device.",
  capAfter: (value) => `If won · $${Math.round(value)} cap left before other pending bids`,
  capAvailable: (value) => `$${Math.round(value)} available cap`,
  aboveCeiling: "Above your walk-away. Lower the bid or update your limit.",
  aboveCap: "This bid exceeds your available cap.",
  confirmClaim: "Confirm claim",
  claimInQueue: "Already in your waiver queue",
  onRoster: "Already on your roster",
  readOnly: "Player additions are unavailable",
  addPlayer: "Add player",
  addEffect: "Adds this player to your roster immediately.",
  addSalaryEffect: () => "Adds for $1 on a one-year FA contract that expires before the next draft.",
  starShort: "Star for draft",
  starredShort: "Starred",
  openAdds: "Free agency is open",
  claimCount: (count) => `My claims · ${count}`,
  pos: "Pos",
  sort: "Sort",
  sortShort: { per_game_proj: "Proj / game", fair_value: "Bid", season_proj: "Points", risk_score: "Risk", season_spread: "Spread", upside_skew: "Upside", pos_rank: "Rank" },
  searchFilters: "Search and filters",
  search: "Search players",
  tier: "Tier",
  risk: "Range",
  needs: (positions) => `Needs ${positions.join(" · ")}`,
  reset: "Reset filters",
  count: (count) => `${count} players`,
  loading: "Loading players",
  more: "Show more players",
  openDetails: (name) => `Open ${name} details`,
  add: "Add",
  bid: "Bid",
  claim: "Claim",
  reassign: "Reassign",
  lockedReason: "Adds open after the draft",
  star: "Add to draft watchlist",
  starred: "On draft watchlist",
  unstar: "Remove from draft watchlist",
  howAddsWork: "How adds work",
  nativeInstantTerms: "Instant adds cost $1 for a one-year FA contract that expires before the next draft.",
  howAddsBody:
    "Player additions follow the league calendar. Pick-draft leagues use priority claims during waivers; auction leagues bid. Free agency uses immediate adds.",
  starHint: "Add a player to your draft watchlist.",
  history: "Contract history",
  seasonPts: "Projected season pts",
};

const pg1 = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) : "—");
const signed = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}`;

/** Face-off: your starters beside the pool; every free agent reads against the spot he would take. */
export const FACEOFF_COPY = {
  rosterTitle: "Your roster",
  rosterLabel: "Your roster",
  spotsLabel: "Roster comparisons",
  perGameUnit: "/ game",
  board: "Your lineup",
  was: (value) => `was ${pg1(value)}`,
  bench: "Bench",
  openSpot: "Open spot",
  openSpots: (count) => (count === 1 ? "1 open roster spot" : `${count} open roster spots`),
  tapSpot: "Choose a starter or bench player to compare projected points per game. Amber dots mark your softest starters.",
  shoppingFor: (slot, surname) => `Comparing ${surname} at ${slot} with eligible free agents by projected points per game.`,
  comparing: (surname) => `Comparing ${surname}`,
  benchBest: (position) => `best ${position} replacement`,
  duelBench: (name, surname, delta) => `${name} vs ${surname} on your bench · ${signed(delta)} projected points / game.`,
  verdictPlayerMissing: "This player's projection is unavailable. Free-agent projections are shown without a comparison.",
  shoppingOpen: (slot) => `Shopping for your empty ${slot}. Every eligible player would start.`,
  shoppingBench: "Shopping for an open roster spot. No drop needed.",
  allSpots: "All spots",
  poolShort: "Pool",
  clearShort: "Clear spot",
  clearTarget: "Show all positions",
  fitLabel: (slot) => `fit ${slot}`,
  compareTo: (surname) => `vs ${surname}`,
  compareToOpen: (slot) => `for ${slot}`,
  beatCount: (count) => (count === 1 ? "1 beats him" : `${count} beat him`),
  beatShort: (count) => (count === 1 ? "1 beats" : `${count} beat`),
  beatSlotCount: (count, slot) => (count === 1 ? `1 fits ${slot}` : `${count} fit ${slot}`),
  delta: (value) => signed(value),
  edgeOver: (delta, surname, slot) => `+${pg1(delta)} over ${surname} · ${slot}`,
  edgeNear: (surname) => `Edges ${surname}`,
  edgeDepth: (surname) => `Depth behind ${surname}`,
  edgeEmpty: (slot) => `Fills your empty ${slot}`,
  edgeNoStarter: "No eligible starting spot",
  groupBeat: (count, surname, slot) => (count === 1 ? `1 beats ${surname} at ${slot}` : `${count} beat ${surname} at ${slot}`),
  groupFits: (count, slot) => (count === 1 ? `1 fits your empty ${slot}` : `${count} fit your empty ${slot}`),
  groupDepth: "Depth",
  bestUpgrade: "Best upgrade",
  labelBest: "best upgrade",
  labelBestAt: (slot) => `best at ${slot}`,
  labelNone: "no upgrade",
  verdictPending: (inName, slot, outName) => (outName ? `${inName} in at ${slot}, ${outName} to the bench.` : `${inName} fills ${slot}.`),
  verdictPendingMany: (count, delta) => `${count} pending moves · ${signed(delta)} / game if they all clear.`,
  verdictTarget: (count, surname, pg) => (count === 1 ? `1 free agent beats ${surname} (${pg1(pg)} / game).` : `${count} free agents beat ${surname} (${pg1(pg)} / game).`),
  verdictTargetNone: (surname, pg) => `No free agent beats ${surname} (${pg1(pg)} / game). Your spot is set.`,
  verdictOpen: (count, slot) => (count === 1 ? `1 free agent fits your empty ${slot}.` : `${count} free agents fit your empty ${slot}.`),
  verdictGains: (surname) => `${surname} gains the most.`,
  verdictBest: (name, delta, slot, surname) => `${name} is your best upgrade: +${pg1(delta)} / game at ${slot} over ${surname}.`,
  verdictBestEmpty: (name, delta, slot) => `${name} is your best add: ${pg1(delta)} / game in your empty ${slot}.`,
  verdictSet: "No free agent starts over your lineup today.",
  verdictMissing: "Some starters have no projection yet, so the lineup total is unavailable.",
  verdictNoRoster: "Your roster is empty. Every free agent fills a starting spot.",
  afterLabel: "if the bid wins",
  afterLabelClaim: "if the claim clears",
  afterLabelAdd: "after the add",
  afterAllBid: "if every bid wins",
  afterAllClaim: "if every claim clears",
  lineupAfter: (before, after, label) => `Lineup ${pg1(before)} → ${pg1(after)} / game ${label}`,
  duelHead: (name, delta, surname, slot) =>
    delta == null ? "No projection yet, so there is nothing to compare."
      : delta >= 1 ? `${name} starts at ${slot}, ${surname} to the bench`
        : delta > 0 ? `Close call at ${slot}`
          : `${surname} keeps ${slot}`,
  duelHeadEmpty: (name, slot) => `${name} fills your empty ${slot}`,
  duelNote: (name, surname) => `The mark is ${surname}'s season pace. The amber part of ${name}'s range beats him.`,
  duelUnavailable: "No projection yet, so there is nothing to compare.",
  rosterSpot: "Roster spot",
  rosterSpotOpen: "Open spot · no drop",
  rosterSpotOpenCount: (count) => (count === 1 ? "1 open roster spot · no drop needed." : `${count} open roster spots · no drop needed.`),
  rosterSpotHint: "Your roster is full. Choose who leaves if the claim clears.",
  rosterSpotFullBid: "Your roster is full. You will choose who leaves if the bid wins.",
  rosterSpotFullAdd: "Your roster is full. Make room on My team first.",
  pendingIn: (surname, label) => `${surname} in ${label}`,
  pendingBid: "Bid pending",
  bidIn: "Bid in",
  savedKicker: "Saved",
  savedBid: (name, amount, high, delta) => `Bid $${Math.round(amount)} on ${name}.${high != null ? ` High bid is $${Math.round(high)}.` : ""}${delta != null && delta > 0 ? ` ${signed(delta)} / game if it wins.` : ""}`,
  savedClaim: (name, order, delta) => `Claim ${order} on ${name}.${delta != null && delta > 0 ? ` ${signed(delta)} / game if it clears.` : ""}`,
  savedAdd: (name, delta) => `${name} added.${delta != null && delta > 0 ? ` ${signed(delta)} / game.` : ""}`,
  undone: (name) => `${name} is back in the pool with no claim.`,
  tickKey: (surname, season) => `${surname} ${season}`,
  rangeGuideTick: "The thin mark is the starter he would replace, at his season pace; the amber part of the bar beats him.",
  howFaceoff: "Choose a starter or bench player to compare eligible free agents by projected points per game. Comparing a player does not drop him. Claims keep a separate conditional-drop choice. Pending moves show where they would land in your lineup.",
  undo: "Undo",
};

export function playersTabAddMode(window, { inLeague = false, draftConsole = false } = {}) {
  if (draftConsole) return "hidden";
  if (!inLeague) return "add";
  const mode = String(window?.add_mode || "locked");
  if (mode === "add" || mode === "bid" || mode === "claim" || mode === "locked") return mode;
  return "locked";
}

export function playersTabBusyLabel(mode) {
  if (mode === "bid") return "Bidding…";
  if (mode === "claim") return CLAIM_QUEUE_COPY.claiming;
  return "Adding…";
}

export function playersTabClaimedLabel() {
  return CLAIM_QUEUE_COPY.claimed;
}

export function playersTabAddLabel(mode, { taken = false, isCommissioner = false } = {}) {
  if (mode === "bid") return PLAYERS_TAB_COPY.bid;
  if (mode === "claim") return PLAYERS_TAB_COPY.claim;
  if (taken && isCommissioner) return PLAYERS_TAB_COPY.reassign;
  return PLAYERS_TAB_COPY.add;
}

export function playersTabAddDisabledReason(mode) {
  if (mode === "locked") return PLAYERS_TAB_COPY.lockedReason;
  return "";
}

export function playersTabStarCopy(starred = false) {
  return starred ? PLAYERS_TAB_COPY.starred : PLAYERS_TAB_COPY.star;
}

export function playerTradeableInWindow(row, window) {
  if (!window || window.trade_scope !== "surviving_contracts") return true;
  if (String(row?.acquisition_type || row?.contract?.acquisition_type || "").toLowerCase() === "fa_contract") {
    return false;
  }
  const pending = row?.contract?.pending_extension || row?.pending_extension;
  if (pending && typeof pending === "object") return true;
  const yrs = Number(row?.years_remaining ?? row?.contract?.years_remaining ?? row?.contract_years ?? 1);
  return Number.isFinite(yrs) && yrs > 1;
}

export function playersTabLockedChip() {
  return {
    label: "Locked",
    popover: PLAYERS_TAB_COPY.lockedReason,
  };
}

export function playersTabBanner(window) {
  if (!window) return null;
  return {
    variant: window.add_mode === "locked" ? "warn" : ["bid", "claim"].includes(window.add_mode) ? "warn" : "info",
    text: window.message || window.label,
    label: window.label,
  };
}

export function tradesWindowBanner(window) {
  if (!window || window.trade_scope !== "surviving_contracts") return null;
  return {
    variant: "info",
    text: window.message
      || "Offseason trades are limited to contracts that continue beyond the upcoming draft.",
    label: window.label || "Offseason",
  };
}
