/** User-facing copy for Fantasy → Trades. */

export const TRADES_COPY = {
  loadingDetails: "Loading trade details",
  title: "Trades",
  eyebrow: "Trades",
  heading: "Build a trade",
  support: "Check each team's cap impact before proposing a trade.",
  purpose: "Choose players, review the cap impact, and send a trade proposal.",
  inviteManagers: "Invite managers",
  noPartners: "No other managers in this league yet.",
  partnerNeeded: "Choose a trade partner",
  partnerPicked: "Partner picked",
  currentRoster: "current roster",
  dead: "dead",
  free: "cap room",
  pickPartnerTitle: "Pick a trade partner",
  pickPartnerSupport: "Compare each team's cap room and roster needs.",
  youPrefix: "You:",
  selectPartner: "Select",
  selectedPartner: "Selected",
  continuePlayers: "Continue to players",
  choosePlayersTitle: "Choose players",
  choosePlayersSupport: "Send moves a player to the other side. Cut drops them for roster space and assigns dead cap.",
  filterBoth: "Search and position apply to both rosters.",
  playerMetaKey: "Each player shows years left, contract type, estimated value versus salary, and projected points per dollar.",
  noPackageYet: "No players in the package yet.",
  packageTitle: "Package",
  sendVerb: "Send",
  getVerb: "Get",
  cutVerb: "Cut",
  reviewTitle: "Review cap impact",
  reviewSupport: "Review salaries, cap room, and roster counts after the trade.",
  proposeTitle: "Propose this trade",
  proposeSupport: "Partners see it in Inbox. Contracts stay put until every team involved accepts.",
  proposeNoteLabel: "Note to partners (optional)",
  proposeNotePlaceholder: "Why this works, or what you want back if they counter.",
  continuePropose: "Continue to propose",
  proposeTrade: "Propose trade",
  proposing: "Sending…",
  checking: "Checking cap and roster…",
  valid: "Trade looks valid — cap and roster limits pass.",
  invalidFallback: "This package does not pass cap or roster limits.",
  stepNeedPartner: "Pick a partner first.",
  stepNeedPackage: "Add at least one send or cut first.",
  ideasBlurb:
    "Trade ideas match your roster depth with other teams' needs.",
  ideasSurplus: "Your extra depth",
  ideasNeeds: "Roster needs",
  ideasEmptyHeading: "No suggested trades",
  inboxEmptyHeading: "No pending proposals",
  inboxEmpty: "Create a proposal to get started. Every team involved must accept.",
  proposalSent: "Proposal sent — waiting for acceptances.",
  loadedPackage: "Trade idea loaded into the builder.",
  multiPartner: (n) => `Multi-team trade · ${n} partners`,
  sendTo: (name, dest) => `Send ${name} to ${dest}`,
  getFrom: (name, src) => `Get ${name} from ${src}`,
  cutPlayer: (name) => `Cut ${name} for roster space`,
  sendBtnYours: "Send →",
  getBtnTheirs: "← Get",
  cutHint: "Cut for roster space; assign dead cap below.",
  dropFlow: (team) => `Cut from ${team}`,
  sendFlow: (from, to) => `${from} → ${to}`,
  notifyLine: (names) =>
    names.length
      ? `${names.join(", ")} will see this in Inbox. Nothing moves until every team involved accepts.`
      : "Every team in the deal must accept before contracts move.",
  whatsNext: "They can accept or reject. You can cancel from Inbox until it executes.",
  extendable: "Extendable",
  expiring: "Expiring",
};

export function tradesCopyForFormat(pickDraft) {
  if (!pickDraft) return TRADES_COPY;
  return {
    ...TRADES_COPY,
    support: "Check each team's roster and positional impact before proposing a trade.",
    purpose: "Choose players, review roster impact, and send a trade proposal.",
    pickPartnerSupport: "Compare each team's roster size and positional needs.",
    choosePlayersSupport: "Send moves a player to the other side. Drop opens a roster spot.",
    playerMetaKey: "Each player shows position and projected production.",
    cutVerb: "Drop",
    cutHint: "Drop for roster space.",
    reviewTitle: "Review roster impact",
    reviewSupport: "Review roster counts and positional balance after the trade.",
    proposeSupport: "Partners see it in Inbox. Rosters stay put until every team involved accepts.",
    checking: "Checking roster limits…",
    valid: "Trade looks valid — roster limits pass.",
    invalidFallback: "This package does not pass roster limits.",
    notifyLine: (names) => names.length
      ? `${names.join(", ")} will see this in Inbox. Nothing moves until every team involved accepts.`
      : "Every team in the deal must accept before rosters change.",
  };
}

export function expireChipLabel(chip) {
  if (chip === "extend") return TRADES_COPY.extendable;
  if (chip === "fa") return TRADES_COPY.expiring;
  return null;
}

export function tradesFreeLabel(salaryCap, fmtSal) {
  return salaryCap != null ? `${TRADES_COPY.free} / ${fmtSal(salaryCap)}` : TRADES_COPY.free;
}

export function stepBlockedReason(stepId, { hasPartner, hasPackage }) {
  if (stepId === "players" && !hasPartner) return TRADES_COPY.stepNeedPartner;
  if ((stepId === "review" || stepId === "propose") && !hasPartner) {
    return TRADES_COPY.stepNeedPartner;
  }
  if ((stepId === "review" || stepId === "propose") && !hasPackage) {
    return TRADES_COPY.stepNeedPackage;
  }
  return "";
}

export const TRADE_DISCOVERY_COPY = {
 title:'Trade partners',search:'Manager, team or player',searchLabel:'Search managers, teams or players',
 ranks:'Projected position ranks',position:'Pos',starters:'Starters',bench:'Bench',cap:'Available Cap',
 impact:'Your trade impact',basis:'PPR projections',season:'This season',remaining:'Remaining games',
 contract:'Contract life',contractMethod:'Same-pace estimate',lineup:'Lineup & depth',efficiency:'Points / $',
 missing:'—',noMatches:'No matching teams',review:'Review trade',close:'Close trade review',
 note:'Add a note',afterAccept:'Moves after everyone accepts.',back:'Change partner',advanced:'Advanced moves',
 projectionDetails:'Projection details',
 rosterMethod:'PPR model projections for remaining games. Starters use the best eligible lineup; bench points cover the remaining roster. Missing forecasts stay unavailable.',
 method:'PPR model projections. Season points cover remaining games. Starters use the best eligible lineup; bench points cover the remaining roster. Contract estimates repeat the full-season outlook for future contracted years; they do not predict aging. Points per dollar compare incoming and outgoing season points against current salaries. Missing forecasts stay unavailable.',
};
