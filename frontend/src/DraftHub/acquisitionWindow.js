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
  seasonShort: "Season pts",
  perGame: "proj / game",
  range: "range",
  seasonOutlook: "Season outlook",
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
  sortShort: { fair_value: "Bid", season_proj: "Points", risk_score: "Risk", season_spread: "Spread", upside_skew: "Upside", pos_rank: "Rank" },
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
