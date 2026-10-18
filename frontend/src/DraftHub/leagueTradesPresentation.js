/** User-facing copy for Fantasy → Trades. */

export const TRADES_COPY = {
  compareAction: "Compare",
  compareVersions: "Compare versions",
  tryVersion: "Try another version",
  version: (id) => `Version ${id}`,
  keepVersion: (id) => `Keep version ${id} and stop comparing`,
  comparedWith: (id) => `Compared with ${id}`,
  removeMove: (name) => `Remove ${name} from package`,
  moreMoves: (n) => `+${n}`,
  viewMoves: (n) => `View all ${n} moves`,
  otherMoves: (n) => `${n} other ${n === 1 ? "move" : "moves"}`,
  undoRemove: "Undo",
  undoRemoveLabel: "Undo last package removal",
  limitsPass: "Limits pass",
  checkingShort: "Checking…",
  netCap: "Cap change",
  packageImpact: "Your package impact",
  capShort: "cap",
  noOtherVersion: "Same starter outlook",
  sameCap: "Same cap room",
  sameRoster: "Same roster size",
  loadingDetails: "Loading trade details",
  title: "Trades",
  eyebrow: "Trades",
  heading: "Trade desk",
  support: "Both rosters open. Every move updates the deal.",
  buildTab: "Build",
  discoverTab: "Discover",
  ideasTab: "Ideas",
  inboxTab: "Inbox",
  youSend: "You send",
  youReceive: "You receive",
  impact: "Impact",
  fullImpact: "Full impact",
  changePartner: "Change partner",
  choosePartner: "Choose partner",
  newPartnerPackage: "Choosing a different partner starts a new package.",
  addPartners: "Add / change partners",
  doneChoosing: "Done choosing",
  partnerSearch: "Search managers…",
  playerSearch: "Search both rosters…",
  position: "Position",
  allPositions: "All positions",
  advancedTerms: "Advanced terms",
  editPackage: "Edit package",
  reviewTrade: "Review trade",
  reviewHeading: "Review this trade",
  selectedCount: (n) => `${n} selected`,
  rosterCount: (n) => `${n} rostered`,
  viewRoster: (n) => `View all ${n}`,
  showFewer: "Show fewer",
  yourStarters: "Your starters",
  weekLabel: (week) => `Week ${week}`,
  pprEstimate: "PPR P50 estimate",
  weekLoading: "Loading week projections…",
  weekSelect: "Choose a partner to preview your starters.",
  weekClosed: "Week lineups return in-season.",
  beforeValue: (n) => `${n} before`,
  yourCap: "Your cap room",
  partnerCap: "Partner cap room",
  yourRoster: "Your roster",
  partnerRoster: "Partner roster",
  currentSalary: "Current roster salary",
  rosterBalance: "Roster balance",
  weekPoints: "Week P50",
  salary: "Salary",
  rosterEmpty: "Choose a trade partner to see their roster.",
  noMatches: "No players match your filters.",
  emptyRoster: "No players on this roster yet.",
  teamNeeded: "Your account needs a team in this league to build a trade.",
  emptyAction: "Add a player move or term to review the package.",
  afterProposal: "After you propose",
  nativeNext: "Partners see the proposal in Inbox. Every team must accept before players and agreed terms move.",
  privateWeek: "Your weekly lineup preview stays private.",
  previewSource: "Synced player moves · review agreed cap terms",
  close: "Close",
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
  choosePlayersSupport: "Choose who receives each player. Cut drops them for roster space and assigns dead cap.",
  chooseRecipient: "Choose recipient",
  deadCapTitle: "Existing dead cap",
  deadCapSupport: "Move all or part of a cut player's dead cap. This changes cap responsibility, not player ownership.",
  deadCapAmount: "Dead cap to move",
  deadCapFlow: (name, amount, from, to) => `${amount} dead cap from ${name} · ${from} → ${to}`,
  sleeperSupport: "Complete player moves in Sleeper, then use Sync league. ScoreSense applies agreed cap terms after confirming the destinations.",
  sleeperNotifyLine: "Every team must accept here. Player moves must also be completed in Sleeper and synced before agreed cap terms can be applied.",
  capAgreementNotifyLine: "Every affected team must accept before these dead-cap terms are applied. The synced player moves are already recorded.",
  sleeperAccepted: "Accepted — complete the player trade in Sleeper, then sync the league.",
  settleCap: "Apply agreed cap terms",
  reviewCapTerms: "Add dead-cap terms",
  closeCapReview: "Confirm no dead-cap terms",
  syncedMoves: "Player moves synced · cap terms need review",
  waitingSleeper: "Waiting for Sleeper",
  deadCapHistory: "Dead-cap source and history",
  deadCapSource: (name, amount, owner, season) => `${name} · ${amount} · originally ${owner} · ${season}`,
  recipientFor: (name) => `Send ${name} to`,
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
  stepNeedPackage: "Add a player move, cut, or dead-cap transfer first.",
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
  // Approved October 17 C · Face-off
  exchangeTitle: "The exchange",
  exchangeLive: "Live",
  sendView: "Send",
  receiveView: "Receive",
  exchangeView: "Exchange",
  youSendTo: (name) => `You send → ${name}`,
  youReceiveFrom: (name) => `You receive ← ${name}`,
  betweenPartners: "Between partners",
  pickFromYours: "Pick from your roster",
  pickFromTheirs: (name) => `Pick from ${name}’s roster`,
  ledgerOut: "Out",
  ledgerIn: "In",
  ledgerWeek: "Week pts",
  ledgerSalary: "Salary",
  ledgerLongest: "Longest deal",
  ledgerPlayers: "Players",
  weekPtsShort: "wk pts",
  sendsLabel: "Sends",
  nothingSent: "Nothing",
  you: "You",
  youSuffix: "· You",
  capRoomLabel: "Cap room",
  rosterLabel: "Roster",
  privateNote: "private to you",
  tradeReview: "Trade review",
  proposedVerb: "proposed",
  acceptAction: "Accept",
  rejectAction: "Reject",
  cancelAction: "Cancel",
  forceApplyAction: "Force apply",
  acceptanceAccepted: "Accepted",
  acceptanceRejected: "Declined",
  acceptanceWaiting: "Waiting",
  acceptanceYours: "Your call",
  statusPending: "Waiting for acceptances",
  statusYourResponse: "Waiting for your response",
  statusExecuted: "Executed",
  statusRejected: "Declined",
  statusCancelled: "Cancelled",
};

