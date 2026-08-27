/** Pure helpers for the live-auction command console. */

export function viewerIsCommissioner({ hubContext, viewer, myTeam } = {}) {
  return Boolean(
    hubContext?.is_commissioner
    || viewer?.is_commissioner
    || myTeam?.is_commissioner,
  );
}

export function bidRelation({ myTeamId, highBidderTeamId } = {}) {
  if (!highBidderTeamId) return "watching";
  if (myTeamId && String(highBidderTeamId) === String(myTeamId)) return "winning";
  if (myTeamId) return "outbid";
  return "watching";
}

export function bidRelationLabel(relation) {
  if (relation === "winning") return "You're winning";
  if (relation === "outbid") return "You've been outbid";
  return "Watching";
}

/** Lock the amount field for pause/sim/position — never because a rival bid just landed. */
export function bidAmountInputLocked({
  controlsLocked = false,
  positionBlocked = false,
} = {}) {
  return Boolean(controlsLocked || positionBlocked);
}

export function bidAmountSubmitLocked({
  controlsLocked = false,
  positionBlocked = false,
  amount,
  minBid,
} = {}) {
  if (controlsLocked || positionBlocked) return true;
  if (amount === "" || amount == null) return true;
  const n = Number(amount);
  const min = Number(minBid);
  return !Number.isFinite(n) || (Number.isFinite(min) && n < min);
}

/**
 * Keep a focused (or still-legal) edit when the high bid changes.
 * Unfocused invalid amounts snap to the new minimum so the field cannot stick.
 */
export function displayedBidAmount({
  currentAmount,
  suggestedBid,
  focused = false,
  touched = false,
} = {}) {
  const next = suggestedBid == null || suggestedBid === "" ? "" : String(suggestedBid);
  if (focused) return currentAmount == null ? next : String(currentAmount);
  if (!touched) return next;
  const n = Number(currentAmount);
  if (!Number.isFinite(n) || (next !== "" && n < Number(next))) return next;
  return String(currentAmount);
}

/** Integer dollars only — avoids type=number spinner / min fights mid-edit. */
export function sanitizeBidAmountInput(raw) {
  const text = String(raw ?? "");
  if (text === "") return "";
  if (/^\d{0,7}$/.test(text)) return text;
  return null;
}

export function riskBand(score) {
  if (score == null || score === "") {
    return { label: "—", band: "unknown", z: null };
  }
  const z = Number(score);
  if (!Number.isFinite(z)) {
    return { label: "—", band: "unknown", z: null };
  }
  if (z <= -0.5) return { label: "Stable", band: "stable", z };
  if (z >= 0.5) return { label: "Volatile", band: "volatile", z };
  return { label: "Balanced", band: "balanced", z };
}

export function riskBandTooltip(score) {
  const band = riskBand(score);
  const raw = band.z == null ? "n/a" : band.z.toFixed(2);
  return (
    `${band.label} risk from position-normalized season P10–P90 width `
    + `(z-score ${raw}; higher = more boom/bust vs positional peers).`
  );
}

export function suggestedBidSource(riskToleranceActive) {
  return riskToleranceActive ? "risk-adjusted" : "model-neutral";
}

export function suggestedBidCaption(riskToleranceActive) {
  return riskToleranceActive
    ? "Risk-adjusted value from your bidding stance"
    : "Neutral model value from projected points rank";
}

export function nextNominator(session, teams = []) {
  const order = session?.nomination_order || [];
  if (!order.length) return null;
  const idx = Number(session?.nominator_index) || 0;
  const nextId = order[(idx + 1) % order.length];
  return teams.find((t) => String(t.id) === String(nextId)) || { id: nextId };
}

export function nextOnClock(session, teams = [], draftType = "auction") {
  const order = session?.nomination_order || [];
  if (!order.length) return null;
  const idx = (Number(session?.nominator_index) || 0) + 1;
  const n = order.length;
  const rnd = Math.floor(idx / n);
  let slot = idx % n;
  if (draftType === "snake" && rnd % 2 === 1) slot = n - 1 - slot;
  const nextId = order[slot];
  return teams.find((t) => String(t.id) === String(nextId)) || { id: nextId };
}

export function formatPickTracker(pickClock, { nextTeam } = {}) {
  if (!pickClock?.round) return "";
  const parts = [`R${pickClock.round}`, `P${pickClock.overall}`];
  const nextName = String(nextTeam?.name || "").trim();
  if (nextName) parts.push(`Next ${nextName}`);
  return parts.join(" · ");
}

export function teamRosterLine(team = {}) {
  const rostered = Number(team.occupying);
  const max = Number(team.roster_size_max);
  const rosterN = Number.isFinite(rostered) ? rostered : 0;
  const maxN = Number.isFinite(max) && max > 0 ? max : null;
  return {
    rostered: rosterN,
    rosterMax: maxN,
    text: maxN ? `${rosterN}/${maxN} rostered` : `${rosterN} rostered`,
  };
}

export function teamBudgetLine(team = {}) {
  const rostered = Number(team.occupying);
  const max = Number(team.roster_size_max);
  const budget = Number(team.budget_remaining);
  const maxBid = Number(team.max_bid);
  const budgetN = Number.isFinite(budget) ? budget : 0;
  const maxBidN = Number.isFinite(maxBid) ? maxBid : budgetN;
  const rosterPart = Number.isFinite(rostered) && Number.isFinite(max) && max > 0
    ? `${rostered}/${max} rostered`
    : Number.isFinite(rostered)
      ? `${rostered} rostered`
      : "";
  const parts = [`Budget $${Math.round(budgetN)}`];
  if (rosterPart) parts.push(rosterPart);
  parts.push(`Max bid $${Math.round(maxBidN)}`);
  return {
    budget: budgetN,
    rostered: Number.isFinite(rostered) ? rostered : 0,
    rosterMax: Number.isFinite(max) ? max : null,
    maxBid: maxBidN,
    text: parts.join(" · "),
  };
}

