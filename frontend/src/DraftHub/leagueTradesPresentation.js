/** User-facing copy for Fantasy → Trades. */

export const TRADES_COPY = {
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
