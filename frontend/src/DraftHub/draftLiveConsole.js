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