export function recapScopes({
  auctionWins = 0,
  auctionSpent = 0,
  budgetRemaining = null,
  rosteredCount = 0,
  limitsRelaxed = false,
} = {}) {
  return {
    thisMock: {
      id: "this_mock",
      label: "This mock",
      auctionWins,
      auctionSpent,
      budgetRemaining,
    },
    fullKeeperRoster: {
      id: "full_keeper_roster",
      label: "Full keeper roster",
      note: limitsRelaxed
        ? "Hypothetical full-roster exposure — salary limits are off"
        : "Keepers, dead cap, and auction wins",
    },
    leagueWide: {
      id: "league_wide",
      label: "League-wide",
      auctionWins,
      rosteredCount,
    },
  };
}

export function shortContractLabel(pick = {}) {
  const years = Number(pick.contract_years || pick.years || 2);
  const sched = Array.isArray(pick.salary_schedule) ? pick.salary_schedule : [];
  const first = sched.length ? sched[0] : (pick.salary ?? pick.amount);
  const last = sched.length ? sched[sched.length - 1] : first;
  const yrs = Number.isFinite(years) && years > 0 ? years : 2;
  if (first == null || !Number.isFinite(Number(first))) return `${yrs} yrs`;
  const a = Math.round(Number(first));
  const b = Math.round(Number(last));
  return `${yrs} yrs · $${a} → $${b}`;
}

export function watchStorageKey(leagueId) {
  return `scoresense-draft-watch:${leagueId}`;
}

export function loadWatchIds(leagueId) {
  if (!leagueId || typeof sessionStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(watchStorageKey(leagueId)) || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function saveWatchIds(leagueId, ids) {
  if (!leagueId || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      watchStorageKey(leagueId),
      JSON.stringify([...new Set((ids || []).map(String))]),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function toggleWatchId(leagueId, playerId) {
  const id = String(playerId || "");
  if (!id) return loadWatchIds(leagueId);
  const current = loadWatchIds(leagueId);
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  saveWatchIds(leagueId, next);
  return next;
}

export function connectionStatusLabel(status) {
  if (status === "live") return "Live";
  if (status === "connecting") return "Connecting";
  if (status === "reconnecting") return "Reconnecting";
  return "Offline";
}

export function isLiveAuctionStatus(status) {
  return status === "nominating" || status === "bidding" || status === "picking";
}

/**
 * One lock policy for every draft mutation and every visible clock.
 * Simulation is client-initiated and can outlive several server clock ticks,
 * so it must freeze the UI even before the completed room state arrives.
 */
export function draftInteractionState({
  busy = false,
  pendingAction = "",
  paused = false,
  simulationStatus = "idle",
} = {}) {
  const simulationActive = simulationStatus === "confirming" || simulationStatus === "running";
  const simulating = simulationStatus === "running";
  return {
    locked: Boolean(busy || pendingAction || paused || simulationActive),
    simulationActive,
    simulating,
    clockPaused: Boolean(paused || simulating),
    clockLabel: simulating ? "Simulating…" : "Paused",
  };
}

/**
 * Ignore stale/partial room payloads so the live auction cannot flash back
 * to the setup "draft page" (wrong league, missing session, reconnect race).
 */
export function shouldApplyRoomState(prev, next, currentLeagueId) {
  if (!next || typeof next !== "object") return false;
  const nextLeagueId = next.league?.id;
  if (currentLeagueId && nextLeagueId && String(nextLeagueId) !== String(currentLeagueId)) {
    return false;
  }
  const prevLive = isLiveAuctionStatus(prev?.session?.status);
  const nextStatus = next.session?.status;
  const nextLive = isLiveAuctionStatus(nextStatus);
  const nextCompleted = nextStatus === "completed" || Boolean(next.league?.draft_completed);
  const nextExplicitSetup = nextStatus === "setup";
  if (prevLive && !nextLive && !nextCompleted && !nextExplicitSetup) {
    return false;
  }
  return true;
}

/** Broadcasts omit `viewer`; keep the last one so the roster/turn UI stays put. */
export function mergeRoomState(prev, next) {
  if (!next) return prev || next;
  if (!prev) return next;
  const sameLeague = !prev.league?.id || !next.league?.id
    || String(prev.league.id) === String(next.league.id);
  if (sameLeague && prev.viewer && !next.viewer) {
    return { ...next, viewer: prev.viewer };
  }
  return next;
}

/** Only reconnect after an unexpected close of the socket we still own. */
export function shouldScheduleWsReconnect({
  roomStillMounted = true,
  closedSocketIsCurrent = true,
} = {}) {
  return Boolean(roomStillMounted && closedSocketIsCurrent);
}

/**
 * Prime result notifications from hydrated room history without replaying the
 * latest historical pick/win. Once primed, return only genuinely new results.
 */
export function draftResultTransition({
  events = [],
  roomHydrated = false,
  initialized = false,
  lastEventId = null,
} = {}) {
  const results = (Array.isArray(events) ? events : [])
    .filter((event) => event?.event_type === "win" || event?.event_type === "pick");
  const latest = results[results.length - 1] || null;
  const latestId = latest?.id == null ? null : String(latest.id);

  if (!roomHydrated) {
    return { initialized, lastEventId, event: null };
  }
  if (!initialized) {
    return { initialized: true, lastEventId: latestId, event: null };
  }
  if (!latest || !latestId || latestId === String(lastEventId || "")) {
    return { initialized: true, lastEventId, event: null };
  }
  return { initialized: true, lastEventId: latestId, event: latest };
}
