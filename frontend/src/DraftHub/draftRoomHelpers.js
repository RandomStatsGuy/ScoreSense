/** Format draft room events for display. */
export function formatDraftEvent(ev) {
  const p = ev.payload || {};
  switch (ev.event_type) {
    case "bid":
      return `${p.team_name || "Team"} bid ${fmt(p.amount)}`;
    case "nominate":
      return `${p.player_name || "Player"} (${p.position || "?"}) nominated`;
    case "win":
      return p.value_blurb
        ? `${p.team_name || "Team"} gets ${p.player_name || "Player"} — ${p.value_blurb}`
        : `${p.player_name || "Player"} won for ${fmt(p.amount)}${p.team_name ? ` · ${p.team_name}` : ""}`;
    case "pass":
      if (p.reason === "no_bids") {
        return `${p.player_name || "Player"} passed — no bids`;
      }
      if (p.reason === "position_cap") return `${p.player_id ? "No sale" : "Nomination passed"} · roster position full`;
      return p.player_id ? "No sale" : "Nomination passed";
    case "start":
      return "Draft started";
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

export function canAcquireAtPosition(capacity, position) {
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

/** Client-side roster capacity from league rules + draft roster rows. */
export function buildRosterCapacity(rules, roster) {
  const rosterRules = rules?.roster || {};
  const counts = {};
  for (const row of roster || []) {
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
    byPosition[pos] = {
      count,
      min: Number(val.min ?? 0),
      max,
      at_max: count >= max,
      remaining: Math.max(0, max - count),
    };
  }
  return byPosition;
}

export function formatCountdown(seconds) {
  if (seconds == null) return "";
  if (seconds <= 0) return "0s";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
