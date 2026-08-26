/** Compact round/overall label, e.g. `R1 · P1`. */
export function formatPickSlot(payload = {}) {
  const round = payload.round == null || payload.round === "" ? null : Number(payload.round);
  const overall = payload.overall == null || payload.overall === "" ? null : Number(payload.overall);
  const hasRound = Number.isFinite(round);
  const hasOverall = Number.isFinite(overall);
  if (hasRound && hasOverall) return `R${round} · P${overall}`;
  if (hasOverall) return `P${overall}`;
  if (hasRound) return `R${round}`;
  return "";
}

/** Format draft room events for display. */
export function formatDraftEvent(ev) {
  const p = ev.payload || {};
  switch (ev.event_type) {
    case "bid":
      return `${p.team_name || "Team"} bid ${fmt(p.amount)}`;
    case "nominate":
      return p.forced
        ? `${p.player_name || "Player"} (${p.position || "?"}) force-nominated for ${p.nominating_team_name || "on-clock team"}`
        : `${p.player_name || "Player"} (${p.position || "?"}) nominated`;
    case "force_nominate":
      return `Commissioner nominated ${p.player_name || "player"} for ${p.team_name || "on-clock team"}`;
    case "pick": {
      const who = `${p.player_name || "Player"} (${p.position || "?"})`;
      const loc = formatPickSlot(p);
      const locBit = loc ? ` · ${loc}` : "";
      return p.forced
        ? `${p.team_name || "Team"} force-picked ${who}${locBit}`
        : `${p.team_name || "Team"} picked ${who}${locBit}`;
    }
    case "win":
      return p.value_blurb
        ? `${p.team_name || "Team"} gets ${p.player_name || "Player"} — ${p.value_blurb}`
        : `${p.player_name || "Player"} won for ${fmt(p.amount)}${p.team_name ? ` · ${p.team_name}` : ""}`;
    case "pass":
      if (p.reason === "no_bids") {
        return `${p.player_name || "Player"} passed — no bids`;
      }
      if (p.reason === "nomination_timeout") {
        return `${p.team_name || "Team"} skipped — nomination clock expired`;
      }
      if (p.reason === "pick_timeout") {
        return `${p.team_name || "Team"} skipped — pick clock expired`;
      }
      if (p.reason === "commissioner_skip") {
        return `${p.team_name || "Team"} skipped by commissioner`;
      }
      if (p.reason === "position_cap") return `${p.player_id ? "No sale" : "Nomination passed"} · roster position full`;
      return p.player_id ? "No sale" : "Nomination passed";
    case "start":
      return "Draft started";
    case "pause":
      return "Draft paused";
    case "resume":
      return "Draft resumed";
    case "end":
      return p.released_nominee
        ? `Draft ended · ${p.released_nominee} returned to the pool`
        : "Draft ended by commissioner";
    case "cut":
      return `Cut · refund ${fmt(p.refund)}`;
    case "trade":
      return p.summary ? `Trade · ${p.summary}` : "Trade completed";
    default:
      return ev.event_type;
  }
}

function fmt(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `$${Number(v).toFixed(0)}`;
}

export function minNextBid(session, rules) {
  const minInc = Number(rules?.auction?.min_bid ?? 1);
  const high = Number(session?.high_bid ?? 0);
  if (session?.status === "bidding" && high > 0) {
    return high + minInc;
  }
  return minInc;
}

export function secondsUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}

export function canAcquireAtPosition(capacity, position, { relaxLimits } = {}) {
  if (relaxLimits) return true;
  if (!position) return true;
  const pos = String(position).toUpperCase();
  const normalized = pos === "DST" || pos === "D/ST" ? "DEF" : pos;
  const cap = capacity?.[normalized] || capacity?.[pos];
  if (!cap) return true;
  return !cap.at_max;
}

/**
 * Match backend retained_through_draft — expirees / FA contracts stay on the
 * roster row but must remain nominatable in the draft pool.
 */
export function isRetainedThroughDraft(row, draftCompleted = false) {
  if (!row) return false;
  if (String(row.roster_status || "active") === "cut_before_draft") return false;
  const acq = String(
    row.acquisition_type || row.contract?.acquisition_type || "",
  ).toLowerCase();
  if (acq === "fa_contract") return false;
  if (draftCompleted) return true;
  const yrs = Number(row.contract?.years_remaining ?? row.contract_years ?? 1);
  if (yrs > 1) return true;
  const source = String(row.source || "").toLowerCase();
  return ["draft", "auction", "mock", "test_draft"].includes(source);
}

/** Client-side roster capacity from league rules + occupying roster rows. */
export function buildRosterCapacity(rules, roster, { draftCompleted = false, relaxLimits = false } = {}) {
  const rosterRules = rules?.roster || {};
  const counts = {};
  for (const row of roster || []) {
    if (!isRetainedThroughDraft(row, draftCompleted)) continue;
    const raw = String(row.position || "").toUpperCase();
    const pos = raw === "DST" || raw === "D/ST" ? "DEF" : raw === "REC" ? "WR" : raw;
    if (pos) {
      counts[pos] = (counts[pos] || 0) + 1;
    }
  }
  const byPosition = {};
  for (const [key, val] of Object.entries(rosterRules)) {
    if (key === "flex" || !val || typeof val !== "object") continue;
    const pos = key.toUpperCase();
    const count = counts[pos] || 0;
    const max = Number(val.max ?? 99);
    const min = Number(val.min ?? 0);
    byPosition[pos] = {
      count,
      min,
      max,
      at_max: relaxLimits ? false : count >= max,
      below_min: relaxLimits ? false : count < min,
      remaining: Math.max(0, max - count),
    };
  }
  return byPosition;
}

export function unmetMinPositions(capacityByPosition) {
  return Object.entries(capacityByPosition || {})
    .filter(([, cap]) => Number(cap?.min) > 0 && Number(cap?.count) < Number(cap.min))
    .map(([pos]) => pos);
}

/** Keep unmet-min positions in the visible window without hiding stars. */
export function pinNeedPositions(rows, needPositions, maxRows) {
  const list = rows || [];
  const pins = [...new Set(
    (needPositions || []).map((p) => String(p || "").toUpperCase()).filter(Boolean),
  )];
  if (!pins.length) {
    return maxRows ? list.slice(0, maxRows) : list;
  }
  const pinSet = new Set(pins);
  const need = [];
  const rest = [];
  for (const row of list) {
    const raw = String(row.position || "").toUpperCase();
    const pos = raw === "DST" || raw === "D/ST" ? "DEF" : raw === "REC" ? "WR" : raw;
    if (pinSet.has(pos)) need.push(row);
    else rest.push(row);
  }
  const merged = [...need, ...rest];
  return maxRows ? merged.slice(0, maxRows) : merged;
}

export function formatCountdown(seconds) {
  if (seconds == null) return "";
  if (seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