export function tradesCopyForFormat(pickDraft) {
  if (!pickDraft) return TRADES_COPY;
  return {
    ...TRADES_COPY,
    support: "Both rosters open. Every move updates the deal.",
    purpose: "Choose players, review roster impact, and send a trade proposal.",
    pickPartnerSupport: "Compare each team's roster size and positional needs.",
    choosePlayersSupport: "Choose who receives each player. Drop opens a roster spot.",
    playerMetaKey: "Each player shows position and projected production.",
    cutVerb: "Drop",
    stepNeedPackage: "Add a player move or drop first.",
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
 impact:'Your trade impact',choosePlayers:'Select players to preview projected impact.',availableSend:'Your available players',availableGet:'Partner’s available players',basis:'PPR projections',season:'This season',remaining:'Remaining games',
 contract:'Contract life',contractMethod:'Same-pace estimate',lineup:'Lineup & depth',efficiency:'Points / $',
 missing:'—',noMatches:'No matching teams',review:'Review trade',close:'Close trade review',
 note:'Add a note',afterAccept:'Moves after everyone accepts.',back:'Change partner',advanced:'Advanced moves',
 projectionDetails:'Projection details',
 forecastLoading:'Loading position forecasts…',
 forecastError:'Forecast update failed. We will retry automatically.',
 forecastRebuilding:'Updating forecasts. Any saved forecasts remain available while the update runs.',
 forecastStale:'Using saved forecasts while updated forecasts rebuild.',
 forecastMissing:n=>`${n} ${n===1?'player still needs':'players still need'} a forecast. Affected position ranks are unavailable.`,
 rosterMethod:'PPR forecasts for remaining games. Skill positions use model projections; K and DEF use rank-curve estimates. Starters use the best eligible lineup; bench points cover the remaining roster. Missing forecasts stay unavailable.',
 method:'PPR forecasts. Skill positions use model projections; K and DEF use rank-curve estimates. Season points cover remaining games. Starters use the best eligible lineup; bench points cover the remaining roster. Contract estimates repeat the full-season outlook for future contracted years; they do not predict aging. Points per dollar compare incoming and outgoing season points against current salaries. Missing forecasts stay unavailable.',
};

export function tradeForecastStatus(outlook) {
 if (!outlook) return TRADE_DISCOVERY_COPY.forecastLoading;
 if (outlook.error || outlook.recovery?.status === 'error') return TRADE_DISCOVERY_COPY.forecastError;
 if (['queued','running','busy'].includes(outlook.recovery?.status)) return TRADE_DISCOVERY_COPY.forecastRebuilding;
 if (outlook.stale) return TRADE_DISCOVERY_COPY.forecastStale;
 if (outlook.missing_player_ids?.length) return TRADE_DISCOVERY_COPY.forecastMissing(outlook.missing_player_ids.length);
 return '';
}


const finiteValue = value => value != null && value !== "" && Number.isFinite(Number(value));
const money = value => `$${Math.abs(Number(value)).toFixed(0)}`;

/** A consequence from this package, never a fairness or acceptance prediction. */
export function tradePackageHeadline({ parties = [], myTeamId, projected, weekPreview, rules, salaryLeague = true }) {
  const mine = parties.find(p => p.team_id === myTeamId);
  const incoming = parties.flatMap(p => (p.sends || []).filter(s => p.team_id !== myTeamId && s.to_team_id === myTeamId));
  const ownMoves = (mine?.sends?.length || 0) + (mine?.drops?.length || 0) + incoming.length;
  const deadMoves = parties.flatMap(p => p.dead_cap_transfers || []).length;
  if (!ownMoves && !deadMoves) return null;
  if (salaryLeague && finiteValue(projected?.unspent) && projected.unspent < 0) {
    return { text: `Needs ${money(projected.unspent)} more cap room`, tone: "attention" };
  }
  const counts = projected?.by_position_count || {};
  const before = projected?.base?.by_position_count || {};
  const short = ["QB", "RB", "WR", "TE", "K", "DEF"].find(pos => {
    const required = Number(rules?.roster?.[pos.toLowerCase()]?.starter) || 0;
    return (counts[pos] || 0) < required && (counts[pos] || 0) < (before[pos] || 0);
  });
  if (short) return { text: `Leaves ${counts[short] || 0} ${short} for ${rules.roster[short.toLowerCase()].starter} starting ${Number(rules.roster[short.toLowerCase()].starter) === 1 ? "slot" : "slots"}`, tone: "attention" };
  if (weekPreview?.available && weekPreview.bumped_starters?.length) {
    const [first, ...rest] = weekPreview.bumped_starters;
    return { text: rest.length ? `${first.player_name} + ${rest.length} enter your projected starters`
      : `${first.player_name} enters your projected starters`,
      compactText: rest.length ? `Adds ${rest.length + 1} projected starters` : `Adds a projected ${first.position ? first.position + " " : ""}starter`, tone: "neutral" };
  }
  if (salaryLeague && finiteValue(projected?.unspent) && finiteValue(projected?.base?.unspent)) {
    const delta = projected.unspent - projected.base.unspent;
    if (Math.abs(delta) >= 1) return { text: delta > 0 ? `Frees ${money(delta)} in cap room` : `Uses ${money(delta)} of cap room`, tone: delta > 0 ? "up" : "neutral" };
  }
  if (!ownMoves && deadMoves) return { text: "Changes cap responsibility; players stay put", tone: "neutral" };
  if (weekPreview?.available && weekPreview.lost_starters?.length) {
    const [first, ...rest] = weekPreview.lost_starters;
    return { text: rest.length ? `Moves ${first.player_name} + ${rest.length} out of your starters`
      : `Moves ${first.player_name} out of your starters`, tone: "neutral" };
  }
  if (incoming.length && weekPreview?.available) return { text: "Adds options behind your projected starters", tone: "neutral" };
  if (mine?.drops?.length) return { text: `Opens ${mine.drops.length === 1 ? "a roster spot" : `${mine.drops.length} roster spots`}`, tone: "neutral" };
  return { text: incoming.length ? "Changes your roster mix" : "Moves players out of your roster", tone: "neutral" };
}

export function tradeVersionComparison({ current, other, currentWeek, otherWeek, salaryLeague = true }) {
  const rows = [];
  if (currentWeek?.available && otherWeek?.available) {
    const delta = Math.round((currentWeek.after_p50 - otherWeek.after_p50) * 10) / 10;
    rows.push({ text: delta === 0 ? TRADES_COPY.noOtherVersion : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} starter PPR`, tone: delta > 0 ? "up" : delta < 0 ? "down" : "neutral" });
  }
  if (salaryLeague && finiteValue(current?.unspent) && finiteValue(other?.unspent)) {
    const delta = current.unspent - other.unspent;
    rows.push({ text: delta === 0 ? TRADES_COPY.sameCap : `${money(delta)} ${delta > 0 ? "more" : "less"} cap room`, tone: delta > 0 ? "up" : delta < 0 ? "down" : "neutral" });
  } else if (!salaryLeague && current && other) {
    const count = value => Object.values(value.by_position_count || {}).reduce((sum, n) => sum + Number(n), 0);
    const delta = count(current) - count(other);
    rows.push({ text: delta === 0 ? TRADES_COPY.sameRoster : `${Math.abs(delta)} ${delta > 0 ? "more" : "fewer"} ${Math.abs(delta) === 1 ? "player" : "players"}`, tone: "neutral" });
  }
  return rows;
}


export function tradeCapChangeText(before, after) {
  if (!finiteValue(before) || !finiteValue(after)) return null;
  const delta = Number(after) - Number(before);
  return Math.abs(delta) < 1 ? null : `${delta > 0 ? "+" : "−"}${money(delta)}`;
}

/**
 * Out / In ledger for the live exchange column. Each leg: { salary, years, weekP50 }.
 * Weekly points stay missing when any leg on a side lacks a forecast.
 */
export function tradeExchangeLedger({ out = [], incoming = [], salaryLeague = true, weekAvailable = false, copy = TRADES_COPY }) {
  if (!out.length && !incoming.length) return [];
  const dash = "—";
  const points = legs => {
    if (!legs.length) return dash;
    if (legs.some(leg => !finiteValue(leg.weekP50))) return dash;
    return legs.reduce((sum, leg) => sum + Number(leg.weekP50), 0).toFixed(1);
  };
  const salary = legs => legs.length ? money(legs.reduce((sum, leg) => sum + (Number(leg.salary) || 0), 0)) : dash;
  const longest = legs => {
    const years = legs.map(leg => Number(leg.years)).filter(Number.isFinite);
    return years.length ? `${Math.max(...years)}y` : dash;
  };
  const rows = [];
  if (weekAvailable) rows.push({ label: copy.ledgerWeek, out: points(out), in: points(incoming) });
  if (salaryLeague) {
    rows.push({ label: copy.ledgerSalary, out: salary(out), in: salary(incoming) });
    rows.push({ label: copy.ledgerLongest, out: longest(out), in: longest(incoming) });
  } else {
    rows.push({ label: copy.ledgerPlayers, out: out.length ? String(out.length) : dash, in: incoming.length ? String(incoming.length) : dash });
  }
  return rows;
}

/** One party's acceptance pill. Amber waits, teal accepted, muted declined. */
export function tradeAcceptanceLabel(state, { isYou = false, copy = TRADES_COPY } = {}) {
  if (state === "accepted") return { text: copy.acceptanceAccepted, tone: "positive" };
  if (state === "rejected") return { text: copy.acceptanceRejected, tone: "muted" };
  return { text: isYou ? copy.acceptanceYours : copy.acceptanceWaiting, tone: "attention" };
}

/** Proposal-level status for the duel centre. Unknown statuses read as plain words. */
export function tradeProposalStatus(status, { yourResponsePending = false, copy = TRADES_COPY } = {}) {
  if (status === "pending") return { text: yourResponsePending ? copy.statusYourResponse : copy.statusPending, tone: "attention" };
  if (status === "awaiting_sleeper") return { text: copy.waitingSleeper, tone: "attention" };
  if (status === "cap_review") return { text: copy.syncedMoves, tone: "attention" };
  if (status === "executed") return { text: copy.statusExecuted, tone: "positive" };
  if (status === "rejected") return { text: copy.statusRejected, tone: "muted" };
  if (status === "cancelled" || status === "canceled") return { text: copy.statusCancelled, tone: "muted" };
  const plain = String(status || "").replace(/_/g, " ").trim();
  return { text: plain ? plain[0].toUpperCase() + plain.slice(1) : "—", tone: "muted" };
}
