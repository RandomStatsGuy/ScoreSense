/** User-facing copy for Fantasy → Trades. */

export const TRADES_COPY = {
  title: "Trades",
  eyebrow: "Trades",
  heading: "Can you fit the deal under both caps?",
  support: "A swap that busts a cap is voided before anyone accepts.",
  purpose: "Send a deal. Cap impact and approvals show before anyone accepts. A bad swap can strand you over the cap.",
  inviteManagers: "Invite managers",
  noPartners: "No other managers in this league yet.",
  partnerNeeded: "Need a partner",
  partnerPicked: "Partner picked",
  currentRoster: "current roster",
  dead: "dead",
  free: "free",
  pickPartnerTitle: "Pick a trade partner",
  pickPartnerSupport: "Cap room and thin spots sit on each card so you are not choosing blind.",
  youPrefix: "You:",
  selectPartner: "Select",
  selectedPartner: "Selected",
  continuePlayers: "Continue to players",
  choosePlayersTitle: "Choose players",
  choosePlayersSupport: "Send moves a player to the other side. Cut drops them for roster space and assigns dead cap.",
  filterBoth: "Search and position apply to both rosters.",
  playerMetaKey: "Row line is years left, contract type, fair vs salary, then projected points per $1 of salary.",
  noPackageYet: "No players in the package yet.",
  packageTitle: "Package",
  sendVerb: "Send",
  getVerb: "Get",
  cutVerb: "Cut",
  reviewTitle: "Review cap impact",
  reviewSupport: "Projected current-roster salary, free cap, and roster counts — then send for approval.",
  proposeTitle: "Propose this trade",
  proposeSupport: "Partners see it in Inbox. Contracts stay put until every team accepts.",
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
    "Suggestions move extra depth and target spots where you cannot fill a starter.",
  ideasSurplus: "Your extra depth",
  ideasNeeds: "Thin for a starter",
  ideasEmptyHeading: "No packages yet",
  inboxEmptyHeading: "No pending proposals",
  inboxEmpty: "Build a package and propose it — every team must accept.",
  proposalSent: "Proposal sent — waiting for acceptances.",
  loadedPackage: "Loaded package into builder.",
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
      ? `${names.join(", ")} will see this in Inbox. Nothing moves until every team accepts.`
      : "Every team in the deal must accept before contracts move.",
  whatsNext: "They can accept or reject. You can cancel from Inbox until it executes.",
};

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
